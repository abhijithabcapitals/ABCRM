-- Client Portal: clients log in with a username and password issued by an admin, see only their
-- own record and upload documents; staff review the uploads in Clients > Client Inputs.
--
-- Clients are deliberately NOT Supabase Auth users. Many staff tables allow any `authenticated`
-- user and handle_new_user creates a member profile for every auth user, so an auth login would
-- reach internal data. Portal accounts live here and only the client-portal Edge Function (service
-- role) can log in, read a client's record or touch the bucket. No browser role has table access.

create table if not exists public.client_portal_accounts (
  id uuid primary key default gen_random_uuid(),
  banking_client_id uuid unique references public.banking_clients(id) on delete set null,
  client_master_id text unique references public.client_master(client_id) on delete set null,
  display_name text not null,
  username text not null unique check (username ~ '^[a-z0-9][a-z0-9._-]{3,59}$'),
  password_hash text not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.client_portal_sessions (
  token_hash text primary key,
  account_id uuid not null references public.client_portal_accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists client_portal_sessions_account on public.client_portal_sessions(account_id);

create table if not exists public.client_portal_documents (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.client_portal_accounts(id) on delete restrict,
  doc_type text not null,
  note text,
  file_name text not null,
  mime text,
  size_bytes bigint,
  storage_path text not null unique,
  upload_complete boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'in_review', 'validated', 'rejected')),
  assigned_to uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  filed_path text,
  local_path text,
  uploaded_at timestamptz not null default now()
);
create index if not exists client_portal_documents_account on public.client_portal_documents(account_id, uploaded_at desc);
create index if not exists client_portal_documents_status on public.client_portal_documents(status, uploaded_at);

alter table public.client_portal_accounts enable row level security;
alter table public.client_portal_sessions enable row level security;
alter table public.client_portal_documents enable row level security;
revoke all on public.client_portal_accounts, public.client_portal_sessions, public.client_portal_documents from anon, public, authenticated;
grant all on public.client_portal_accounts, public.client_portal_sessions, public.client_portal_documents to service_role;

-- Private bucket with no storage policies: only the service role reaches it, through signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-portal', 'client-portal', false, 26214400, array[
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/tiff', 'text/csv', 'text/plain',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'message/rfc822', 'application/vnd.ms-outlook'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ---- who may do what --------------------------------------------------------------------------

create or replace function public.client_portal_is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin')
$$;

create or replace function public.client_inputs_can() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select client_portal_is_admin() or exists (select 1 from member_tab_access where profile_id = auth.uid() and tab_key = 'clients')
$$;

-- ---- admin: give, reset and revoke access --------------------------------------------------------

-- Every client (banking clients plus Client Master rows not linked to one) with their access state.
create or replace function public.client_portal_admin_clients() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not client_portal_is_admin() then raise exception 'Admins only.'; end if;
  return (select coalesce(jsonb_agg(row_to_json(t) order by t.display_name), '[]'::jsonb) from (
    select c.id as banking_client_id, c.client_master_id, c.display_name, c.license_number,
           a.id as account_id, a.username, a.status, a.last_login_at
      from banking_clients c
      left join client_portal_accounts a on a.banking_client_id = c.id
             or (a.banking_client_id is null and a.client_master_id = c.client_master_id)
    union all
    select null, m.client_id, coalesce(m.legal_name, m.client_id), m.data->>'Trade License Number',
           a.id, a.username, a.status, a.last_login_at
      from client_master m
      left join client_portal_accounts a on a.client_master_id = m.client_id
     where not exists (select 1 from banking_clients c where c.client_master_id = m.client_id)
  ) t);
end $$;

-- Creates the client's account, or sets a new password on it and restores it. Ends open sessions.
create or replace function public.client_portal_admin_save(p_banking_client_id uuid, p_client_master_id text, p_username text, p_password text) returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_id uuid;
  v_name text;
  v_user text := lower(trim(coalesce(p_username, '')));
begin
  if not client_portal_is_admin() then raise exception 'Admins only.'; end if;
  if v_user !~ '^[a-z0-9][a-z0-9._-]{3,59}$' then raise exception 'Username needs 4 to 60 letters, numbers, dots, dashes or underscores. It cannot contain @.'; end if;
  if length(coalesce(p_password, '')) < 10 then raise exception 'Password needs at least 10 characters.'; end if;
  if p_banking_client_id is not null then
    select display_name, coalesce(p_client_master_id, client_master_id) into v_name, p_client_master_id from banking_clients where id = p_banking_client_id;
  elsif p_client_master_id is not null then
    select coalesce(legal_name, client_id) into v_name from client_master where client_id = p_client_master_id;
  end if;
  if v_name is null then raise exception 'Client not found.'; end if;

  select id into v_id from client_portal_accounts
   where (p_banking_client_id is not null and banking_client_id = p_banking_client_id)
      or (p_client_master_id is not null and client_master_id = p_client_master_id)
   limit 1;
  if exists (select 1 from client_portal_accounts where username = v_user and id is distinct from v_id) then
    raise exception 'That username is taken. Choose another.';
  end if;

  if v_id is null then
    insert into client_portal_accounts (banking_client_id, client_master_id, display_name, username, password_hash, created_by)
    values (p_banking_client_id, p_client_master_id, v_name, v_user, crypt(p_password, gen_salt('bf', 10)), auth.uid())
    returning id into v_id;
    insert into admin_audit (actor, action, target, detail) values (auth.uid(), 'client_portal_create', v_user, jsonb_build_object('client', v_name));
  else
    update client_portal_accounts set username = v_user, password_hash = crypt(p_password, gen_salt('bf', 10)), status = 'active',
           failed_attempts = 0, locked_until = null, revoked_at = null, revoked_by = null
     where id = v_id;
    delete from client_portal_sessions where account_id = v_id;
    insert into admin_audit (actor, action, target, detail) values (auth.uid(), 'client_portal_reset', v_user, jsonb_build_object('client', v_name));
  end if;
  return v_id;
end $$;

-- Revoke ends every open session at once; restore brings back the same login. Uploaded documents stay.
create or replace function public.client_portal_admin_set_status(p_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user text;
begin
  if not client_portal_is_admin() then raise exception 'Admins only.'; end if;
  update client_portal_accounts
     set status = case when p_active then 'active' else 'revoked' end,
         revoked_at = case when p_active then null else now() end,
         revoked_by = case when p_active then null else auth.uid() end,
         failed_attempts = 0, locked_until = null
   where id = p_id returning username into v_user;
  if v_user is null then raise exception 'Account not found.'; end if;
  if not p_active then delete from client_portal_sessions where account_id = p_id; end if;
  insert into admin_audit (actor, action, target) values (auth.uid(), case when p_active then 'client_portal_restore' else 'client_portal_revoke' end, v_user);
end $$;

-- ---- portal: called only by the Edge Function (service role) ----------------------------------------

-- One reply for a wrong username, a wrong password, a revoked account and a lockout, so a guesser learns nothing.
create or replace function public.client_portal_login(p_username text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  a client_portal_accounts%rowtype;
  v_ok boolean;
  v_token text;
begin
  select * into a from client_portal_accounts where username = lower(trim(coalesce(p_username, ''))) for update;
  if not found then
    perform crypt(coalesce(p_password, ''), gen_salt('bf', 10)); -- same work as a real check
    return jsonb_build_object('ok', false);
  end if;
  v_ok := a.password_hash = crypt(coalesce(p_password, ''), a.password_hash);
  if a.status <> 'active' or (a.locked_until is not null and a.locked_until > now()) then
    return jsonb_build_object('ok', false);
  end if;
  if not v_ok then
    update client_portal_accounts
       set failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end,
           locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else null end
     where id = a.id;
    return jsonb_build_object('ok', false);
  end if;
  delete from client_portal_sessions where expires_at < now();
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into client_portal_sessions (token_hash, account_id, expires_at)
  values (encode(digest(v_token, 'sha256'), 'hex'), a.id, now() + interval '12 hours');
  update client_portal_accounts set failed_attempts = 0, locked_until = null, last_login_at = now() where id = a.id;
  return jsonb_build_object('ok', true, 'token', v_token);
end $$;

create or replace function public.client_portal_session(p_token text) returns uuid
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select s.account_id from client_portal_sessions s join client_portal_accounts a on a.id = s.account_id
   where s.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') and s.expires_at > now() and a.status = 'active'
$$;

create or replace function public.client_portal_logout(p_token text) returns void
language sql security definer set search_path = public, extensions, pg_temp as $$
  delete from client_portal_sessions where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

create or replace function public.client_portal_change_password(p_token text, p_current text, p_new text) returns boolean
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_id uuid := client_portal_session(p_token);
  v_hash text;
begin
  if v_id is null or length(coalesce(p_new, '')) < 10 then return false; end if;
  select password_hash into v_hash from client_portal_accounts where id = v_id;
  if v_hash <> crypt(coalesce(p_current, ''), v_hash) then return false; end if;
  update client_portal_accounts set password_hash = crypt(p_new, gen_salt('bf', 10)) where id = v_id;
  delete from client_portal_sessions where account_id = v_id and token_hash <> encode(digest(p_token, 'sha256'), 'hex');
  return true;
end $$;

-- What a client sees. Named fields only: KYC risk, internal notes, fees and staff data never leave here.
create or replace function public.client_portal_me(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with a as (select * from client_portal_accounts where id = p_account),
  c as (select b.* from banking_clients b join a on a.banking_client_id = b.id),
  k as (select p.* from banking_kyc_profiles p join c on p.client_id = c.id limit 1),
  m as (select x.data, x.legal_name from client_master x
         where x.client_id = coalesce((select client_master_id from a), (select client_master_id from c)))
  select jsonb_build_object(
    'username', (select username from a),
    'display_name', (select display_name from a),
    'record', jsonb_build_object(
      'legal_name', coalesce((select legal_name from k), (select legal_name from m)),
      'trade_name', coalesce((select trade_name from k), (select data->>'Trade Name' from m)),
      'license_number', coalesce((select license_number from k), (select license_number from c), (select data->>'Trade License Number' from m)),
      'license_expiry_date', coalesce((select license_expiry_date::text from k), (select data->>'License Expiry Date' from m)),
      'issuing_authority', coalesce((select issuing_authority from k), (select data->>'Jurisdiction' from m)),
      'legal_structure', (select legal_structure from k),
      'business_activity', coalesce((select business_activity from k), (select data->>'Business Activities' from m)),
      'registered_address', coalesce((select registered_address from k), (select data->>'Registered Address' from m)),
      'vat_trn', coalesce((select vat_trn from k), (select data->>'TRN' from m)),
      'ct_registration_number', (select data->>'CT Registration Number' from m),
      'financial_year_end', (select data->>'Financial Year End' from m),
      'website', coalesce((select website from k), (select data->>'Website' from m)),
      'email', (select company_email from k),
      'phone', (select company_phone from k)),
    'services', (select coalesce(jsonb_agg(distinct jsonb_build_object('line', 'Business Banking', 'detail', r.bank_name)), '[]'::jsonb)
       from c join banking_cases cs on cs.client_id = c.id
       join banking_bank_recommendations br on br.case_id = cs.id and br.is_selected
       join banking_partners r on r.id = br.bank_id
      where cs.is_historical or (select coalesce(sum(p.signed_amount), 0) from banking_payments p where p.case_id = cs.id) > 0),
    'master_services', (select data->>'Services Provided' from m),
    'documents', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'doc_type', d.doc_type, 'note', d.note, 'file_name', d.file_name, 'size_bytes', d.size_bytes,
        'status', d.status, 'uploaded_at', d.uploaded_at, 'reviewed_at', d.reviewed_at,
        'review_note', case when d.status = 'rejected' then d.review_note end) order by d.uploaded_at desc), '[]'::jsonb)
       from client_portal_documents d where d.account_id = p_account and d.upload_complete))
$$;

-- ---- Client Inputs: staff with the Clients tab ---------------------------------------------------

create or replace function public.client_inputs_list() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not client_inputs_can() then raise exception 'You do not have access to Client Inputs.'; end if;
  return (select coalesce(jsonb_agg(row_to_json(t) order by t.uploaded_at desc), '[]'::jsonb) from (
    select d.id, d.account_id, a.display_name as client, a.client_master_id, d.doc_type, d.note, d.file_name, d.size_bytes, d.status, d.uploaded_at,
           d.assigned_to, pa.full_name as assignee, d.assigned_at, pr.full_name as reviewer, d.reviewed_at, d.review_note,
           d.filed_path, d.local_path, d.assigned_to = auth.uid() or client_portal_is_admin() as can_review
      from client_portal_documents d
      join client_portal_accounts a on a.id = d.account_id
      left join profiles pa on pa.id = d.assigned_to
      left join profiles pr on pr.id = d.reviewed_by
     where d.upload_complete) t);
end $$;

-- Atomic: of two people clicking together, only one gets the document.
create or replace function public.client_inputs_assign(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not client_inputs_can() then raise exception 'You do not have access to Client Inputs.'; end if;
  update client_portal_documents set status = 'in_review', assigned_to = auth.uid(), assigned_at = now()
   where id = p_id and status = 'pending' and upload_complete;
  if not found then raise exception 'Someone else has already taken this document.'; end if;
end $$;

create or replace function public.client_inputs_release(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not client_inputs_can() then raise exception 'You do not have access to Client Inputs.'; end if;
  update client_portal_documents set status = 'pending', assigned_to = null, assigned_at = null
   where id = p_id and status = 'in_review' and (assigned_to = auth.uid() or client_portal_is_admin());
  if not found then raise exception 'Only the person it is assigned to can release this document.'; end if;
end $$;

-- The Edge Function asks with the staff member's own token, so auth.uid() is theirs.
create or replace function public.client_inputs_file(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r jsonb;
begin
  if not client_inputs_can() then raise exception 'You do not have access to Client Inputs.'; end if;
  select jsonb_build_object('id', d.id, 'storage_path', d.storage_path, 'file_name', d.file_name, 'doc_type', d.doc_type,
         'status', d.status, 'client', a.display_name, 'filed_path', d.filed_path, 'actor', auth.uid(),
         'can_review', d.assigned_to = auth.uid() or client_portal_is_admin())
    into r from client_portal_documents d join client_portal_accounts a on a.id = d.account_id
   where d.id = p_id and d.upload_complete;
  if r is null then raise exception 'Document not found.'; end if;
  return r;
end $$;

-- Service role only, after the file has been copied into the client's folder.
create or replace function public.client_inputs_finish(p_actor uuid, p_id uuid, p_status text, p_note text, p_filed_path text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_status not in ('validated', 'rejected') then raise exception 'Unknown decision.'; end if;
  update client_portal_documents set status = p_status, reviewed_by = p_actor, reviewed_at = now(), review_note = nullif(trim(coalesce(p_note, '')), ''), filed_path = p_filed_path
   where id = p_id and status = 'in_review';
  if not found then raise exception 'This document has already been decided.'; end if;
  insert into admin_audit (actor, action, target, detail) values (p_actor, 'client_input_' || p_status, p_id::text, jsonb_build_object('filed_path', p_filed_path));
end $$;

-- Records where the local Client Module saved its copy.
create or replace function public.client_inputs_set_local(p_id uuid, p_path text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not client_inputs_can() then raise exception 'You do not have access to Client Inputs.'; end if;
  update client_portal_documents set local_path = left(p_path, 1000) where id = p_id and status = 'validated';
end $$;

-- ---- execute rights: Supabase grants new functions to everyone, so name them explicitly ---------------

do $$
declare f text;
begin
  foreach f in array array[
    'client_portal_is_admin()', 'client_inputs_can()', 'client_portal_admin_clients()',
    'client_portal_admin_save(uuid, text, text, text)', 'client_portal_admin_set_status(uuid, boolean)',
    'client_inputs_list()', 'client_inputs_assign(uuid)', 'client_inputs_release(uuid)', 'client_inputs_file(uuid)',
    'client_inputs_set_local(uuid, text)', 'client_portal_login(text, text)', 'client_portal_session(text)',
    'client_portal_logout(text)', 'client_portal_change_password(text, text, text)', 'client_portal_me(uuid)',
    'client_inputs_finish(uuid, uuid, text, text, text)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array[
    'client_portal_is_admin()', 'client_inputs_can()', 'client_portal_admin_clients()',
    'client_portal_admin_save(uuid, text, text, text)', 'client_portal_admin_set_status(uuid, boolean)',
    'client_inputs_list()', 'client_inputs_assign(uuid)', 'client_inputs_release(uuid)', 'client_inputs_file(uuid)',
    'client_inputs_set_local(uuid, text)']
  loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
