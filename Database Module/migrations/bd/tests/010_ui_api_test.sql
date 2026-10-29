-- LOCAL TEST ONLY: runs the BD UI flow through the 003 functions as signed-in users.
-- Each check prints PASS/FAIL. Run with: psql -v ON_ERROR_STOP=1 -f 010_ui_api_test.sql
\set QUIET on
\pset tuples_only on
\pset format unaligned

-- test users: a manager (CRM admin) and two sales executives
insert into public.profiles (id, full_name, email, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Test Manager', 'manager@example.com', 'admin'),
  ('00000000-0000-0000-0000-0000000000b1', 'Test Exec One', 'exec1@example.com', 'member'),
  ('00000000-0000-0000-0000-0000000000b2', 'Test Exec Two', 'exec2@example.com', 'member')
on conflict (id) do nothing;

create temp table t_result (n serial, name text, ok boolean, detail text);
grant all on t_result to authenticated;
grant usage on sequence t_result_n_seq to authenticated;
create temp table t_ids (k text primary key, v text);
grant all on t_ids to authenticated;

-- expect an error whose message contains p_like
create or replace function pg_temp.expect_error(p_name text, p_sql text, p_like text) returns void language plpgsql as $$
begin
  execute p_sql;
  insert into t_result (name, ok, detail) values (p_name, false, 'no error raised');
exception when others then
  insert into t_result (name, ok, detail) values (p_name, sqlerrm ilike '%' || p_like || '%', sqlerrm);
end $$;
create or replace function pg_temp.check(p_name text, p_ok boolean, p_detail text default null) returns void language sql as $$
  insert into t_result (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail)
$$;

-- ── as Exec One ──────────────────────────────────────────────────────
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';

select pg_temp.check('roles synced from profiles', public.bd_current_role() = 'sales_executive', public.bd_current_role());

do $$ declare r jsonb; begin
  r := public.bd_create_lead(
    '{"lead_type":"company","name":"Example Trading LLC","contact_name":"Sample Contact","mobile":"+971 50 000 0001",
      "email":" info@example.com ","source":"Meta Ads","campaign_name":"Test Campaign Q4","source_detail":"Lead form",
      "acquired_by":"00000000-0000-0000-0000-0000000000b1","current_owner":"00000000-0000-0000-0000-0000000000b1",
      "initial_service_interest":"Bookkeeping","initial_summary":"Needs monthly bookkeeping and VAT filing support.",
      "estimated_budget":2500,"budget_currency":"AED","priority":"Medium","duplicate_exception":false}',
    '{"channel":"Phone Call","direction":"outbound","summary":"Needs monthly bookkeeping and VAT filing support.",
      "services_discussed":["Bookkeeping"],"interest_level":"Interested"}',
    '{"planned_at":"2026-11-02T10:00:00+04:00","channel":"Phone Call","objective":"Follow up on initial discussion"}');
  insert into t_ids values ('lead', r->>'id');
  perform pg_temp.check('create lead returns UI shape',
    r->>'status' = 'active' and r->>'stage' = 'New Lead' and r->>'source' = 'Meta Ads' and r->>'priority' = 'Medium'
    and r->>'lead_id' like 'LD-2026-%' and r->>'campaign_name' = 'Test Campaign Q4'
    and jsonb_array_length(r->'bd_lead_activities') = 1 and jsonb_array_length(r->'bd_lead_followups') = 1
    and r->'bd_lead_activities'->0->>'channel' = 'Phone Call' and r->>'next_followup_at' is not null, r::text);
end $$;

select pg_temp.expect_error('duplicate lead blocked',
  $q$select public.bd_create_lead('{"name":"Other Name","mobile":"050 000 0001","source":"Direct",
     "acquired_by":"00000000-0000-0000-0000-0000000000b1","current_owner":"00000000-0000-0000-0000-0000000000b1"}',
     '{"summary":"Second enquiry from the same phone number."}','{"planned_at":"2026-11-03T10:00:00+04:00"}')$q$,
  'possible matching lead');
select pg_temp.expect_error('exec cannot approve duplicate',
  $q$select public.bd_create_lead('{"name":"Other Name","email":"INFO@example.com","source":"Direct","duplicate_exception":true,
     "acquired_by":"00000000-0000-0000-0000-0000000000b1","current_owner":"00000000-0000-0000-0000-0000000000b1"}',
     '{"summary":"Second enquiry from the same email address."}','{"planned_at":"2026-11-03T10:00:00+04:00"}')$q$,
  'Only a manager');
select pg_temp.expect_error('exec cannot assign others',
  $q$select public.bd_create_lead('{"name":"Third Prospect","email":"third@example.com","source":"Direct",
     "acquired_by":"00000000-0000-0000-0000-0000000000b1","current_owner":"00000000-0000-0000-0000-0000000000b2"}',
     '{"summary":"Enquiry about corporate tax registration."}','{"planned_at":"2026-11-03T10:00:00+04:00"}')$q$,
  'Only a manager or team leader');
select pg_temp.expect_error('generic summary rejected',
  $q$select public.bd_create_lead('{"name":"Fourth Prospect","email":"fourth@example.com","source":"Direct",
     "acquired_by":"00000000-0000-0000-0000-0000000000b1","current_owner":"00000000-0000-0000-0000-0000000000b1"}',
     '{"summary":"Called client"}','{"planned_at":"2026-11-03T10:00:00+04:00"}')$q$,
  'meaningful');
select pg_temp.expect_error('campaign source needs campaign',
  $q$select public.bd_create_lead('{"name":"Fifth Prospect","email":"fifth@example.com","source":"Google Ads",
     "acquired_by":"00000000-0000-0000-0000-0000000000b1","current_owner":"00000000-0000-0000-0000-0000000000b1"}',
     '{"summary":"Asked about audit for the 2025 financial year."}','{"planned_at":"2026-11-03T10:00:00+04:00"}')$q$,
  'campaign name');

select pg_temp.expect_error('direct table write blocked',
  $q$update public.bd_leads set priority = 'High'$q$, 'permission denied');
select pg_temp.expect_error('proposal stage needs a proposed fee',
  format($q$select public.bd_change_stage(%L, 'Proposal Sent')$q$, (select v from t_ids where k = 'lead')), 'proposed fee');

do $$ declare r jsonb; l uuid := (select v from t_ids where k = 'lead'); begin
  r := public.bd_save_service(jsonb_build_object('lead_id', l, 'service_name', 'Bookkeeping', 'status', 'quoted',
         'billing_frequency', 'monthly', 'currency', 'AED', 'client_budget', 2000, 'proposed_fee', 1800,
         'quantity_scope', 'Up to 150 transactions a month'));
  insert into t_ids values ('svc', r->'bd_lead_services'->0->>'id');
  perform pg_temp.check('add service (UI fields)',
    r->'bd_lead_services'->0->>'service_name' = 'Bookkeeping' and r->'bd_lead_services'->0->>'billing_frequency' = 'monthly'
    and r->'bd_lead_services'->0->>'status' = 'quoted' and (r->'bd_lead_services'->0->>'proposed_fee')::numeric = 1800, r::text);
  r := public.bd_change_stage(l, 'Proposal Sent');
  perform pg_temp.check('stage change + history', r->>'stage' = 'Proposal Sent'
    and (select count(*) from public.bd_lead_stage_history where lead_id = l) = 2
    and (select duration_in_previous_stage_seconds from public.bd_lead_stage_history where lead_id = l
         order by changed_at desc limit 1) is not null, r->>'stage');
  r := public.bd_log_activity(jsonb_build_object('lead_id', l, 'channel', 'Video Meeting', 'direction', 'outbound',
         'contact_person', 'Sample Contact', 'summary', 'Walked through the proposal; client wants a 10% discount.',
         'next_action', 'Send revised quotation', 'next_followup_at', '2026-11-01T09:00:00+04:00'));
  perform pg_temp.check('log activity + follow-up, next follow-up = earliest open',
    jsonb_array_length(r->'bd_lead_activities') = 2 and jsonb_array_length(r->'bd_lead_followups') = 2
    and (r->>'next_followup_at')::timestamptz = '2026-11-01T09:00:00+04:00'::timestamptz, r->>'next_followup_at');
end $$;

select pg_temp.expect_error('accepted service needs final fee',
  format($q$select public.bd_save_service(jsonb_build_object('id', %L, 'service_name', 'Bookkeeping', 'status', 'accepted',
     'billing_frequency', 'monthly'))$q$, (select v from t_ids where k = 'svc')), 'final agreed fee');
select pg_temp.expect_error('won needs accepted service',
  format($q$select public.bd_mark_lead_won(%L, '{"confirmation_contact":"Sample Contact","handover_notes":"Ready"}')$q$,
         (select v from t_ids where k = 'lead')), 'accepted service');

do $$ declare r jsonb; l uuid := (select v from t_ids where k = 'lead');
  f uuid := (select id from public.bd_followups where lead_id = (select v from t_ids where k = 'lead')::uuid
             and status = 'Scheduled' order by scheduled_at limit 1); begin
  r := public.bd_complete_followup(f, '{"discussion_summary":"Sent the revised quotation with the agreed discount."}');
  perform pg_temp.check('complete follow-up keeps the other open one',
    (r->>'next_followup_at')::timestamptz = '2026-11-02T10:00:00+04:00'::timestamptz
    and exists (select 1 from public.bd_followup_history h where h.followup_id = f and h.action = 'Completed'), r->>'next_followup_at');
  r := public.bd_save_service(jsonb_build_object('id', (select v from t_ids where k = 'svc'), 'service_name', 'Bookkeeping',
         'status', 'accepted', 'billing_frequency', 'monthly', 'currency', 'AED', 'proposed_fee', 1800, 'final_agreed_fee', 1620));
  r := public.bd_mark_lead_won(l, '{"confirmation_contact":"Sample Contact","handover_notes":"Start in November.",
         "agreement_reference":"Signed proposal","idempotency_key":"won-test-1"}');
  perform pg_temp.check('mark won creates handover',
    r->>'status' = 'won' and r->>'stage' = 'Won — Pending Onboarding' and (r->>'won_value')::numeric = 1620
    and r->>'won_currency' = 'AED' and jsonb_array_length(r->'bd_onboarding_handoffs') = 1
    and r->'bd_onboarding_handoffs'->0->>'status' = 'pending' and r->>'next_followup_at' is null
    and r->>'closed_by' = '00000000-0000-0000-0000-0000000000b1', r::text);
  r := public.bd_mark_lead_won(l, '{"confirmation_contact":"Sample Contact","handover_notes":"Start in November.",
         "idempotency_key":"won-test-1"}');
  perform pg_temp.check('won retry is idempotent',
    (select count(*) from public.bd_onboarding_handovers where lead_id = l) = 1 and r->>'status' = 'won', null);
end $$;

select pg_temp.expect_error('service terms locked after won',
  format($q$select public.bd_save_service(jsonb_build_object('id', %L, 'service_name', 'Bookkeeping', 'status', 'accepted',
     'billing_frequency', 'monthly', 'final_agreed_fee', 1))$q$, (select v from t_ids where k = 'svc')), 'after the lead is marked won');
select pg_temp.expect_error('exec cannot reopen',
  format($q$select public.bd_reopen_lead(%L, 'Client changed mind')$q$, (select v from t_ids where k = 'lead')), 'Only a BD manager');

-- ── as Exec Two: cannot see Exec One's lead ──────────────────────────
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.check('other exec sees no leads', jsonb_array_length(public.bd_ui_leads()) = 0
  and (select count(*) from public.bd_leads) = 0 and public.bd_lead_ui_json((select v from t_ids where k = 'lead')::uuid) is null);

do $$ declare r jsonb; begin
  r := public.bd_create_lead(
    '{"lead_type":"individual","name":"Sample Individual","email":"individual@example.com","source":"Client Referral",
      "source_detail":"Referred by an existing client","acquired_by":"00000000-0000-0000-0000-0000000000b2",
      "current_owner":"00000000-0000-0000-0000-0000000000b2","initial_summary":"Wants help registering for corporate tax."}',
    '{"channel":"WhatsApp","summary":"Wants help registering for corporate tax."}',
    '{"planned_at":"2026-11-04T11:00:00+04:00","channel":"WhatsApp"}');
  insert into t_ids values ('lead2', r->>'id');
  r := public.bd_mark_lead_lost((r->>'id')::uuid, 'Price Too High', null);
  perform pg_temp.check('mark lost', r->>'status' = 'lost' and r->>'lost_reason' = 'Price Too High'
    and r->>'next_followup_at' is null, r::text);
end $$;
select pg_temp.expect_error('unknown lead blocked',
  $q$select public.bd_mark_lead_lost(gen_random_uuid(), 'Other', '')$q$, 'permission');

-- ── as the Manager: sees everything, can reopen ──────────────────────
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.check('manager is super_admin and sees both leads',
  public.bd_current_role() = 'super_admin' and jsonb_array_length(public.bd_ui_leads()) = 2, public.bd_current_role());
do $$ declare r jsonb; begin
  r := public.bd_reopen_lead((select v from t_ids where k = 'lead2')::uuid, 'Client asked for a revised offer', 'Qualified');
  perform pg_temp.check('reopen keeps history', r->>'status' = 'active' and r->>'stage' = 'Qualified'
    and (select count(*) from public.bd_lead_stage_history where lead_id = (r->>'id')::uuid) = 3, r->>'stage');
end $$;
select pg_temp.check('audit log written', (select count(*) from public.bd_audit_logs) >= 10,
                     (select count(*)::text from public.bd_audit_logs));

reset role;
\pset tuples_only off
select n, case when ok then 'PASS' else 'FAIL' end as result, name, case when not ok then left(detail, 300) end as detail
from t_result order by n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from t_result;
