-- =====================================================================
-- Business Setup Base - a client's service lines                        026
-- =====================================================================
-- The client's Services tab: staff add one line per service, chosen from the fee list (business_setup_fee_items, Services & Fees),
-- with the fee agreed for this client. Lines are saved against the client. The Quotes & Agreements tab starts a quote from the lines
-- not yet quoted; once the quote is issued, those lines carry its id and can no longer change.
-- Runs after 025. Re-runnable. Undo with rollback/026_rollback.sql.
-- =====================================================================

create table if not exists public.business_setup_client_service_lines (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.client_master(client_id),
  fee_item_id uuid not null references public.business_setup_fee_items(id),
  amount numeric(18,2) not null check (amount >= 0),
  quote_id uuid references public.hub_documents(id),
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists business_setup_client_service_lines_client_idx on public.business_setup_client_service_lines (client_id, created_at);
alter table public.business_setup_client_service_lines enable row level security;
revoke all on public.business_setup_client_service_lines from public, anon, authenticated;

do $$
begin
  drop trigger if exists business_setup_client_service_lines_audit on public.business_setup_client_service_lines;
  create trigger business_setup_client_service_lines_audit after insert or update or delete on public.business_setup_client_service_lines
    for each row execute function public.business_setup_audit_trg();
end $$;

-- A client's lines, oldest first, with the service's name, group and VAT rate from the fee list, and the quote number once quoted.
create or replace function public.business_setup_service_line_list(p_client text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform business_setup_require('setup.access');
  return (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'client_id', l.client_id, 'fee_item_id', l.fee_item_id, 'amount', l.amount,
      'service_name', f.name, 'grp', f.grp, 'vat_rate', f.vat_rate, 'is_service', f.is_service, 'stored_amount', f.default_amount,
      'quote_id', l.quote_id, 'quote_number', d.document_number, 'created_at', l.created_at) order by l.created_at, l.id), '[]'::jsonb)
    from business_setup_client_service_lines l
    join business_setup_fee_items f on f.id = l.fee_item_id
    left join hub_documents d on d.id = l.quote_id
    where l.client_id = p_client);
end $$;

-- Adds a line (no id) or changes one not yet quoted. p: { id?, client_id, fee_item_id, amount }.
create or replace function public.business_setup_service_line_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_client text := nullif(btrim(coalesce(p ->> 'client_id', '')), '');
        v_fee uuid := nullif(p ->> 'fee_item_id', '')::uuid; v_amount numeric; l business_setup_client_service_lines;
begin
  perform business_setup_require('setup.quotes.manage');
  if v_fee is null or not exists (select 1 from business_setup_fee_items where id = v_fee and active) then raise exception 'Choose a service from the list'; end if;
  begin v_amount := (p ->> 'amount')::numeric; exception when others then v_amount := null; end;
  if v_amount is null or v_amount < 0 then raise exception 'Enter the fee amount'; end if;
  if v_id is null then
    if v_client is null or not exists (select 1 from client_master where client_id = v_client) then raise exception 'Client not found'; end if;
    insert into business_setup_client_service_lines (client_id, fee_item_id, amount) values (v_client, v_fee, round(v_amount, 2)) returning id into v_id;
    return v_id;
  end if;
  select * into l from business_setup_client_service_lines where id = v_id for update;
  if l.id is null then raise exception 'Line not found'; end if;
  if l.quote_id is not null then raise exception 'This line is on a quote and cannot change. Revise the quote instead.'; end if;
  update business_setup_client_service_lines set fee_item_id = v_fee, amount = round(v_amount, 2), updated_at = now() where id = v_id;
  return v_id;
end $$;

-- Removes a line not yet quoted.
create or replace function public.business_setup_service_line_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare l business_setup_client_service_lines;
begin
  perform business_setup_require('setup.quotes.manage');
  select * into l from business_setup_client_service_lines where id = p_id for update;
  if l.id is null then raise exception 'Line not found'; end if;
  if l.quote_id is not null then raise exception 'This line is on a quote and cannot be removed.'; end if;
  delete from business_setup_client_service_lines where id = p_id;
end $$;

-- Ties the given unquoted lines to a quote just issued for the same client. Lines already quoted are left as they are.
create or replace function public.business_setup_service_line_quoted(p_quote uuid, p_ids uuid[]) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_client text; v_n int;
begin
  perform business_setup_require('setup.quotes.manage');
  select client_id into v_client from hub_documents where id = p_quote and doc_type = 'quote';
  if v_client is null then raise exception 'Quote not found'; end if;
  update business_setup_client_service_lines set quote_id = p_quote, updated_at = now()
    where id = any(coalesce(p_ids, '{}')) and client_id = v_client and quote_id is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.business_setup_service_line_list(text), public.business_setup_service_line_save(jsonb),
  public.business_setup_service_line_delete(uuid), public.business_setup_service_line_quoted(uuid, uuid[]) from public, anon;
grant execute on function public.business_setup_service_line_list(text), public.business_setup_service_line_save(jsonb),
  public.business_setup_service_line_delete(uuid), public.business_setup_service_line_quoted(uuid, uuid[]) to authenticated;
