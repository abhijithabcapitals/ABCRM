-- =====================================================================
-- Client Login Base - the email a login's password goes to          003
-- =====================================================================
-- An admin now gives access with an email: the client-portal function saves the login through
-- client_portal_admin_grant, then mails the password. A mailed password can sit in an inbox for good, so the
-- client must replace it at first sign-in. The function enforces that with must_change_password.
-- Run after 002. Undo: rollback/003_rollback.sql. Idempotent.

begin;

alter table public.client_portal_accounts add column if not exists email text;
alter table public.client_portal_accounts add column if not exists must_change_password boolean not null default false;

-- What the Give access form suggests: the login's own email, then KYC, then the lead, then Client Master.
create or replace function public.client_portal_admin_access_email(p_banking_client_id uuid, p_client_master_id text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not client_portal_is_admin() then raise exception 'Admins only.'; end if;
  return coalesce(
    (select nullif(trim(a.email), '') from client_portal_accounts a
      where (p_banking_client_id is not null and a.banking_client_id = p_banking_client_id)
         or (p_client_master_id is not null and a.client_master_id = p_client_master_id) limit 1),
    (select nullif(trim(k.company_email), '') from banking_kyc_profiles k where k.client_id = p_banking_client_id limit 1),
    (select nullif(trim(l.email), '') from banking_cases c join banking_leads l on l.id = c.lead_id
      where c.client_id = p_banking_client_id and nullif(trim(l.email), '') is not null order by c.created_at desc limit 1),
    (select nullif(trim(m.data ->> 'General Email'), '') from client_master m
      where m.client_id = coalesce(p_client_master_id, (select b.client_master_id from banking_clients b where b.id = p_banking_client_id)))
  );
end $$;

-- Saves the login with its email. The password itself goes no further than client_portal_admin_save's hash.
create or replace function public.client_portal_admin_grant(p_banking_client_id uuid, p_client_master_id text, p_username text, p_password text, p_email text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_email text := trim(coalesce(p_email, ''));
  r client_portal_accounts%rowtype;
begin
  if not client_portal_is_admin() then raise exception 'Admins only.'; end if;
  if length(v_email) > 254 or v_email !~ '^[^[:space:]@<>,;"]+@[^[:space:]@<>,;"]+\.[^[:space:]@<>,;"]+$' then
    raise exception 'Enter a valid email address.';
  end if;
  v_id := client_portal_admin_save(p_banking_client_id, p_client_master_id, p_username, p_password);
  update client_portal_accounts set email = v_email, must_change_password = true where id = v_id returning * into r;
  return jsonb_build_object('id', r.id, 'username', r.username, 'display_name', r.display_name, 'email', r.email, 'actor', auth.uid());
end $$;

-- As in Client Base 003, plus: the new password must differ, and setting one ends the must-change state.
create or replace function public.client_portal_change_password(p_token text, p_current text, p_new text) returns boolean
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_id uuid := client_portal_session(p_token);
  v_hash text;
begin
  if v_id is null or length(coalesce(p_new, '')) < 10 or p_new = p_current then return false; end if;
  select password_hash into v_hash from client_portal_accounts where id = v_id;
  if v_hash <> crypt(coalesce(p_current, ''), v_hash) then return false; end if;
  update client_portal_accounts set password_hash = crypt(p_new, gen_salt('bf', 10)), must_change_password = false where id = v_id;
  delete from client_portal_sessions where account_id = v_id and token_hash <> encode(digest(p_token, 'sha256'), 'hex');
  return true;
end $$;

revoke all on function public.client_portal_admin_access_email(uuid, text) from public, anon, authenticated;
revoke all on function public.client_portal_admin_grant(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.client_portal_change_password(text, text, text) from public, anon, authenticated;
grant execute on function public.client_portal_admin_access_email(uuid, text), public.client_portal_admin_grant(uuid, text, text, text, text) to authenticated, service_role;
grant execute on function public.client_portal_change_password(text, text, text) to service_role;

commit;
