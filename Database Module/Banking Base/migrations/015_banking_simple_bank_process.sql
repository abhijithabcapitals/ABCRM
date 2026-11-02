-- =====================================================================
-- Banking Base - simple bank process and client bank details       015
-- =====================================================================
-- After the engagement letter, staff record only: submitted, replies from the bank, resubmitted, then rejected or
-- account opened. No stage is renumbered: 14-18 stay in the data and the screens show them as one follow-up step.
-- Account details are saved against the client when the case is completed, then the case goes to Accounts.
-- Idempotent: safe to re-run. Re-running 001 restores the old audit mask, so run this file again after it.
-- Undo: rollback/015_rollback.sql.
-- Full account numbers are readable with cases.view for now; access is to be tightened later (user's decision, 02/11/2026).
-- =====================================================================
alter table public.banking_application_status_history add column if not exists event_kind text;
alter table public.banking_application_status_history add column if not exists event_date date;
alter table public.banking_application_status_history add column if not exists reply text;
alter table public.banking_application_status_history add column if not exists documents jsonb;

create table if not exists public.banking_client_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.banking_clients(id),
  case_id uuid not null unique references public.banking_cases(id),
  application_id uuid references public.banking_applications(id),
  bank_id uuid references public.banking_partners(id),
  account_number text, iban text, account_name text, branch text, currency text default 'AED',
  opened_on date, relationship_manager text, welcome_letter_path text, welcome_letter_name text, remarks text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index if not exists banking_client_accounts_client_idx on public.banking_client_accounts (client_id);
alter table public.banking_client_accounts enable row level security;
revoke all on public.banking_client_accounts from anon, authenticated;
grant select on public.banking_client_accounts to authenticated;
drop policy if exists banking_client_accounts_read on public.banking_client_accounts;
create policy banking_client_accounts_read on public.banking_client_accounts for select to authenticated using (public.banking_can('cases.view') and public.banking_case_visible(case_id));

drop trigger if exists banking_client_accounts_touch on public.banking_client_accounts;
create trigger banking_client_accounts_touch before insert or update on public.banking_client_accounts for each row execute function public.banking_touch();
drop trigger if exists banking_client_accounts_audit on public.banking_client_accounts;
create trigger banking_client_accounts_audit after insert or update or delete on public.banking_client_accounts for each row execute function public.banking_audit();
drop trigger if exists banking_client_accounts_case_lock on public.banking_client_accounts;
create trigger banking_client_accounts_case_lock before insert or update or delete on public.banking_client_accounts for each row execute function public.banking_case_lock();

-- The activity log cannot be edited later, so account numbers are masked there from the start.
create or replace function public.banking_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  masked text[] := array['passport_number','emirates_id','passport_expiry','residential_address','transaction_reference','account_number','iban'];
  k text;
begin
  foreach k in array masked loop
    if o ? k then o := o || jsonb_build_object(k, '***'); end if;
    if n ? k then n := n || jsonb_build_object(k, '***'); end if;
  end loop;
  insert into banking_activity_logs (actor, case_id, entity_table, entity_id, action, old_data, new_data)
  values (auth.uid(),
          case when tg_table_name = 'banking_cases' then (coalesce(n, o) ->> 'id')::uuid else nullif(coalesce(n, o) ->> 'case_id', '')::uuid end,
          tg_table_name, coalesce(n, o) ->> 'id', tg_op,
          case when tg_op = 'UPDATE' then (select jsonb_object_agg(e.key, e.value) from jsonb_each(o) e where (n -> e.key) is distinct from e.value and e.key not in ('updated_at','updated_by')) else o end,
          case when tg_op = 'UPDATE' then (select jsonb_object_agg(e.key, e.value) from jsonb_each(n) e where (o -> e.key) is distinct from e.value and e.key not in ('updated_at','updated_by')) else n end);
  return coalesce(new, old);
end $$;

-- ── One entry on the bank timeline ───────────────────────────────────
create or replace function public.banking_bank_event(p_case uuid, p_event text, p_date date default null, p_reply text default null, p_remarks text default null, p_next date default null, p_documents jsonb default null, p_override text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c banking_cases; a banking_applications; g jsonb; unmet text[] := '{}'; v_status text; v_stage int; v_outcome text; v_override boolean := false;
  v_date date := coalesce(p_date, current_date);
  v_with_bank text[] := array['Submitted to Bank','Bank Review','Additional Documents Requested','Resubmission Required','Appointment Scheduled','Client Visited Bank','Approved'];
begin
  perform banking_require('apps.manage');
  select * into c from banking_cases where id = p_case for update;
  if c.id is null then raise exception 'Case not found'; end if;
  if p_event not in ('submitted','reply','resubmitted','rejected','opened') then raise exception 'Unknown bank event'; end if;
  select * into a from banking_applications where case_id = p_case order by is_active desc, created_at desc limit 1;
  if a.status in ('Rejected','Cancelled','Account Opened') then raise exception 'This application is already closed as %', a.status; end if;

  if p_event = 'submitted' then
    if a.status = any(v_with_bank) then raise exception 'Already submitted. Record a reply or a resubmission.'; end if;
    g := banking_gate_status(p_case);
    if not coalesce((g ->> 'bank_selected')::boolean, false) then unmet := unmet || 'Bank Selected'::text; end if;
    if not c.is_historical then
      if not coalesce((g ->> 'letter_signed')::boolean, false) and (a.override_justification is null or not a.is_active) then unmet := unmet || 'Engagement Letter Signed'::text; end if;
      if not coalesce((g ->> 'payment_received')::boolean, false) then unmet := unmet || 'Required Payment Received'::text; end if;
    end if;
    if cardinality(unmet) > 0 then
      if nullif(trim(p_override), '') is null then raise exception 'Cannot submit to the bank: not yet met: %', array_to_string(unmet, ', '); end if;
      perform banking_require('workflow.override');
      v_override := true;
    end if;
    if a.id is null or not a.is_active then
      a.id := banking_application_open(p_case, case when v_override then p_override end);
      select * into a from banking_applications where id = a.id;
    end if;
  elsif a.id is null or not (a.status = any(v_with_bank)) then
    raise exception 'Record the submission to the bank first';
  end if;

  if p_event in ('submitted','resubmitted') then v_status := 'Submitted to Bank'; v_stage := 15;
  elsif p_event = 'reply' then
    v_status := case p_reply when 'Under review' then 'Bank Review' when 'Documents requested' then 'Additional Documents Requested' when 'Query raised' then 'Bank Review' when 'Client visit needed' then 'Appointment Scheduled' end;
    if v_status is null then raise exception 'Choose the reply from the bank'; end if;
    v_stage := 16;
  elsif p_event = 'rejected' then
    if nullif(trim(p_remarks), '') is null then raise exception 'Give the reason for the rejection'; end if;
    v_status := 'Rejected'; v_stage := 17; v_outcome := 'Rejected';
  else
    v_status := 'Account Opened'; v_stage := 18; v_outcome := 'Approved';
  end if;

  update banking_applications set status = v_status, status_date = now(),
         next_follow_up = case when p_event in ('rejected','opened') then null else coalesce(p_next, next_follow_up) end,
         submission_date = case when p_event = 'submitted' then coalesce(submission_date, v_date) else submission_date end,
         is_active = p_event <> 'rejected'
   where id = a.id;
  insert into banking_application_status_history (application_id, previous_status, new_status, remarks, next_follow_up, is_override, event_kind, event_date, reply, documents)
  values (a.id, a.status, v_status, coalesce(nullif(trim(p_override), ''), p_remarks), p_next, v_override, p_event, v_date, p_reply, p_documents);
  perform set_config('banking.internal', '1', true);
  update banking_cases set outcome = coalesce(v_outcome, case when outcome = 'Returned' then null else outcome end) where id = p_case;
  if c.current_stage <> v_stage then
    insert into banking_case_stage_history (case_id, from_stage, to_stage, responsible, remarks, is_override)
    values (p_case, c.current_stage, v_stage, c.assigned_to, 'Bank process: ' || v_status, v_override);
    update banking_cases set current_stage = v_stage where id = p_case;
  end if;
  perform set_config('banking.internal', '', true);
  return a.id;
end $$;

-- ── Account details, saved about the client ──────────────────────────
create or replace function public.banking_account_details_save(p_case uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare c banking_cases; a banking_applications; v_id uuid;
begin
  perform banking_require('cases.manage');
  select * into c from banking_cases where id = p_case;
  if c.id is null then raise exception 'Case not found'; end if;
  select * into a from banking_applications where case_id = p_case order by is_active desc, created_at desc limit 1;
  if a.status is distinct from 'Account Opened' then raise exception 'Record the account as opened first'; end if;
  insert into banking_client_accounts (client_id, case_id, application_id, bank_id, account_number, iban, account_name, branch, currency, opened_on, relationship_manager, welcome_letter_path, welcome_letter_name, remarks)
  values (c.client_id, p_case, a.id, a.bank_id, nullif(trim(p ->> 'account_number'), ''), nullif(upper(replace(p ->> 'iban', ' ', '')), ''), nullif(trim(p ->> 'account_name'), ''), nullif(trim(p ->> 'branch'), ''),
          coalesce(nullif(trim(p ->> 'currency'), ''), 'AED'), nullif(p ->> 'opened_on', '')::date, nullif(trim(p ->> 'relationship_manager'), ''), nullif(p ->> 'welcome_letter_path', ''), nullif(p ->> 'welcome_letter_name', ''), nullif(trim(p ->> 'remarks'), ''))
  on conflict (case_id) do update set account_number = excluded.account_number, iban = excluded.iban, account_name = excluded.account_name, branch = excluded.branch, currency = excluded.currency,
         opened_on = excluded.opened_on, relationship_manager = excluded.relationship_manager,
         welcome_letter_path = coalesce(excluded.welcome_letter_path, banking_client_accounts.welcome_letter_path), welcome_letter_name = coalesce(excluded.welcome_letter_name, banking_client_accounts.welcome_letter_name), remarks = excluded.remarks
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.banking_complete_case(p_case uuid, p_remarks text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare d banking_client_accounts; missing text[] := '{}';
begin
  perform banking_require('cases.manage');
  select * into d from banking_client_accounts where case_id = p_case;
  if d.account_number is null then missing := missing || 'Account number'::text; end if;
  if d.iban is null then missing := missing || 'IBAN'::text; end if;
  if d.account_name is null then missing := missing || 'Account name'::text; end if;
  if d.opened_on is null then missing := missing || 'Opening date'::text; end if;
  if cardinality(missing) > 0 then raise exception 'Fill these before completing: %', array_to_string(missing, ', '); end if;
  perform banking_send_to_accounts(p_case, p_remarks);
end $$;

do $$
declare f text;
begin
  foreach f in array array['banking_bank_event(uuid,text,date,text,text,date,jsonb,text)','banking_account_details_save(uuid,jsonb)','banking_complete_case(uuid,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
