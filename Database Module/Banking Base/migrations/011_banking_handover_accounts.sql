-- =====================================================================
-- Banking Base - reassign with acceptance; Accounts lock          011
-- =====================================================================
-- A case sent to Accounts disappears from the business team and cannot be changed by anyone until Accounts
-- validates it (Closed, read-only) or reverts it (back with the business team). Idempotent: safe to re-run.
-- Re-running 001 resets row-level policies, so run this file again after it.
-- The Accounts side is in Database Module/Accounting Base.
-- =====================================================================
alter table public.banking_cases add column if not exists accounts_status text check (accounts_status in ('With Accounts','Reverted','Closed'));
alter table public.banking_cases add column if not exists accounts_sent_at timestamptz;
alter table public.banking_cases add column if not exists accounts_sent_by uuid references public.profiles(id);
alter table public.banking_cases add column if not exists accounts_reviewed_at timestamptz;
alter table public.banking_cases add column if not exists accounts_reviewed_by uuid references public.profiles(id);
alter table public.banking_cases add column if not exists accounts_remarks text;

create table if not exists public.banking_reassignments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.banking_leads(id),
  from_user uuid references public.profiles(id),
  to_user uuid not null references public.profiles(id),
  status text not null default 'Pending' check (status in ('Pending','Accepted','Declined','Cancelled')),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  responded_at timestamptz
);
create unique index if not exists banking_reassign_one_pending on public.banking_reassignments (lead_id) where status = 'Pending';
alter table public.banking_reassignments enable row level security;
revoke all on public.banking_reassignments from anon, authenticated;
grant select on public.banking_reassignments to authenticated;
drop policy if exists banking_reassign_read on public.banking_reassignments;
create policy banking_reassign_read on public.banking_reassignments for select to authenticated using (public.banking_can('leads.view'));

-- ── Who can see a case ───────────────────────────────────────────────
create or replace function public.banking_case_visible(p_case uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_case is null or banking_can('accounts.review')
      or coalesce((select accounts_status is distinct from 'With Accounts' from banking_cases where id = p_case), true)
$$;
grant execute on function public.banking_case_visible(uuid) to authenticated;

do $$
declare
  rec text[];
  rules text[][] := array[
    ['banking_case_parties','cases.view','cases.manage'], ['banking_case_stage_history','cases.view',null],
    ['banking_bank_recommendations','cases.view','cases.manage'], ['banking_case_checklists','docs.view',null],
    ['banking_documents','docs.view','docs.manage'], ['banking_quotations','quotes.view',null],
    ['banking_payments','payments.view',null], ['banking_engagement_letters','agreements.view',null],
    ['banking_applications','apps.view',null], ['banking_appointments','apps.view','apps.manage'],
    ['banking_communications','comms.view','comms.manage'], ['banking_tasks','tasks.view','tasks.manage'],
    ['banking_service_deliverables','cases.view','cases.manage'], ['banking_ai_suggestions','cases.view',null]];
  i int;
begin
  for i in 1 .. array_length(rules, 1) loop
    execute format('drop policy if exists %I on public.%I', rules[i][1] || '_read', rules[i][1]);
    execute format('create policy %I on public.%I for select to authenticated using (public.banking_can(%L) and public.banking_case_visible(case_id))', rules[i][1] || '_read', rules[i][1], rules[i][2]);
    if rules[i][3] is not null then
      execute format('drop policy if exists %I on public.%I', rules[i][1] || '_write', rules[i][1]);
      execute format('create policy %I on public.%I for all to authenticated using (public.banking_can(%L) and public.banking_case_visible(case_id)) with check (public.banking_can(%L))', rules[i][1] || '_write', rules[i][1], rules[i][3], rules[i][3]);
    end if;
  end loop;
end $$;

drop policy if exists banking_cases_read on public.banking_cases;
create policy banking_cases_read on public.banking_cases for select to authenticated using (public.banking_can('cases.view') and public.banking_case_visible(id));
drop policy if exists banking_cases_write on public.banking_cases;
create policy banking_cases_write on public.banking_cases for all to authenticated using (public.banking_can('cases.manage') and public.banking_case_visible(id)) with check (public.banking_can('cases.manage'));

drop policy if exists banking_quotation_items_read on public.banking_quotation_items;
create policy banking_quotation_items_read on public.banking_quotation_items for select to authenticated using (public.banking_can('quotes.view') and public.banking_case_visible((select case_id from public.banking_quotations q where q.id = quotation_id)));
drop policy if exists banking_application_status_history_read on public.banking_application_status_history;
create policy banking_application_status_history_read on public.banking_application_status_history for select to authenticated using (public.banking_can('apps.view') and public.banking_case_visible((select case_id from public.banking_applications a where a.id = application_id)));
drop policy if exists banking_receipts_read on public.banking_receipts;
create policy banking_receipts_read on public.banking_receipts for select to authenticated using (public.banking_can('payments.view') and public.banking_case_visible((select case_id from public.banking_payments p where p.id = payment_id)));

drop policy if exists banking_gen_docs_read on public.banking_generated_documents;
create policy banking_gen_docs_read on public.banking_generated_documents for select to authenticated
  using (public.banking_case_visible(case_id) and ((kind = 'quote' and public.banking_can('quotes.view')) or (kind = 'letter' and public.banking_can('agreements.view')) or (kind = 'receipt' and public.banking_can('payments.view'))));

-- ── Nothing on a case changes while Accounts holds it or after closure ─
create or replace function public.banking_case_lock() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare j jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end; v_status text;
begin
  if current_setting('banking.accounts', true) is not distinct from '1' then return coalesce(new, old); end if;
  select accounts_status into v_status from banking_cases where id = nullif(j ->> 'case_id', '')::uuid;
  if v_status = 'With Accounts' then raise exception 'This case is with Accounts. It can be changed only if Accounts reverts it.'; end if;
  if v_status = 'Closed' then raise exception 'This case is closed and can no longer be changed.'; end if;
  return coalesce(new, old);
end $$;
revoke all on function public.banking_case_lock() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['banking_case_parties','banking_case_stage_history','banking_bank_recommendations','banking_documents','banking_case_checklists','banking_quotations','banking_payments','banking_engagement_letters','banking_applications','banking_appointments','banking_communications','banking_tasks','banking_service_deliverables','banking_generated_documents','banking_ai_suggestions'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_case_lock', t);
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function public.banking_case_lock()', t || '_case_lock', t);
  end loop;
end $$;

-- ── Reassign: the new employee must accept ───────────────────────────
create or replace function public.banking_reassign_request(p_lead uuid, p_to uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare l banking_leads; v_id uuid;
begin
  perform banking_require('leads.manage');
  select * into l from banking_leads where id = p_lead for update;
  if l.id is null then raise exception 'Lead not found'; end if;
  if l.assigned_to is distinct from auth.uid() and not banking_can('workflow.override') then raise exception 'Only the assigned employee or a manager can reassign this lead'; end if;
  if p_to = l.assigned_to then raise exception 'This lead is already with that employee'; end if;
  if not exists (select 1 from profiles where id = p_to) then raise exception 'Employee not found'; end if;
  if exists (select 1 from banking_reassignments where lead_id = p_lead and status = 'Pending') then raise exception 'A reassignment is already waiting for acceptance'; end if;
  insert into banking_reassignments (lead_id, from_user, to_user, note) values (p_lead, l.assigned_to, p_to, p_note) returning id into v_id;
  return v_id;
end $$;

create or replace function public.banking_reassign_respond(p_id uuid, p_action text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r banking_reassignments;
begin
  select * into r from banking_reassignments where id = p_id for update;
  if r.id is null or r.status <> 'Pending' then raise exception 'This reassignment is no longer waiting'; end if;
  if p_action = 'cancel' then
    if r.created_by is distinct from auth.uid() and not banking_can('workflow.override') then raise exception 'Only the sender or a manager can cancel it'; end if;
    update banking_reassignments set status = 'Cancelled', responded_at = now() where id = p_id;
    return;
  end if;
  if r.to_user is distinct from auth.uid() then raise exception 'Only % can respond', coalesce((select full_name from profiles where id = r.to_user), 'the new employee'); end if;
  if p_action = 'decline' then
    update banking_reassignments set status = 'Declined', responded_at = now() where id = p_id;
  elsif p_action = 'accept' then
    update banking_reassignments set status = 'Accepted', responded_at = now() where id = p_id;
    update banking_leads set assigned_to = r.to_user, picked_up_by = r.to_user, picked_up_at = coalesce(picked_up_at, now()) where id = r.lead_id;
    update banking_cases set assigned_to = r.to_user where lead_id = r.lead_id and accounts_status is distinct from 'With Accounts' and accounts_status is distinct from 'Closed';
  else raise exception 'Unknown action';
  end if;
end $$;

create or replace function public.banking_reassign_list() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb) from (
    select r.id, r.lead_id, r.to_user, r.from_user, r.created_by, r.note, r.created_at, l.company_name, l.lead_ref, f.full_name from_name, n.full_name to_name
      from banking_reassignments r join banking_leads l on l.id = r.lead_id
      left join profiles f on f.id = r.from_user left join profiles n on n.id = r.to_user
     where r.status = 'Pending' and banking_can('app.access')) t
$$;

do $$
declare f text;
begin
  foreach f in array array['banking_reassign_request(uuid,uuid,text)','banking_reassign_respond(uuid,text)','banking_reassign_list()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
