-- =====================================================================
-- Business Setup Base - handover to Accounts                           011
-- =====================================================================
-- Re-runnable. Runs after 001 to 010. One accepted quote goes to Accounts once every line is Completed or Cancelled.
-- While Accounts holds it, and after closure, its services, payments, receipts and output files cannot change.
-- Accounts validates (Closed) or reverts with remarks (back with the team). Same pattern as Banking Base 011.
-- =====================================================================

create table if not exists public.business_setup_handovers (
  quote_id uuid primary key references public.hub_documents(id),
  status text not null check (status in ('With Accounts', 'Closed', 'Reverted')),
  sent_at timestamptz,
  sent_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  remarks text
);
create table if not exists public.business_setup_accounts_reviews (   -- append-only
  id bigint generated always as identity primary key,
  quote_id uuid not null references public.hub_documents(id),
  action text not null check (action in ('Sent', 'Validated', 'Reverted')),
  remarks text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists business_setup_accounts_reviews_quote_idx on public.business_setup_accounts_reviews (quote_id, id);
drop trigger if exists business_setup_accounts_reviews_immutable on public.business_setup_accounts_reviews;
create trigger business_setup_accounts_reviews_immutable before update or delete on public.business_setup_accounts_reviews
  for each row execute function public.business_setup_append_only();
alter table public.business_setup_handovers enable row level security;
alter table public.business_setup_accounts_reviews enable row level security;
drop policy if exists business_setup_handovers_read on public.business_setup_handovers;
create policy business_setup_handovers_read on public.business_setup_handovers for select to authenticated
  using (public.business_setup_can('setup.access') or public.banking_can('accounts.review'));
drop policy if exists business_setup_accounts_reviews_read on public.business_setup_accounts_reviews;
create policy business_setup_accounts_reviews_read on public.business_setup_accounts_reviews for select to authenticated
  using (public.business_setup_can('setup.access') or public.banking_can('accounts.review'));
revoke all on public.business_setup_handovers, public.business_setup_accounts_reviews from anon, authenticated;
grant select on public.business_setup_handovers, public.business_setup_accounts_reviews to authenticated;

-- ── The lock ─────────────────────────────────────────────────────────
-- Writes reach these tables only through functions, and the handover functions change `locked` itself.
create or replace function public.business_setup_service_lock() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if old.locked and new.locked then raise exception 'This service is with Accounts. It can be changed only if Accounts reverts it.'; end if;
  return new;
end $$;
drop trigger if exists business_setup_services_lock on public.business_setup_services;
create trigger business_setup_services_lock before update on public.business_setup_services
  for each row execute function public.business_setup_service_lock();

create or replace function public.business_setup_child_lock() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_locked boolean := false;
begin
  if tg_table_name = 'business_setup_payments' then
    v_locked := new.quote_id is not null and business_setup_quote_locked(new.quote_id);
  elsif tg_table_name = 'business_setup_receipts' then
    v_locked := exists (select 1 from business_setup_payments y where y.id = new.payment_id and y.quote_id is not null and business_setup_quote_locked(y.quote_id));
  elsif tg_table_name = 'business_setup_documents' then
    v_locked := new.service_id is not null and exists (select 1 from business_setup_services s where s.id = new.service_id and s.locked);
  end if;
  if v_locked then raise exception 'This quote is with Accounts. It can be changed only if Accounts reverts it.'; end if;
  return new;
end $$;
drop trigger if exists business_setup_payments_lock on public.business_setup_payments;
create trigger business_setup_payments_lock before insert on public.business_setup_payments
  for each row execute function public.business_setup_child_lock();
drop trigger if exists business_setup_receipts_lock on public.business_setup_receipts;
create trigger business_setup_receipts_lock before insert or update on public.business_setup_receipts
  for each row execute function public.business_setup_child_lock();
drop trigger if exists business_setup_documents_lock on public.business_setup_documents;
create trigger business_setup_documents_lock before insert or update on public.business_setup_documents
  for each row execute function public.business_setup_child_lock();

-- ── Where a quote stands ─────────────────────────────────────────────
create or replace function public.business_setup_handover_read(p_quote uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare q hub_documents; h business_setup_handovers; v_blockers text[]; v_count int; v_net numeric;
begin
  select * into q from hub_documents where id = p_quote and doc_type = 'quote' and department = 'Business Setup';
  if q.id is null then raise exception 'Quote not found'; end if;
  select * into h from business_setup_handovers where quote_id = p_quote;
  select count(*), coalesce(array_agg(s.name || ' is ' || s.status order by s.name) filter (where s.status not in ('Completed', 'Cancelled')), '{}')
    into v_count, v_blockers from business_setup_services s where s.quote_id = p_quote;
  if q.status <> 'accepted' then v_blockers := array['The quote is not accepted'] || v_blockers; end if;
  if v_count = 0 then v_blockers := v_blockers || 'The quote has no services'::text; end if;
  v_net := business_setup_net_paid(p_quote);
  return jsonb_build_object('ready', cardinality(v_blockers) = 0 and coalesce(h.status, 'Reverted') = 'Reverted', 'blockers', to_jsonb(v_blockers),
    'net_paid', v_net, 'outstanding', q.total_amount - v_net, 'state', h.status, 'remarks', h.remarks, 'sent_at', h.sent_at, 'reviewed_at', h.reviewed_at);
end $$;

create or replace function public.business_setup_handover_state(p_quote uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform business_setup_require('setup.access');
  return business_setup_handover_read(p_quote);
end $$;

-- An unpaid balance shows on the send screen and to Accounts. It does not stop sending.
create or replace function public.business_setup_send_to_accounts(p_quote uuid, p_remarks text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare q hub_documents; v_state jsonb; v_remarks text := nullif(btrim(coalesce(p_remarks, '')), '');
begin
  perform business_setup_require('setup.services.manage');
  select * into q from hub_documents where id = p_quote and doc_type = 'quote' and department = 'Business Setup' for update;
  if q.id is null then raise exception 'Quote not found'; end if;
  v_state := business_setup_handover_read(p_quote);
  if v_state ->> 'state' in ('With Accounts', 'Closed') then raise exception 'This quote is already %', lower(v_state ->> 'state'); end if;
  if jsonb_array_length(v_state -> 'blockers') > 0 then
    raise exception 'This quote is not completed: %', (select string_agg(b, ', ') from jsonb_array_elements_text(v_state -> 'blockers') b);
  end if;
  insert into business_setup_handovers (quote_id, status, sent_at, sent_by, remarks) values (p_quote, 'With Accounts', now(), auth.uid(), v_remarks)
  on conflict (quote_id) do update set status = 'With Accounts', sent_at = now(), sent_by = auth.uid(), reviewed_at = null, reviewed_by = null, remarks = v_remarks;
  update business_setup_services set locked = true where quote_id = p_quote;
  insert into business_setup_accounts_reviews (quote_id, action, remarks) values (p_quote, 'Sent', v_remarks);
  perform business_setup_audit('business_setup_handovers', p_quote::text, 'send_to_accounts', null, jsonb_build_object('client_id', q.client_id, 'number', q.document_number));
end $$;

-- ── Accounts ─────────────────────────────────────────────────────────
create or replace function public.business_setup_accounts_review(p_quote uuid, p_action text, p_remarks text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare h business_setup_handovers; v_remarks text := nullif(btrim(coalesce(p_remarks, '')), ''); v_client text;
begin
  perform banking_require('accounts.review');
  select * into h from business_setup_handovers where quote_id = p_quote for update;
  if h.quote_id is null or h.status <> 'With Accounts' then raise exception 'This quote is not waiting for Accounts'; end if;
  if p_action not in ('validate', 'revert') then raise exception 'Unknown action'; end if;
  if p_action = 'revert' and v_remarks is null then raise exception 'Write remarks saying what the team must fix'; end if;
  update business_setup_handovers set status = case p_action when 'validate' then 'Closed' else 'Reverted' end, reviewed_at = now(), reviewed_by = auth.uid(), remarks = v_remarks where quote_id = p_quote;
  if p_action = 'revert' then update business_setup_services set locked = false where quote_id = p_quote; end if;
  insert into business_setup_accounts_reviews (quote_id, action, remarks) values (p_quote, case p_action when 'validate' then 'Validated' else 'Reverted' end, v_remarks);
  select client_id into v_client from hub_documents where id = p_quote;
  perform business_setup_audit('business_setup_handovers', p_quote::text, 'accounts_review', null, jsonb_build_object('client_id', v_client, 'action', p_action, 'remarks', v_remarks));
end $$;

-- Waiting first, then the most recently closed.
create or replace function public.business_setup_accounts_queue() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform banking_require('accounts.review');
  return (select coalesce(jsonb_agg(jsonb_build_object('quote_id', q.id, 'number', q.document_number, 'client_id', q.client_id, 'client_name', m.legal_name,
             'status', h.status, 'sent_at', h.sent_at, 'reviewed_at', h.reviewed_at, 'remarks', h.remarks, 'total', q.total_amount, 'net_paid', business_setup_net_paid(q.id),
             'outstanding', q.total_amount - business_setup_net_paid(q.id),
             'services', (select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'action', s.action, 'status', s.status, 'completed_at', s.completed_at) order by s.name), '[]'::jsonb) from business_setup_services s where s.quote_id = q.id),
             'payments', (select coalesce(jsonb_agg(jsonb_build_object('date', y.paid_on, 'amount', y.amount, 'type', y.type, 'method', y.method, 'reference', y.reference, 'receipt_number', r.receipt_number, 'receipt_path', r.storage_path) order by y.paid_on), '[]'::jsonb)
                            from business_setup_payments y left join business_setup_receipts r on r.payment_id = y.id where y.quote_id = q.id),
             'outputs', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'file_name', d.file_name, 'storage_path', d.storage_path) order by d.created_at), '[]'::jsonb)
                           from business_setup_documents d join business_setup_services s on s.id = d.service_id where s.quote_id = q.id and d.is_output))
             order by (h.status = 'With Accounts') desc, coalesce(h.reviewed_at, h.sent_at) desc), '[]'::jsonb)
    from business_setup_handovers h join hub_documents q on q.id = h.quote_id left join client_master m on m.client_id = q.client_id
   where h.status in ('With Accounts', 'Closed'));
end $$;

-- ── Dashboard counts ─────────────────────────────────────────────────
create or replace function public.business_setup_dash_handover() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'ready_for_accounts', (select count(*) from hub_documents q
        where q.department = 'Business Setup' and q.doc_type = 'quote' and q.status = 'accepted'
          and exists (select 1 from business_setup_services s where s.quote_id = q.id)
          and not exists (select 1 from business_setup_services s where s.quote_id = q.id and s.status not in ('Completed', 'Cancelled'))
          and not exists (select 1 from business_setup_handovers h where h.quote_id = q.id and h.status in ('With Accounts', 'Closed'))),
    'reverted_by_accounts', (select count(*) from business_setup_handovers where status = 'Reverted'))
$$;

revoke all on function public.business_setup_service_lock(), public.business_setup_child_lock(), public.business_setup_handover_read(uuid),
  public.business_setup_handover_state(uuid), public.business_setup_send_to_accounts(uuid, text), public.business_setup_accounts_review(uuid, text, text),
  public.business_setup_accounts_queue(), public.business_setup_dash_handover() from public, anon, authenticated;
grant execute on function public.business_setup_handover_state(uuid), public.business_setup_send_to_accounts(uuid, text),
  public.business_setup_accounts_review(uuid, text, text), public.business_setup_accounts_queue() to authenticated;
