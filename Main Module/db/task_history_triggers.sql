-- Log EVERY task change to task_history via database triggers, so nothing can
-- bypass it — drawer saves, inline/sidebar edits, board drag, automations, or
-- direct SQL all get recorded. This replaces the app's manual history writes
-- (which missed some paths and never covered automations).
-- Run in the Supabase SQL editor (idempotent).
--
-- The emitted `changes` shape matches the app's history renderer:
--   { "status": {from,to} }, { "title": {from,to} }, { "created": true }, etc.
-- Custom field changes use the field's name as the key.
--
-- NOTE: `create trigger` briefly needs an exclusive lock on the table. If the
-- app is busy you may see "deadlock detected" — just RE-RUN this file (it's
-- idempotent); it succeeds once the momentary contention clears. lock_timeout
-- below makes a blocked run fail fast and cleanly instead of hanging.
set lock_timeout = '5s';

-- Actor: "Automation" when the change originated inside the automations engine
-- (which sets abcap.in_automation), else the task's updated_by.
create or replace function _abcap_hist_actor(p_updated_by text)
returns text language sql stable as $$
  select case when current_setting('abcap.in_automation', true) = '1' then 'Automation'
              else coalesce(nullif(p_updated_by, ''), 'System') end;
$$;

-- ── tasks: creation + native-column changes ──
create or replace function _abcap_log_task_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare ch jsonb := '{}'::jsonb;
begin
  if TG_OP = 'INSERT' then
    insert into task_history(task_id, changed_by, changed_at, changes)
      values (NEW.id, _abcap_hist_actor(NEW.updated_by), now(), '{"created": true}'::jsonb);
    return null;
  end if;

  if NEW.title       is distinct from OLD.title       then ch := ch || jsonb_build_object('title',       jsonb_build_object('from', OLD.title,       'to', NEW.title)); end if;
  if NEW.status      is distinct from OLD.status      then ch := ch || jsonb_build_object('status',      jsonb_build_object('from', OLD.status,      'to', NEW.status)); end if;
  if NEW.priority    is distinct from OLD.priority    then ch := ch || jsonb_build_object('priority',    jsonb_build_object('from', OLD.priority,    'to', NEW.priority)); end if;
  if NEW.due_date    is distinct from OLD.due_date    then ch := ch || jsonb_build_object('due_date',    jsonb_build_object('from', OLD.due_date,    'to', NEW.due_date)); end if;
  if NEW.description is distinct from OLD.description then ch := ch || jsonb_build_object('description', jsonb_build_object('from', '', 'to', '')); end if;
  if coalesce(NEW.assignees, '{}') is distinct from coalesce(OLD.assignees, '{}') then
    ch := ch || jsonb_build_object('assignees', jsonb_build_object(
      'from', to_jsonb(coalesce(OLD.assignees, '{}')), 'to', to_jsonb(coalesce(NEW.assignees, '{}'))));
  end if;

  if ch = '{}'::jsonb then return null; end if;  -- nothing tracked changed (e.g. trash/restore)
  insert into task_history(task_id, changed_by, changed_at, changes)
    values (NEW.id, _abcap_hist_actor(NEW.updated_by), now(), ch);
  return null;
end $$;

drop trigger if exists trg_abcap_log_task_change on tasks;
create trigger trg_abcap_log_task_change after insert or update on tasks
  for each row execute function _abcap_log_task_change();

-- ── task_field_values: custom field changes (keyed by field name) ──
create or replace function _abcap_log_field_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare fname text; t_updated_by text; t_created timestamptz;
begin
  if TG_OP = 'UPDATE' and NEW.value is not distinct from OLD.value then return null; end if;
  select updated_by, created_at into t_updated_by, t_created from tasks where id = NEW.task_id;
  if not found then return null; end if;
  -- Skip the burst of field inserts fired while a task is first being created.
  if TG_OP = 'INSERT' and t_created is not null and t_created > now() - interval '10 seconds' then return null; end if;
  select field_name into fname from space_fields where id = NEW.field_id;
  insert into task_history(task_id, changed_by, changed_at, changes)
    values (NEW.task_id, _abcap_hist_actor(t_updated_by), now(),
      jsonb_build_object(coalesce(fname, 'Field'), jsonb_build_object(
        'from', coalesce(case when TG_OP = 'UPDATE' then OLD.value else '' end, ''),
        'to',   coalesce(NEW.value, ''))));
  return null;
end $$;

drop trigger if exists trg_abcap_log_field_change on task_field_values;
create trigger trg_abcap_log_field_change after insert or update on task_field_values
  for each row execute function _abcap_log_field_change();
