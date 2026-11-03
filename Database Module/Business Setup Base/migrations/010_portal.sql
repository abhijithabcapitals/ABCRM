-- =====================================================================
-- Business Setup Base - the client's view in the portal                010
-- =====================================================================
-- Re-runnable. Runs after 001 to 009, Client Base 003 and Client Login Base 001. Clients are not Supabase users: only the client-portal
-- Edge Function, with the service role, calls these functions, and it passes the account of the live session.
-- The client ID is worked out here from that account and is never taken from the browser. Named fields only.
-- =====================================================================

-- Invoices. Nothing writes here until Zoho is connected, and the client's Invoices section stays empty.
create table if not exists public.business_setup_invoices (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.client_master(client_id),
  quote_id uuid references public.hub_documents(id),
  invoice_number text,
  issued_on date,
  amount numeric(18,2),
  file_path text,
  source text not null default 'zoho',
  zoho_id text,
  created_at timestamptz not null default now()
);
create index if not exists business_setup_invoices_client_idx on public.business_setup_invoices (client_id);
alter table public.business_setup_invoices enable row level security;
drop policy if exists business_setup_invoices_read on public.business_setup_invoices;
create policy business_setup_invoices_read on public.business_setup_invoices for select to authenticated using (public.business_setup_can('setup.access'));
revoke all on public.business_setup_invoices from anon, authenticated;
grant select on public.business_setup_invoices to authenticated;

-- Which client an account belongs to: its own link, or the one on its Banking client. Null when neither is set.
create or replace function public.business_setup_portal_client(p_account uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(a.client_master_id, (select b.client_master_id from banking_clients b where b.id = a.banking_client_id))
    from client_portal_accounts a where a.id = p_account
$$;

create or replace function public.business_setup_portal_view(p_account uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_client text := business_setup_portal_client(p_account);
begin
  return jsonb_build_object(
    'form', business_setup_form_get(p_account),
    'details', client_portal_me(p_account) -> 'record',
    'services', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'action', s.action, 'status', s.status, 'started_at', s.started_at,
                    'completed_at', s.completed_at, 'expiry_date', s.expiry_date) order by s.created_at desc), '[]'::jsonb)
                   from business_setup_services s where s.client_id = v_client and not s.historical),
    'quotes', (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'number', q.document_number, 'date', q.created_at::date, 'status', q.status, 'total', q.total_amount,
                  'net_paid', business_setup_net_paid(q.id), 'outstanding', q.total_amount - business_setup_net_paid(q.id), 'has_file', q.storage_path is not null,
                  'letter', (select jsonb_build_object('id', l.id, 'number', l.document_number, 'date', l.created_at::date, 'signed_at', l.signed_at, 'has_file', l.storage_path is not null)
                               from hub_documents l where l.parent_id = q.id and l.doc_type = 'letter')) order by q.created_at desc), '[]'::jsonb)
                 from hub_documents q
                where q.client_id = v_client and q.doc_type = 'quote' and q.department = 'Business Setup' and q.status in ('issued', 'accepted', 'rejected')),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('id', y.id, 'date', y.paid_on, 'amount', y.amount, 'type', y.type, 'reference', y.reference,
                    'receipt_id', r.id, 'receipt_number', r.receipt_number, 'has_file', r.storage_path is not null) order by y.paid_on desc, y.created_at desc), '[]'::jsonb)
                   from business_setup_payments y left join business_setup_receipts r on r.payment_id = y.id where y.client_id = v_client),
    'invoices', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'number', i.invoice_number, 'date', i.issued_on, 'amount', i.amount, 'has_file', i.file_path is not null) order by i.issued_on desc), '[]'::jsonb)
                   from business_setup_invoices i where i.client_id = v_client),
    'documents', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'file_name', d.file_name, 'date', d.created_at::date) order by d.created_at desc), '[]'::jsonb)
                    from business_setup_documents d where d.client_id = v_client and d.is_output and d.client_visible));
end $$;

-- Where a file of this client's is stored, for a short signed link. One reply for anything not theirs or not there.
create or replace function public.business_setup_portal_file(p_account uuid, p_kind text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_client text := business_setup_portal_client(p_account); v_bucket text; v_path text; v_name text;
begin
  if v_client is not null then
    if p_kind = 'quote' then
      select 'hub-documents', q.storage_path, q.document_number || '.docx' into v_bucket, v_path, v_name from hub_documents q
       where q.id = p_id and q.client_id = v_client and q.doc_type = 'quote' and q.department = 'Business Setup' and q.status in ('issued', 'accepted', 'rejected');
    elsif p_kind = 'letter' then
      select 'hub-documents', l.storage_path, l.document_number || '.docx' into v_bucket, v_path, v_name from hub_documents l join hub_documents q on q.id = l.parent_id
       where l.id = p_id and l.doc_type = 'letter' and q.client_id = v_client and q.department = 'Business Setup' and q.status in ('issued', 'accepted', 'rejected');
    elsif p_kind = 'receipt' then
      select 'hub-documents', r.storage_path, replace(r.receipt_number, '/', '-') || '.docx' into v_bucket, v_path, v_name from business_setup_receipts r join business_setup_payments y on y.id = r.payment_id
       where r.id = p_id and y.client_id = v_client;
    elsif p_kind = 'output' then
      select 'business-setup-documents', d.storage_path, d.file_name into v_bucket, v_path, v_name from business_setup_documents d
       where d.id = p_id and d.client_id = v_client and d.is_output and d.client_visible;
    elsif p_kind = 'invoice' then
      select 'business-setup-documents', i.file_path, coalesce(i.invoice_number, 'invoice') || '.pdf' into v_bucket, v_path, v_name from business_setup_invoices i
       where i.id = p_id and i.client_id = v_client;
    end if;
  end if;
  if v_path is null then raise exception 'File not found'; end if;
  return jsonb_build_object('bucket', v_bucket, 'path', v_path, 'file_name', replace(coalesce(v_name, 'file'), '/', '-'));
end $$;


revoke all on function public.business_setup_portal_client(uuid), public.business_setup_portal_view(uuid), public.business_setup_portal_file(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.business_setup_portal_client(uuid), public.business_setup_portal_view(uuid), public.business_setup_portal_file(uuid, text, uuid) to service_role;

-- ── Client login, for staff with setup.portal.manage ─────────────────
-- Same rules as client_portal_admin_save in Client Base 003, for this module's clients. The password is hashed here and never stored in the clear.
create or replace function public.business_setup_portal_account(p_client text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id from client_portal_accounts a
   where a.client_master_id = p_client
      or a.banking_client_id in (select b.id from banking_clients b where b.client_master_id = p_client)
   limit 1
$$;

create or replace function public.business_setup_portal_login_state(p_client text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform business_setup_require('setup.portal.manage');
  return (select jsonb_build_object('id', a.id, 'username', a.username, 'status', a.status, 'last_login_at', a.last_login_at)
            from client_portal_accounts a where a.id = business_setup_portal_account(p_client));
end $$;

create or replace function public.business_setup_portal_login_save(p_client text, p_username text, p_password text) returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_id uuid; v_name text; v_user text := lower(trim(coalesce(p_username, '')));
begin
  perform business_setup_require('setup.portal.manage');
  if v_user !~ '^[a-z0-9][a-z0-9._-]{3,59}$' then raise exception 'Username needs 4 to 60 letters, numbers, dots, dashes or underscores. It cannot contain @.'; end if;
  if length(coalesce(p_password, '')) < 10 then raise exception 'Password needs at least 10 characters.'; end if;
  select coalesce(legal_name, client_id) into v_name from client_master where client_id = p_client;
  if v_name is null then raise exception 'Client not found.'; end if;
  v_id := business_setup_portal_account(p_client);
  if exists (select 1 from client_portal_accounts where username = v_user and id is distinct from v_id) then raise exception 'That username is taken. Choose another.'; end if;
  if v_id is null then
    insert into client_portal_accounts (client_master_id, display_name, username, password_hash, created_by)
    values (p_client, v_name, v_user, crypt(p_password, gen_salt('bf', 10)), auth.uid()) returning id into v_id;
  else
    update client_portal_accounts set username = v_user, password_hash = crypt(p_password, gen_salt('bf', 10)), status = 'active',
           failed_attempts = 0, locked_until = null, revoked_at = null, revoked_by = null where id = v_id;
    delete from client_portal_sessions where account_id = v_id;
  end if;
  perform business_setup_form_create(p_client, v_id);
  perform business_setup_audit('client_portal_accounts', v_id::text, 'login_save', null, jsonb_build_object('client_id', p_client, 'username', v_user));
  return v_id;
end $$;

-- Revoke ends every open session at once. Restore brings back the same login.
create or replace function public.business_setup_portal_login_status(p_client text, p_active boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform business_setup_require('setup.portal.manage');
  v_id := business_setup_portal_account(p_client);
  if v_id is null then raise exception 'This client has no login.'; end if;
  update client_portal_accounts set status = case when p_active then 'active' else 'revoked' end, revoked_at = case when p_active then null else now() end,
         revoked_by = case when p_active then null else auth.uid() end, failed_attempts = 0, locked_until = null where id = v_id;
  if not p_active then delete from client_portal_sessions where account_id = v_id; end if;
  perform business_setup_audit('client_portal_accounts', v_id::text, case when p_active then 'login_restore' else 'login_revoke' end, null, jsonb_build_object('client_id', p_client));
end $$;
revoke all on function public.business_setup_portal_account(text), public.business_setup_portal_login_state(text), public.business_setup_portal_login_save(text, text, text),
  public.business_setup_portal_login_status(text, boolean) from public, anon, authenticated;
grant execute on function public.business_setup_portal_login_state(text), public.business_setup_portal_login_save(text, text, text), public.business_setup_portal_login_status(text, boolean) to authenticated;
