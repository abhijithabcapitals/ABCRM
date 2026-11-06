-- Phase 3: Business Setup service notifications, read from the service checklists of Business Setup migration 022.
-- Reads Business Setup tables and adds two triggers on them. Changes nothing in Business Setup's own files or functions.
-- The rules ship switched off. The release switches them on with baseline_pending set, so their first run is silent backlog.
-- Checklist items carry their own due date, assignee and status (Pending Client, Pending Authority, On Hold), so no new Business Setup field is needed.
insert into public.alert_settings (key, value) values ('stale_item_days', '7'), ('delayed_margin_pct', '25') on conflict (key) do nothing;

-- Named milestones the brief lists per service. A named item still open long after its service started raises a notice.
create table if not exists public.alert_special_items (label text primary key, milestone boolean not null default false);
alter table public.alert_special_items enable row level security;
revoke all on public.alert_special_items from anon, authenticated;
insert into public.alert_special_items (label, milestone)
select l, m from (values
  ('Trade name approved', true), ('Initial approval obtained', true), ('Initial approval received', true),
  ('External approvals obtained (if applicable)', false), ('MOA signed', false), ('Trade license issued', true),
  ('MOA and incorporation documents received', false), ('Incorporation documents delivered', false),
  ('Entry permit approved', true), ('Entry permit issued', true), ('Medical fitness completed', false),
  ('Medical fitness completed (where applicable)', false), ('Medical result received', false),
  ('Biometrics completed (if applicable)', false), ('Biometrics completed (if required)', false), ('Emirates ID issued', true),
  ('Residence visa issued', true), ('Client renewal confirmation received', false), ('Ejari / office documents checked (if applicable)', false),
  ('Payment received', false), ('Government fees paid', false), ('Renewed license received', true),
  ('New shareholder KYC collected', false), ('Shareholder KYC collected', false), ('Resolution signed', false), ('MOA amended', false),
  ('Regulatory approval obtained', true), ('Regulatory approvals obtained', true), ('Updated license received', true),
  ('Liquidation report received (where required)', false), ('Government dues cleared', false), ('Employee / labour obligations cleared', false),
  ('Visa cancellations completed', false), ('License cancellation certificate received', true)
) as v(l, m)
on conflict (label) do nothing;

insert into public.alert_rules (code, category, department, title_template, action_template, steps, enabled) values
  ('checkpoint_due', 'Deadlines', 'Business Setup', 'Due: {subject}', 'Complete this checklist item or update its due date.',
   '[{"days":1,"priority":"Medium"},{"days":0,"priority":"High"},{"days":-1,"priority":"High"},{"days":-3,"priority":"Critical"}]', false),
  ('checkpoint_client', 'Client Documents', 'Business Setup', 'Waiting on client: {subject}', 'Chase the client for what this item needs.',
   '[{"days":7,"priority":"Medium"},{"days":-1,"priority":"High"}]', false),
  ('checkpoint_authority', 'Government Applications', 'Business Setup', 'Waiting on authority: {subject}', 'Follow up with the authority.',
   '[{"days":7,"priority":"High"},{"days":-3,"priority":"Critical"}]', false),
  ('checkpoint_stale', 'Deadlines', 'Business Setup', 'Still open: {subject}', 'This step is still open. Move it on, or set a due date.',
   '[{"days":0,"priority":"Medium"},{"days":-7,"priority":"High"}]', false),
  ('service_expected', 'Deadlines', 'Business Setup', 'Service deadline: {subject}', 'Finish this service, or agree a new completion date.',
   '[{"days":7,"priority":"High"},{"days":-1,"priority":"High"},{"days":-3,"priority":"Critical"}]', false),
  ('service_delayed', 'Deadlines', 'Business Setup', 'Service behind plan: {subject}', 'Progress is behind the time used. Check what is holding it.',
   '[{"days":366,"priority":"High"}]', false),
  ('renewal_not_started', 'Licence', 'Business Setup', 'Renewal not started: {subject}', 'Start the licence renewal service.',
   '[{"days":30,"priority":"High"},{"days":-1,"priority":"Critical"}]', false),
  ('closure_pending', 'Deadlines', 'Business Setup', 'Ready to close: {subject}', 'Review the case and send it to Accounting.',
   '[{"days":3,"priority":"Normal"},{"days":-3,"priority":"Medium"}]', false),
  -- Raised by triggers as notices, then closed at once: never by the scan.
  ('service_assigned', 'Deadlines', 'Business Setup', 'New service: {subject}', 'You have been given this service.', '[]', false),
  ('service_completed', 'Deadlines', 'Business Setup', 'Service completed: {subject}', 'No action needed.', '[]', false),
  ('milestone_reached', 'Government Applications', 'Business Setup', 'Done: {subject}', 'No action needed.', '[]', false)
on conflict (code) do nothing;

create or replace function public.alert_bs_open_item() returns setof public.business_setup_service_checkpoints
language sql stable security definer set search_path = public, pg_temp as $$
  select x.* from business_setup_service_checkpoints x
  join business_setup_services s on s.id = x.service_id
  left join business_setup_kyc_profiles k on k.client_id = s.client_id
  where x.status not in ('Completed', 'Not Applicable')
    and coalesce(s.status, '') not in ('Completed', 'Cancelled') and not coalesce(s.historical, false)
    and coalesce(k.client_status, '') !~* 'liquidated|cancel|rejected'
$$;

create or replace function public.alert_bs_item_candidates(p_prefix text, p_statuses text[], p_due_from_start boolean) returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select p_prefix || ':' || x.id || ':' || coalesce(d.due::text, ''), s.client_id, concat_ws(' - ', x.label, s.name, m.legal_name), null::text, d.due,
         coalesce(x.assigned_to, s.owner_id, alert_owner(s.client_id, 'Business Setup')), null::uuid[], 'business_setup_service_checkpoints', x.id::text, s.id, null::text
  from alert_bs_open_item() x
  join business_setup_services s on s.id = x.service_id
  left join client_master m on m.client_id = s.client_id
  cross join lateral (select case when p_due_from_start then coalesce(x.due_date, (coalesce(x.started_at, x.updated_at) at time zone 'Asia/Dubai')::date + 7)
                                  else x.due_date end as due) d
  where p_statuses is null or x.status = any (p_statuses)
$$;

create or replace function public.alert_rule_checkpoint_due() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select * from alert_bs_item_candidates('checkpoint', array['Not Started', 'In Progress', 'On Hold', 'Reopened'], false)
$$;
create or replace function public.alert_rule_checkpoint_client() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select * from alert_bs_item_candidates('cpclient', array['Pending Client'], true)
$$;
create or replace function public.alert_rule_checkpoint_authority() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select * from alert_bs_item_candidates('cpauthority', array['Pending Authority'], true)
$$;

-- Only the named items, only with no due date of their own, counted from when the service started.
create or replace function public.alert_rule_checkpoint_stale() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select 'cpstale:' || x.id || ':' || d.due, s.client_id, concat_ws(' - ', x.label, s.name, m.legal_name), null::text, d.due,
         coalesce(x.assigned_to, s.owner_id, alert_owner(s.client_id, 'Business Setup')), null::uuid[], 'business_setup_service_checkpoints', x.id::text, s.id, null::text
  from alert_bs_open_item() x
  join alert_special_items sp on sp.label = x.label
  join business_setup_services s on s.id = x.service_id
  left join client_master m on m.client_id = s.client_id
  cross join lateral (select ((s.started_at at time zone 'Asia/Dubai')::date + alert_setting_int('stale_item_days', 7)) as due) d
  where x.due_date is null and s.started_at is not null and x.status in ('Not Started', 'In Progress', 'On Hold', 'Reopened')
$$;

create or replace function public.alert_bs_open_service() returns setof public.business_setup_services
language sql stable security definer set search_path = public, pg_temp as $$
  select s.* from business_setup_services s
  left join business_setup_kyc_profiles k on k.client_id = s.client_id
  where coalesce(s.status, '') not in ('Completed', 'Cancelled') and not coalesce(s.historical, false) and s.name is distinct from 'Visa Registration'
    and coalesce(k.client_status, '') !~* 'liquidated|cancel|rejected'
$$;

create or replace function public.alert_rule_service_expected() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select 'svcexpected:' || s.id || ':' || coalesce(s.expected_completion::text, ''), s.client_id, concat_ws(' - ', s.name, m.legal_name), null::text, s.expected_completion,
         coalesce(s.owner_id, alert_owner(s.client_id, 'Business Setup')), null::uuid[], 'business_setup_services', s.id::text, s.id, null::text
  from alert_bs_open_service() s left join client_master m on m.client_id = s.client_id
$$;

-- Behind plan: at least half the time used, and progress trailing it by the margin. Uses Business Setup's own progress figure.
create or replace function public.alert_rule_service_delayed() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  with t as (select (now() at time zone 'Asia/Dubai')::date as d)
  select 'svcdelayed:' || s.id || ':' || s.expected_completion, s.client_id,
         concat_ws(' - ', s.name, m.legal_name) || ' (' || p.done || '% done, ' || e.used || '% of time used)', null::text,
         (date_trunc('month', t.d) + interval '1 month - 1 day')::date,
         coalesce(s.owner_id, alert_owner(s.client_id, 'Business Setup')), null::uuid[], 'business_setup_services', s.id::text, s.id, null::text
  from alert_bs_open_service() s
  cross join t
  left join client_master m on m.client_id = s.client_id
  cross join lateral (select least(100, greatest(0, round(100.0 * (t.d - (s.started_at at time zone 'Asia/Dubai')::date)
                        / nullif(s.expected_completion - (s.started_at at time zone 'Asia/Dubai')::date, 0))))::int as used) e
  cross join lateral (select coalesce(business_setup_service_progress(s.id), 0) as done) p
  where s.started_at is not null and s.expected_completion is not null
    and s.expected_completion > (s.started_at at time zone 'Asia/Dubai')::date
    and e.used >= 50 and p.done < e.used - alert_setting_int('delayed_margin_pct', 25)
$$;

-- A licence close to expiry with no open renewal service for that client.
create or replace function public.alert_rule_renewal_not_started() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select 'renewal:' || k.client_id || ':' || l.d, k.client_id, m.legal_name, null::text, l.d,
         alert_owner(k.client_id, 'Business Setup'), null::uuid[], 'business_setup_kyc_profiles', k.client_id, null::uuid, null::text
  from business_setup_kyc_profiles k
  join client_master m on m.client_id = k.client_id
  cross join lateral (select coalesce(k.licence_expiry, business_setup_parse_date(m.data ->> 'License Expiry Date')) as d) l
  where l.d is not null and coalesce(k.client_status, '') !~* 'liquidated|cancel|rejected'
    and not exists (select 1 from alert_bs_open_service() s where s.client_id = k.client_id and s.name ~* 'renew' and s.name ~* 'licen')
$$;

create or replace function public.alert_rule_closure_pending() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select 'closure:' || c.id || ':' || d.due, c.client_id, concat_ws(' - ', c.case_number, m.legal_name), null::text, d.due,
         coalesce(c.owner_id, alert_owner(c.client_id, 'Business Setup')), null::uuid[], 'business_setup_cases', c.id::text, null::uuid, null::text
  from business_setup_cases c
  left join client_master m on m.client_id = c.client_id
  cross join lateral (select ((c.updated_at at time zone 'Asia/Dubai')::date + 3) as due) d
  where c.stage = 'Completion'
$$;

-- A notice: raised, belled under the usual rules, then closed at once by the system so no list fills up with them.
create or replace function public.alert_notice(p_rule text, p_key text, p_client text, p_subject text, p_user uuid, p_service uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if p_user is null then return; end if;
  v_id := alert_raise(p_rule, p_key, p_client, p_subject, 'Business Setup', (now() at time zone 'Asia/Dubai')::date, 0, 'Normal', p_user,
                      'business_setup_services', p_service::text, p_service, null);
  if v_id is not null then
    update alerts set status = 'Resolved', resolved_at = now(), resolved_by_system = true, resolution_note = 'Notice only.', updated_at = now()
    where id = v_id and status in ('Open', 'In progress');
  end if;
end $$;

-- Never blocks a Business Setup save: any error here is only a warning.
create or replace function public.alert_bs_service_events() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_name text;
begin
  begin
    if coalesce(new.historical, false) then return new; end if;
    select legal_name into v_name from client_master where client_id = new.client_id;
    if new.owner_id is not null and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id) then
      perform alert_notice('service_assigned', 'assigned:' || new.id || ':' || new.owner_id, new.client_id, concat_ws(' - ', new.name, v_name), new.owner_id, new.id);
    end if;
    if tg_op = 'UPDATE' and new.status = 'Completed' and old.status is distinct from 'Completed' then
      perform alert_notice('service_completed', 'completed:' || new.id, new.client_id, concat_ws(' - ', new.name, v_name), new.owner_id, new.id);
    end if;
  exception when others then
    raise warning 'alert_bs_service_events: %', sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists alert_bs_service_events on public.business_setup_services;
create trigger alert_bs_service_events after insert or update of owner_id, status on public.business_setup_services
  for each row execute function public.alert_bs_service_events();

create or replace function public.alert_bs_item_events() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare s business_setup_services; v_name text;
begin
  begin
    if new.status = 'Completed' and old.status is distinct from 'Completed'
       and exists (select 1 from alert_special_items sp where sp.label = new.label and sp.milestone) then
      select * into s from business_setup_services where id = new.service_id;
      select legal_name into v_name from client_master where client_id = s.client_id;
      perform alert_notice('milestone_reached', 'milestone:' || new.id, s.client_id, concat_ws(' - ', new.label, s.name, v_name), s.owner_id, s.id);
    end if;
  exception when others then
    raise warning 'alert_bs_item_events: %', sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists alert_bs_item_events on public.business_setup_service_checkpoints;
create trigger alert_bs_item_events after update of status on public.business_setup_service_checkpoints
  for each row execute function public.alert_bs_item_events();

revoke all on function public.alert_bs_open_item(), public.alert_bs_item_candidates(text, text[], boolean), public.alert_rule_checkpoint_due(),
  public.alert_rule_checkpoint_client(), public.alert_rule_checkpoint_authority(), public.alert_rule_checkpoint_stale(), public.alert_bs_open_service(),
  public.alert_rule_service_expected(), public.alert_rule_service_delayed(), public.alert_rule_renewal_not_started(), public.alert_rule_closure_pending(),
  public.alert_notice(text, text, text, text, uuid, uuid), public.alert_bs_service_events(), public.alert_bs_item_events() from public, anon, authenticated;
