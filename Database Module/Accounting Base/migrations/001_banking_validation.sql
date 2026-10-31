-- =====================================================================
-- Accounting Base - validation of banking cases                    001
-- =====================================================================
-- Run after Banking Base 011. Accounts validates a case (Closed) or reverts it to the business team.
-- Idempotent: safe to re-run.
-- =====================================================================
create table if not exists public.accounting_case_reviews (   -- append-only
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.banking_cases(id),
  action text not null check (action in ('Sent','Validated','Reverted')),
  remarks text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists accounting_case_rev_case_idx on public.accounting_case_reviews (case_id);
alter table public.accounting_case_reviews enable row level security;
revoke all on public.accounting_case_reviews from anon, authenticated;
grant select on public.accounting_case_reviews to authenticated;
drop policy if exists accounting_case_rev_read on public.accounting_case_reviews;
drop trigger if exists accounting_case_rev_immutable on public.accounting_case_reviews;
create trigger accounting_case_rev_immutable before update or delete on public.accounting_case_reviews for each row execute function public.banking_append_only();

insert into public.banking_role_permissions (role, permission)
select 'ACCOUNTS', p from unnest(array['app.access','accounts.review','cases.view','quotes.view','payments.view','apps.view','docs.view','agreements.view']) p
on conflict do nothing;
insert into public.banking_role_permissions (role, permission) values ('ADMIN', 'accounts.review') on conflict do nothing;
alter table public.banking_user_roles drop constraint if exists banking_user_roles_role_check;
alter table public.banking_user_roles add constraint banking_user_roles_role_check check (role in ('ADMIN','MANAGER','SALES_EXECUTIVE','DOCUMENT_EXECUTIVE','FINANCE','BANKING_EXECUTIVE','READ_ONLY','ACCOUNTS'));

drop policy if exists accounting_case_rev_read on public.accounting_case_reviews;
create policy accounting_case_rev_read on public.accounting_case_reviews for select to authenticated using (public.banking_can('cases.view') and public.banking_case_visible(case_id));

-- ── Handover ─────────────────────────────────────────────────────────
create or replace function public.banking_send_to_accounts(p_case uuid, p_remarks text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c banking_cases; v_status text;
begin
  perform banking_require('cases.manage');
  select * into c from banking_cases where id = p_case for update;
  if c.id is null then raise exception 'Case not found'; end if;
  if c.accounts_status in ('With Accounts','Closed') then raise exception 'This case is already %', lower(c.accounts_status); end if;
  select status into v_status from banking_applications where case_id = p_case order by is_active desc, created_at desc limit 1;
  if v_status is null or v_status not in ('Approved','Account Opened') then raise exception 'Only an approved application can go to Accounts'; end if;
  perform set_config('banking.accounts', '1', true);
  perform set_config('banking.internal', '1', true);
  update banking_cases set accounts_status = 'With Accounts', accounts_sent_at = now(), accounts_sent_by = auth.uid(), accounts_remarks = p_remarks where id = p_case;
  insert into accounting_case_reviews (case_id, action, remarks) values (p_case, 'Sent', p_remarks);
  perform set_config('banking.internal', '', true);
  perform set_config('banking.accounts', '', true);
end $$;

create or replace function public.banking_accounts_review(p_case uuid, p_action text, p_remarks text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c banking_cases;
begin
  perform banking_require('accounts.review');
  select * into c from banking_cases where id = p_case for update;
  if c.accounts_status is distinct from 'With Accounts' then raise exception 'This case is not waiting for Accounts'; end if;
  if p_action = 'revert' and nullif(trim(p_remarks), '') is null then raise exception 'Say what the business team must fix'; end if;
  if p_action not in ('validate','revert') then raise exception 'Unknown action'; end if;
  perform set_config('banking.accounts', '1', true);
  perform set_config('banking.internal', '1', true);
  update banking_cases set accounts_status = case p_action when 'validate' then 'Closed' else 'Reverted' end,
         accounts_reviewed_at = now(), accounts_reviewed_by = auth.uid(), accounts_remarks = p_remarks where id = p_case;
  insert into accounting_case_reviews (case_id, action, remarks) values (p_case, case p_action when 'validate' then 'Validated' else 'Reverted' end, p_remarks);
  perform set_config('banking.internal', '', true);
  perform set_config('banking.accounts', '', true);
end $$;

create or replace function public.banking_accounts_queue() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t.accounts_sent_at desc nulls last), '[]'::jsonb) from (
    select c.id, c.case_ref, c.accounts_status, c.accounts_sent_at, c.accounts_reviewed_at, c.accounts_remarks,
           cl.display_name client, cl.client_master_id, b.bank_name bank, a.status app_status, p.full_name sent_by,
           q.total_amount total, coalesce((select sum(x.signed_amount) from banking_payments x where x.case_id = c.id), 0) received
      from banking_cases c join banking_clients cl on cl.id = c.client_id
      left join profiles p on p.id = c.accounts_sent_by
      left join banking_bank_recommendations r on r.case_id = c.id and r.is_selected
      left join banking_partners b on b.id = r.bank_id
      left join lateral (select status from banking_applications ap where ap.case_id = c.id order by ap.is_active desc, ap.created_at desc limit 1) a on true
      left join lateral (select * from banking_current_quote(c.id)) q on true
     where c.accounts_status is not null and banking_can('accounts.review')) t
$$;

do $$
declare f text;
begin
  foreach f in array array['banking_send_to_accounts(uuid,text)','banking_accounts_review(uuid,text,text)','banking_accounts_queue()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
