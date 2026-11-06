-- Review fixes I5, I6, I7 and the minors.
-- Correction to 006's header: a register `reference` is kept out of alerts, bells, email and the scan log, but the Admin Base
-- audit trail copies whole rows on any table it is attached to, so there the reference reaches the locked audit trail.
-- Re-runnable. Rollback: rollback/015_018_rollback.sql.

-- ── Minor: the register is read through client_compliance_list only ──
revoke select on public.client_compliance_items from authenticated;

-- ── I5: type and client cannot change on an existing entry ───────────
-- 016's save, plus that refusal.
create or replace function public.client_compliance_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_old public.client_compliance_items%rowtype;
  v_client text; v_type text; v_status text; v_person text;
  v_issue date; v_exp date; v_rev date;
begin
  if not client_compliance_can_write() then raise exception 'You do not have permission to change the compliance register.'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'A register entry must be a JSON object.'; end if;

  begin
    v_id := nullif(btrim(p->>'id'), '')::uuid;
  exception when invalid_text_representation then
    raise exception 'The register id is not valid.';
  end;
  if v_id is not null then
    select * into v_old from client_compliance_items where id = v_id for update;
    if not found then raise exception 'That register entry does not exist.'; end if;
  end if;

  v_client := case when p ? 'client_id' then nullif(btrim(p->>'client_id'), '') else v_old.client_id end;
  v_type := case when p ? 'item_type' then nullif(btrim(p->>'item_type'), '') else v_old.item_type end;
  if v_id is not null and (v_client is distinct from v_old.client_id or v_type is distinct from v_old.item_type) then
    raise exception 'Close this entry and add a new one.';
  end if;
  if v_client is null or not exists (select 1 from client_master where client_id = v_client) then raise exception 'Unknown client.'; end if;
  if v_type is null or not (v_type = any (client_compliance_item_types())) then raise exception 'Unknown item type.'; end if;

  begin
    v_issue := case when p ? 'issue_date' then nullif(btrim(p->>'issue_date'), '')::date else v_old.issue_date end;
    v_exp := case when p ? 'expiry_date' then nullif(btrim(p->>'expiry_date'), '')::date else v_old.expiry_date end;
    v_rev := case when p ? 'next_review_date' then nullif(btrim(p->>'next_review_date'), '')::date else v_old.next_review_date end;
  exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
    raise exception 'Dates must be real dates, written YYYY-MM-DD.';
  end;
  if v_issue is not null and v_exp is not null and v_exp < v_issue then raise exception 'The expiry date is before the issue date.'; end if;

  v_status := case when p ? 'status' then nullif(btrim(p->>'status'), '') else v_old.status end;
  v_status := coalesce(v_status, 'Active');
  if v_status not in ('Active', 'Closed') then raise exception 'Status must be Active or Closed.'; end if;
  if v_status = 'Closed' and v_old.status is distinct from 'Closed' then raise exception 'Use Close to close an entry: it needs a reason.'; end if;

  v_person := case when p ? 'person_name' then nullif(btrim(p->>'person_name'), '') else v_old.person_name end;
  if v_status = 'Active' and exists (
    select 1 from client_compliance_items i
    where i.status = 'Active' and i.client_id = v_client and i.item_type = v_type
      and lower(coalesce(btrim(i.person_name), '')) = lower(coalesce(v_person, ''))
      and i.expiry_date is not distinct from v_exp
      and i.id is distinct from v_id) then
    raise exception 'This entry is already on the register: same client, type, person and expiry date.';
  end if;

  if v_id is null then
    insert into client_compliance_items (client_id, item_type, person_name, reference, issue_date, expiry_date, next_review_date, status, source, notes, created_by, updated_by)
    values (v_client, v_type, nullif(btrim(p->>'person_name'), ''), nullif(btrim(p->>'reference'), ''), v_issue, v_exp, v_rev, v_status,
            nullif(btrim(p->>'source'), ''), nullif(btrim(p->>'notes'), ''), auth.uid(), auth.uid())
    returning id into v_id;
  else
    update client_compliance_items set
      client_id = v_client, item_type = v_type,
      person_name = case when p ? 'person_name' then nullif(btrim(p->>'person_name'), '') else person_name end,
      reference = case when p ? 'reference' then nullif(btrim(p->>'reference'), '') else reference end,
      issue_date = v_issue, expiry_date = v_exp, next_review_date = v_rev, status = v_status,
      source = case when p ? 'source' then nullif(btrim(p->>'source'), '') else source end,
      notes = case when p ? 'notes' then nullif(btrim(p->>'notes'), '') else notes end,
      updated_at = now(), updated_by = auth.uid()
    where id = v_id;
  end if;
  return v_id;
end $$;

-- ── I6, I7: rolling rules ────────────────────────────────────────────
-- Keys carry a period, so a person's close holds for that period only. Due is the end of the period, and one wide step
-- always matches, so these never read as overdue. On the last day of the period due_date is today, so they read as due today.
create or replace function public.alert_rule_multiple_services() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select 'multiservices:' || s.client_id || ':' || to_char(t.d, 'YYYY-MM'), s.client_id, m.legal_name || ' (' || count(*) || ')', null::text,
         (date_trunc('month', t.d) + interval '1 month - 1 day')::date,
         alert_owner(s.client_id, 'Business Setup'), null::uuid[], 'client_master', s.client_id, null::uuid, null::text
  from business_setup_services s join client_master m on m.client_id = s.client_id
  left join business_setup_kyc_profiles k on k.client_id = s.client_id
  cross join (select (now() at time zone 'Asia/Dubai')::date as d) t
  where coalesce(s.status, '') not in ('Completed', 'Cancelled') and not coalesce(s.historical, false) and s.name is distinct from 'Visa Registration'
    and coalesce(k.client_status, '') !~* 'liquidated|cancel|rejected'
  group by s.client_id, m.legal_name, t.d
  having count(*) >= 2
$$;

create or replace function public.alert_contact_gap(p_rule text, p_days int) returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select p_rule || ':' || c.client_id || ':' || c.last_on, c.client_id, m.legal_name, null::text,
         (date_trunc('month', (now() at time zone 'Asia/Dubai')::date) + interval '1 month - 1 day')::date,
         alert_owner(c.client_id, 'Business Setup'), null::uuid[], 'client_contacts', c.client_id, null::uuid, null::text
  from (select client_id, max(contacted_on) as last_on from client_contacts group by client_id) c
  join client_master m on m.client_id = c.client_id
  left join business_setup_kyc_profiles k on k.client_id = c.client_id
  where c.last_on < (now() at time zone 'Asia/Dubai')::date - p_days
    and coalesce(k.client_status, '') !~* 'liquidated|cancel|rejected'
$$;

create or replace function public.alert_rule_ct_dereg_review() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select 'ctdereg:' || k.client_id || ':' || to_char(t.d, 'YYYY'), k.client_id, m.legal_name, null::text,
         make_date(extract(year from t.d)::int, 12, 31),
         alert_owner(k.client_id, 'Tax Compliance'), null::uuid[], 'business_setup_kyc_profiles', k.client_id, null::uuid, null::text
  from business_setup_kyc_profiles k join client_master m on m.client_id = k.client_id
  cross join (select (now() at time zone 'Asia/Dubai')::date as d) t
  where k.client_status ~* 'liquidated|cancel' and k.licence_extras ->> 'ct_reg' = 'Done'
$$;

-- Only where the steps are still the 011 to 013 seed.
update public.alert_rules set steps = '[{"days":366,"priority":"Normal"}]' where code = 'multiple_services' and steps = '[{"days":0,"priority":"Normal"}]';
update public.alert_rules set steps = '[{"days":366,"priority":"Medium"}]' where code in ('client_not_contacted', 'client_inactive', 'ct_dereg_review') and steps = '[{"days":0,"priority":"Medium"}]';

-- Open alerts move to the new key and step here. Otherwise the next scan closes each one and raises a new one, or sees a step change: either way a fresh bell.
update public.alerts a set dedupe_key = 'multiservices:' || a.client_id || ':' || to_char((now() at time zone 'Asia/Dubai')::date, 'YYYY-MM'), updated_at = now()
where a.rule_code = 'multiple_services' and a.status in ('Open', 'In progress') and a.dedupe_key = 'multiservices:' || a.client_id
  and not exists (select 1 from public.alerts o where o.dedupe_key = 'multiservices:' || a.client_id || ':' || to_char((now() at time zone 'Asia/Dubai')::date, 'YYYY-MM'));
update public.alerts a set dedupe_key = p.prefix || ':' || a.client_id || ':' || c.last_on, updated_at = now()
from (values ('client_not_contacted', 'notcontacted'), ('client_inactive', 'inactive')) as p(rule, prefix),
     (select client_id, max(contacted_on) as last_on from public.client_contacts group by client_id) c
where a.rule_code = p.rule and c.client_id = a.client_id and a.status in ('Open', 'In progress') and a.dedupe_key = p.prefix || ':' || a.client_id
  and not exists (select 1 from public.alerts o where o.dedupe_key = p.prefix || ':' || a.client_id || ':' || c.last_on);
update public.alerts a set dedupe_key = 'ctdereg:' || a.client_id || ':' || to_char((now() at time zone 'Asia/Dubai')::date, 'YYYY'), updated_at = now()
where a.rule_code = 'ct_dereg_review' and a.status in ('Open', 'In progress') and a.dedupe_key = 'ctdereg:' || a.client_id
  and not exists (select 1 from public.alerts o where o.dedupe_key = 'ctdereg:' || a.client_id || ':' || to_char((now() at time zone 'Asia/Dubai')::date, 'YYYY'));
update public.alerts a set current_step = 366, updated_at = now(),
       due_date = case when a.rule_code = 'ct_dereg_review' then make_date(extract(year from (now() at time zone 'Asia/Dubai')::date)::int, 12, 31)
                       else (date_trunc('month', (now() at time zone 'Asia/Dubai')::date) + interval '1 month - 1 day')::date end
from public.alert_rules r
where a.rule_code = r.code and r.code in ('multiple_services', 'client_not_contacted', 'client_inactive', 'ct_dereg_review')
  and a.status in ('Open', 'In progress') and a.current_step is distinct from 366
  and jsonb_array_length(r.steps) = 1 and (r.steps->0->>'days')::int = 366;

-- ── Minors: rule filters and titles ──────────────────────────────────
create or replace function public.alert_rule_contact_followup() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select 'contact:' || c.id || ':' || coalesce(c.follow_up_on::text, ''), c.client_id, m.legal_name, null::text, c.follow_up_on,
         coalesce(alert_owner(c.client_id, 'Business Setup'), c.created_by), null::uuid[], 'client_contacts', c.id::text, null::uuid, null::text
  from (select distinct on (client_id) * from client_contacts order by client_id, contacted_on desc, created_at desc) c
  join client_master m on m.client_id = c.client_id
  left join business_setup_kyc_profiles k on k.client_id = c.client_id
  where coalesce(k.client_status, '') !~* 'liquidated|cancel|rejected'
$$;

create or replace function public.alert_rule_job_followup() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select 'jobfollowup:' || j.id || ':' || coalesce(j.next_follow_up_on::text, ''), j.client_id, concat_ws(' - ', j.service_name, j.client_name),
         coalesce(j.service_department, 'Accounting'), j.next_follow_up_on,
         coalesce(v.ids[1], alert_owner(j.client_id, coalesce(j.service_department, 'Accounting'))), case when cardinality(v.ids) > 1 then v.ids[2:] end,
         'accounting_jobs', j.id::text, null::uuid, null::text
  from accounting_job_list j
  left join business_setup_kyc_profiles k on k.client_id = j.client_id
  cross join lateral (select array(select u.uid from unnest(j.assignee_ids) with ordinality as u(uid, ord) join profiles p on p.id = u.uid order by u.ord) as ids) v
  where coalesce(j.work_status, '') not in ('Completed', 'Client Cancelled')
    and coalesce(k.client_status, '') !~* 'liquidated|cancel|rejected'
$$;

create or replace function public.alert_rule_document_request() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select 'docrequest:' || r.id || ':' || r.due_on, r.client_id, concat_ws(' - ', r.what, m.legal_name), null::text, r.due_on,
         coalesce(alert_owner(r.client_id, 'Business Setup'), r.created_by), null::uuid[], 'client_document_requests', r.id::text, null::uuid, null::text
  from client_document_requests r join client_master m on m.client_id = r.client_id
  left join business_setup_kyc_profiles k on k.client_id = r.client_id
  where r.status = 'Open' and coalesce(k.client_status, '') !~* 'liquidated|cancel|rejected'
$$;

-- As the job rules in 002: a Completed or Client Cancelled job raises nothing, here as well.
create or replace function public.alert_rule_job_payment_due() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select 'jobpayment:' || j.id || ':' || coalesce((j.invoice_date + alert_payment_terms())::text, ''), j.client_id, concat_ws(' - ', j.service_name, j.client_name),
         coalesce(j.service_department, 'Accounting'), j.invoice_date + alert_payment_terms(),
         coalesce(v.ids[1], alert_owner(j.client_id, coalesce(j.service_department, 'Accounting'))), case when cardinality(v.ids) > 1 then v.ids[2:] end,
         'accounting_jobs', j.id::text, null::uuid, null::text
  from accounting_job_list j
  cross join lateral (select array(select u.uid from unnest(j.assignee_ids) with ordinality as u(uid, ord) join profiles p on p.id = u.uid order by u.ord) as ids) v
  where coalesce(j.balance, 0) > 0 and coalesce(j.work_status, '') not in ('Completed', 'Client Cancelled')
$$;

-- Payments cover the oldest invoices first, so what stays unpaid sits on the newest. Worked back from the newest:
-- an invoice is overdue while the invoices newer than it do not yet account for all that is unpaid on the quote.
create or replace function public.alert_rule_setup_invoice_due() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select 'setupinvoice:' || i.id || ':' || (i.issued_on + alert_payment_terms()), i.client_id, concat_ws(' - ', i.invoice_number, m.legal_name), null::text,
         i.issued_on + alert_payment_terms(), alert_owner(i.client_id, 'Business Setup'), null::uuid[], 'business_setup_invoices', i.id::text, null::uuid, null::text
  from (select x.*, sum(coalesce(x.amount, 0)) over (partition by x.quote_id) as total,
               coalesce(sum(coalesce(x.amount, 0)) over (partition by x.quote_id order by x.issued_on desc nulls first, x.invoice_number desc, x.id desc
                                                          rows between unbounded preceding and 1 preceding), 0) as newer
        from business_setup_invoices x where x.quote_id is not null) i
  join client_master m on m.client_id = i.client_id
  left join business_setup_kyc_profiles k on k.client_id = i.client_id
  where i.issued_on is not null and coalesce(i.amount, 0) > 0
    and i.newer < i.total - business_setup_net_paid(i.quote_id)
    and coalesce(k.client_status, '') !~* 'liquidated|cancel|rejected'
$$;

create or replace function public.alert_rule_tax_deadline() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select 'tax:' || t.item_key || ':' || t.due_date, t.client_id, concat_ws(' - ', t.title, m.legal_name), null::text, t.due_date,
         alert_owner(t.client_id, 'Tax Compliance'), null::uuid[], 'alert_tax_items', t.item_key, null::uuid, null::text
  from alert_tax_items t join client_master m on m.client_id = t.client_id
  left join business_setup_kyc_profiles k on k.client_id = t.client_id
  where coalesce(k.client_status, '') !~* 'liquidated|cancel|rejected'
$$;

-- 015's, with concat_ws for the title.
create or replace function public.alert_manual_raise(p_type text, p_client text, p_detail text default null, p_due date default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_t jsonb; v_name text; v_dept text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to log an item.'; end if;
  if not client_work_can(p_client) then raise exception 'You do not have permission to work on this client.'; end if;
  select e into v_t from jsonb_array_elements(alert_manual_types()) e where e->>'type' = p_type;
  if v_t is null then raise exception 'Unknown item type.'; end if;
  select legal_name into v_name from client_master where client_id = p_client;
  if v_name is null then raise exception 'Unknown client.'; end if;
  select department into v_dept from alert_rules where code = v_t->>'rule';
  v_id := alert_raise(v_t->>'rule', 'manual:' || gen_random_uuid(), p_client, concat_ws(' - ', p_type, v_name), v_dept,
                      coalesce(p_due, (now() at time zone 'Asia/Dubai')::date + 7), 0, v_t->>'priority',
                      coalesce(alert_owner(p_client, v_dept), auth.uid()), 'client_master', p_client, null, nullif(btrim(p_detail), ''));
  return v_id;
end $$;

-- 010's, with concat_ws for the title.
create or replace function public.regulatory_create_tasks(p_id uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_u regulatory_updates%rowtype; r record; v_alert uuid; v_n int := 0;
begin
  perform regulatory_require_manage();
  select * into v_u from regulatory_updates where id = p_id for update;
  if not found then raise exception 'That update does not exist.'; end if;
  if v_u.workflow_status <> 'Verified' or v_u.verified_at is null then raise exception 'Only a verified update can create tasks.'; end if;
  if v_u.effective_date is null then raise exception 'Confirm the effective date first.'; end if;
  if v_u.applicability = '{}'::jsonb then raise exception 'Set who this applies to first.'; end if;
  for r in
    select c.client_id, m.legal_name from regulatory_update_clients c join client_master m on m.client_id = c.client_id
    where c.update_id = p_id and c.decision = 'Applies' order by c.client_id
  loop
    v_alert := alert_raise('regulatory_impact', 'regulatory:' || p_id || ':' || r.client_id, r.client_id, concat_ws(' - ', v_u.title, r.legal_name), 'Business Setup',
                           v_u.effective_date, 0, 'High', alert_owner(r.client_id, 'Business Setup'), 'regulatory_updates', p_id::text);
    update alerts set regulatory_update_id = p_id where id = v_alert;
    update regulatory_update_clients set alert_id = v_alert where update_id = p_id and client_id = r.client_id;
    v_n := v_n + 1;
  end loop;
  update regulatory_updates set workflow_status = case when v_n = 0 then 'Closed' else 'Tasks created' end, updated_at = now() where id = p_id;
  return v_n;
end $$;

-- ── Minor: rules raised by their own screens are not edited here ─────
-- 016's alert_rule_save, plus that refusal.
create or replace function public.alert_rule_save(p_code text, p_enabled boolean, p_steps jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s jsonb; v_enabled boolean; v_was boolean; v_today date := (now() at time zone 'Asia/Dubai')::date;
begin
  if not alert_is_admin() then raise exception 'You do not have permission to change alert rules.'; end if;
  if p_code like 'regulatory\_%' or p_code like 'manual\_%' then raise exception 'This rule is raised by its own screen, so it cannot be changed here.'; end if;
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' then raise exception 'Steps must be a list.'; end if;
  for s in select value from jsonb_array_elements(p_steps) loop
    if jsonb_typeof(s) <> 'object' or jsonb_typeof(s->'days') is distinct from 'number' or (s->>'days') !~ '^-?[0-9]+$' then
      raise exception 'Each step needs a whole number of days.';
    end if;
    if jsonb_typeof(s->'priority') is distinct from 'string' or (s->>'priority') not in ('Critical', 'High', 'Medium', 'Normal') then
      raise exception 'Step priority must be Critical, High, Medium or Normal.';
    end if;
  end loop;
  if (select count(*) <> count(distinct e->>'days') from jsonb_array_elements(p_steps) e) then
    raise exception 'Two steps cannot have the same days.';
  end if;
  select enabled, coalesce(p_enabled, enabled) into v_was, v_enabled from alert_rules where code = p_code;
  if not found then raise exception 'That alert rule does not exist.'; end if;
  if v_enabled and jsonb_array_length(p_steps) = 0 then raise exception 'An enabled rule needs at least one step.'; end if;
  update alert_rules set enabled = v_enabled, steps = p_steps,
         baseline_pending = baseline_pending or (v_enabled and not v_was)
  where code = p_code;

  with moved as (
    select a.id, a.current_step as old_step, n.step as new_step
    from alerts a
    cross join lateral alert_step_for(p_steps, a.due_date - v_today) n
    where a.rule_code = p_code and a.status in ('Open', 'In progress') and a.due_date is not null
      and a.current_step is distinct from n.step
  ), upd as (
    update alerts a set current_step = m.new_step, updated_at = now() from moved m where a.id = m.id
  )
  insert into alert_events (alert_id, event, detail)
  select m.id, 'step recomputed', jsonb_build_object('from', m.old_step, 'to', m.new_step, 'by', auth.uid()) from moved m;
end $$;
