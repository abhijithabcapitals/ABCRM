-- Standalone: install the LATEST _abcap_clone_to (case-insensitive field match,
-- and folder targets also match folder / list-in-folder / space-level columns).
-- Run this ONE file in the Supabase SQL editor if a full re-run of
-- phase3_automations_engine.sql is uncertain. Safe to re-run.

alter table tasks add column if not exists cloned_from uuid references tasks(id) on delete set null;

create or replace function _abcap_clone_to(t tasks, params jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare
  tgt_list uuid; tgt_folder uuid; tgt_space uuid;
  new_id uuid; st text; fv record; tgt_fid uuid; tgt_name text; k text; tok text; val text;
begin
  if t.cloned_from is not null then return; end if;
  tgt_list   := nullif(params->>'list_id','')::uuid;
  tgt_folder := coalesce(nullif(params->>'folder_id',''), nullif(params->>'target_folder_id',''))::uuid;

  if tgt_list is not null then
    select folder_id, space_id into tgt_folder, tgt_space from lists where id = tgt_list and deleted_at is null;
    if not found then return; end if;
  elsif tgt_folder is not null then
    select space_id into tgt_space from folders where id = tgt_folder and deleted_at is null;
    if not found then return; end if;
  else
    return;
  end if;

  perform set_config('abcap.in_automation','1', true);

  select id into new_id from tasks
   where cloned_from = t.id and deleted_at is null
     and ((tgt_list is not null and list_id = tgt_list)
       or (tgt_list is null and folder_id = tgt_folder and list_id is null))
   limit 1;

  if new_id is null then
    st := nullif(params->>'status','');
    if st is null or st = 'target_first' then
      select name into st from space_statuses
       where ((tgt_list is not null and list_id = tgt_list)
           or (tgt_list is null and folder_id = tgt_folder and list_id is null)
           or (tgt_list is null and tgt_folder is null and space_id = tgt_space and folder_id is null and list_id is null))
       order by status_order limit 1;
      st := coalesce(st, 'To Do');
    elsif st = 'source' then
      st := t.status;
    end if;

    insert into tasks (title, status, priority, space_id, folder_id, list_id, cloned_from, updated_by, updated_at)
    values (coalesce(nullif(t.title,''),'Untitled'), st, 'Medium', tgt_space, tgt_folder, tgt_list, t.id,
            coalesce(nullif(t.updated_by,''),'Automation'), now())
    returning id into new_id;
  end if;

  for fv in
    select sf.field_name as src_name, tfv.value
      from task_field_values tfv join space_fields sf on sf.id = tfv.field_id
     where tfv.task_id = t.id
  loop
    tgt_name := coalesce(
      params->'map'->>fv.src_name,
      (select v from jsonb_each_text(coalesce(params->'map','{}'::jsonb)) as m(kk, v) where lower(kk) = lower(fv.src_name) limit 1),
      fv.src_name);
    select id into tgt_fid from space_fields
     where lower(field_name) = lower(tgt_name)
       and ( (tgt_list is not null and list_id = tgt_list)
          or (tgt_folder is not null and folder_id = tgt_folder)
          or (tgt_folder is not null and list_id in (select id from lists where folder_id = tgt_folder and deleted_at is null))
          or (space_id = tgt_space and folder_id is null and list_id is null) )
     order by (list_id = tgt_list) desc nulls last, (folder_id = tgt_folder) desc nulls last
     limit 1;
    if tgt_fid is not null then
      update task_field_values set value = fv.value where task_id = new_id and field_id = tgt_fid;
      if not found then insert into task_field_values(task_id, field_id, value) values (new_id, tgt_fid, fv.value); end if;
    end if;
  end loop;

  if params ? 'set' then
    for k in select jsonb_object_keys(params->'set') loop
      tok := params->'set'->>k;
      val := case tok
               when 'today'       then to_char(current_date, 'YYYY-MM-DD')
               when 'month_start' then to_char(date_trunc('month', current_date), 'YYYY-MM-DD')
               when 'now'         then to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS')
               else tok
             end;
      select id into tgt_fid from space_fields
       where lower(field_name) = lower(k)
         and ( (tgt_list is not null and list_id = tgt_list)
            or (tgt_folder is not null and folder_id = tgt_folder)
            or (tgt_folder is not null and list_id in (select id from lists where folder_id = tgt_folder and deleted_at is null))
            or (space_id = tgt_space and folder_id is null and list_id is null) )
       order by (list_id = tgt_list) desc nulls last, (folder_id = tgt_folder) desc nulls last
       limit 1;
      if tgt_fid is not null then
        update task_field_values set value = val where task_id = new_id and field_id = tgt_fid;
        if not found then insert into task_field_values(task_id, field_id, value) values (new_id, tgt_fid, val); end if;
      end if;
    end loop;
  end if;
end $$;

-- Re-run clone_to after field values are written (called by the app on create).
create or replace function run_clone_actions(p_task_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare t tasks; a automations; act jsonb;
begin
  select * into t from tasks where id = p_task_id and deleted_at is null;
  if not found then return; end if;
  for a in
    select * from automations
     where enabled
       and ((scope_type = 'list'   and scope_id = t.list_id)
         or (scope_type = 'folder' and scope_id = t.folder_id)
         or (scope_type = 'space'  and scope_id = t.space_id))
       and trigger->>'type' in ('task_created', 'any_change')
  loop
    if _abcap_eval_conditions(a.conditions, t, coalesce(a.conditions_match, 'all')) then
      for act in select jsonb_array_elements(a.actions) loop
        if act->>'type' = 'clone_to' then
          perform _abcap_clone_to(t, act->'params');
        end if;
      end loop;
    end if;
  end loop;
end $$;
grant execute on function run_clone_actions(uuid) to authenticated;

-- Sanity check: should return true.
select pg_get_functiondef('_abcap_clone_to(tasks,jsonb)'::regprocedure) ilike '%lower(field_name)%' as latest_installed;
