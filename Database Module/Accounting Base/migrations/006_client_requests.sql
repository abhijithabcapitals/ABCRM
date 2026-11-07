-- =====================================================================
-- Accounting Base - client requests and their sign-in links          006
-- =====================================================================
-- Run after 005, and after Client Base 003 and Client Login Base 001 (the client portal tables).
-- A request asks a client for accounting data, payment, legal documents or other things. Each one carries a sign-in
-- link: a random token whose SHA-256 alone is stored. The raw token is returned once, to the Edge Function that mails
-- it and shows it to staff, and never again. The link signs the client in to their portal without a password until it
-- expires (7 days), staff end it, or the login is revoked.
-- Requests sit in Follow-ups until staff mark them Received; they can be moved back.
-- Reads need accounts.review; every write goes through a function below, no table grants a write.
-- Idempotent: safe to re-run. Undo with rollback/006_rollback.sql.
-- =====================================================================

create table if not exists public.accounting_client_requests (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.client_master(client_id),
  job_id uuid references public.accounting_jobs(id),
  account_id uuid not null references public.client_portal_accounts(id),
  items text[] not null check (cardinality(items) > 0
    and items <@ array['Accounting data','Payment for services','Legal documents','Other']::text[]),
  other_note text,
  message text,
  link_hash text not null unique,
  link_expires_at timestamptz not null,
  link_ended_at timestamptz,
  link_ended_by uuid,
  link_uses integer not null default 0,
  link_last_used_at timestamptz,
  email_to text,
  emailed boolean,                                           -- null until the Edge Function reports the send
  email_error text,
  client_shared_at timestamptz,                              -- the client pressed "I have sent everything"
  received_at timestamptz,                                   -- staff are satisfied: the request moves to Received
  received_by uuid,
  received_note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  check ('Other' <> all(items) or nullif(btrim(coalesce(other_note, '')), '') is not null)
);
create index if not exists accounting_client_requests_client_idx on public.accounting_client_requests (client_id, created_at desc);
create index if not exists accounting_client_requests_account_idx on public.accounting_client_requests (account_id, created_at desc);
create index if not exists accounting_client_requests_job_idx on public.accounting_client_requests (job_id);

alter table public.accounting_client_requests enable row level security;
revoke all on public.accounting_client_requests from anon, authenticated;
-- Staff read every column but the link hash.
grant select (id, client_id, job_id, account_id, items, other_note, message, link_expires_at, link_ended_at, link_ended_by, link_uses,
              link_last_used_at, email_to, emailed, email_error, client_shared_at, received_at, received_by, received_note, created_by, created_at)
  on public.accounting_client_requests to authenticated;
drop policy if exists accounting_client_requests_read on public.accounting_client_requests;
create policy accounting_client_requests_read on public.accounting_client_requests for select to authenticated using (public.banking_can('accounts.review'));

-- ── Staff: does this client have a login? ────────────────────────────
-- Asked before the form is sent, so the screen can say "open a client login first" instead of failing on submit.
create or replace function public.accounting_client_request_login(p_client text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare a client_portal_accounts; m client_master;
begin
  perform banking_require('accounts.review');
  select * into m from client_master where client_id = p_client;
  if m.client_id is null then raise exception 'That client does not exist in the client master'; end if;
  select * into a from client_portal_accounts where client_master_id = p_client and status = 'active';
  if a.id is null then return jsonb_build_object('has_login', false); end if;
  return jsonb_build_object('has_login', true, 'username', a.username,
    'email', coalesce(client_master_plain(m.data ->> 'General Email'), nullif(btrim(coalesce(a.email, '')), '')));
end $$;

-- ── Staff: make a request ────────────────────────────────────────────
-- p: client_id, job_id (optional, must be this client's), items (array), other_note (needed with Other), message.
-- Returns the raw token once, with where to mail it. Runs as the staff member, so auth.uid() is who asked.
create or replace function public.accounting_client_request_create(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_client text := nullif(btrim(coalesce(p ->> 'client_id', '')), '');
  v_job uuid := nullif(p ->> 'job_id', '')::uuid;
  v_items text[] := array(select distinct x from jsonb_array_elements_text(coalesce(p -> 'items', '[]'::jsonb)) x order by 1);
  v_other text := left(nullif(btrim(coalesce(p ->> 'other_note', '')), ''), 1000);
  v_message text := left(nullif(btrim(coalesce(p ->> 'message', '')), ''), 2000);
  v_token text; v_id uuid; v_expires timestamptz := now() + interval '7 days';
  a client_portal_accounts; m client_master; j accounting_jobs;
begin
  perform banking_require('accounts.review');
  select * into m from client_master where client_id = v_client;
  if m.client_id is null then raise exception 'Choose a client'; end if;
  if v_job is not null then
    select * into j from accounting_jobs where id = v_job;
    if j.id is null then raise exception 'Job not found'; end if;
    if j.client_id is distinct from v_client then raise exception 'That job belongs to another client'; end if;
  end if;
  if cardinality(v_items) = 0 then raise exception 'Tick at least one thing to request'; end if;
  if not v_items <@ array['Accounting data','Payment for services','Legal documents','Other']::text[] then raise exception 'Unknown request item'; end if;
  if 'Other' = any(v_items) and v_other is null then raise exception 'Say what else you need under Other'; end if;
  if not ('Other' = any(v_items)) then v_other := null; end if;
  select * into a from client_portal_accounts where client_master_id = v_client and status = 'active';
  if a.id is null then raise exception 'This client has no client login. Open a client login for them first, then generate the request.'; end if;
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into accounting_client_requests (client_id, job_id, account_id, items, other_note, message, link_hash, link_expires_at, email_to, created_by)
  values (v_client, v_job, a.id, v_items, v_other, v_message, encode(digest(v_token, 'sha256'), 'hex'), v_expires,
          coalesce(client_master_plain(m.data ->> 'General Email'), nullif(btrim(coalesce(a.email, '')), '')), auth.uid())
  returning id into v_id;
  if v_job is not null then perform accounting_job_event(v_job, 'Client request', null, null, array_to_string(v_items, ', ')); end if;
  return jsonb_build_object('id', v_id, 'token', v_token, 'expires_at', v_expires, 'email', (select email_to from accounting_client_requests where id = v_id),
    'display_name', coalesce(a.display_name, m.legal_name), 'username', a.username, 'items', to_jsonb(v_items), 'other_note', v_other, 'message', v_message);
end $$;

-- ── Edge Function: the result of the mail ────────────────────────────
create or replace function public.accounting_client_request_mailed(p_id uuid, p_emailed boolean, p_error text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update accounting_client_requests set emailed = p_emailed, email_error = case when p_emailed then null else left(p_error, 300) end
   where id = p_id and emailed is null;
$$;

-- ── Staff: end a link, mark Received or move back ────────────────────
create or replace function public.accounting_client_request_end_link(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform banking_require('accounts.review');
  update accounting_client_requests set link_ended_at = now(), link_ended_by = auth.uid() where id = p_id and link_ended_at is null;
  if not found and not exists (select 1 from accounting_client_requests where id = p_id) then raise exception 'Request not found'; end if;
end $$;

create or replace function public.accounting_client_request_set_received(p_id uuid, p_received boolean, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r accounting_client_requests;
begin
  perform banking_require('accounts.review');
  select * into r from accounting_client_requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if p_received then
    if r.received_at is not null then raise exception 'This request is already in Received'; end if;
    update accounting_client_requests set received_at = now(), received_by = auth.uid(), received_note = left(nullif(btrim(coalesce(p_note, '')), ''), 1000) where id = p_id;
    if r.job_id is not null then perform accounting_job_event(r.job_id, 'Client request received', null, null, nullif(btrim(coalesce(p_note, '')), '')); end if;
  else
    if r.received_at is null then raise exception 'This request is not in Received'; end if;
    update accounting_client_requests set received_at = null, received_by = null, received_note = null where id = p_id;
    if r.job_id is not null then perform accounting_job_event(r.job_id, 'Client request reopened', null, null, nullif(btrim(coalesce(p_note, '')), '')); end if;
  end if;
end $$;

-- ── Staff: what the client sent since the request ────────────────────
-- Documents they uploaded, details they asked to change, and the moment they said they had sent everything.
-- Client portal tables are closed to staff, so this reads them for accounts.review, limited to this request's login.
create or replace function public.accounting_client_request_activity(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r accounting_client_requests;
begin
  perform banking_require('accounts.review');
  select * into r from accounting_client_requests where id = p_id;
  if r.id is null then raise exception 'Request not found'; end if;
  return jsonb_build_object(
    'documents', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'at', d.uploaded_at, 'doc_type', d.doc_type, 'file_name', d.file_name, 'note', d.note, 'status', d.status) order by d.uploaded_at), '[]'::jsonb)
                    from client_portal_documents d where d.account_id = r.account_id and d.upload_complete and d.uploaded_at >= r.created_at),
    'changes', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'at', c.created_at, 'field', c.field_key, 'value', c.new_value, 'status', c.status) order by c.created_at), '[]'::jsonb)
                  from client_portal_change_requests c where c.account_id = r.account_id and c.created_at >= r.created_at));
end $$;

-- ── Client side (service role, through client-portal) ────────────────
-- The link signs in: a 12-hour session like a password sign-in. A wrong, ended or expired link, or a revoked login, gets ok false.
create or replace function public.client_portal_link_login(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare r accounting_client_requests; a client_portal_accounts; v_token text;
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok', false); end if;
  select * into r from accounting_client_requests where link_hash = encode(digest(p_token, 'sha256'), 'hex') for update;
  if r.id is null or r.link_ended_at is not null or r.link_expires_at <= now() then return jsonb_build_object('ok', false); end if;
  select * into a from client_portal_accounts where id = r.account_id;
  if a.id is null or a.status <> 'active' then return jsonb_build_object('ok', false); end if;
  delete from client_portal_sessions where expires_at < now();
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into client_portal_sessions (token_hash, account_id, expires_at) values (encode(digest(v_token, 'sha256'), 'hex'), a.id, now() + interval '12 hours');
  update client_portal_accounts set last_login_at = now() where id = a.id;
  update accounting_client_requests set link_uses = link_uses + 1, link_last_used_at = now() where id = r.id;
  return jsonb_build_object('ok', true, 'token', v_token);
end $$;

-- The client's own requests of the last 90 days, newest first. No staff names, no notes of staff.
create or replace function public.client_portal_requests(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'created_at', created_at, 'items', items, 'other_note', other_note, 'message', message,
           'shared_at', client_shared_at, 'done', received_at is not null) order by created_at desc), '[]'::jsonb)
    from accounting_client_requests where account_id = p_account and created_at > now() - interval '90 days';
$$;

-- "I have sent everything" on one of the client's own open requests.
create or replace function public.client_portal_request_shared(p_account uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update accounting_client_requests set client_shared_at = now() where id = p_id and account_id = p_account and received_at is null;
  if not found then raise exception 'Request not found'; end if;
end $$;

-- ── Who may run what ─────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array['accounting_client_request_login(text)','accounting_client_request_create(jsonb)','accounting_client_request_end_link(uuid)',
                           'accounting_client_request_set_received(uuid,boolean,text)','accounting_client_request_activity(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['accounting_client_request_mailed(uuid,boolean,text)','client_portal_link_login(text)','client_portal_requests(uuid)','client_portal_request_shared(uuid,uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
