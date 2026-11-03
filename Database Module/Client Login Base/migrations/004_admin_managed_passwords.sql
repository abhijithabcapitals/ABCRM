-- =====================================================================
-- Client Login Base - AB Capital manages client passwords           004
-- =====================================================================
-- Clients do not choose or change their passwords: an admin generates one, it is emailed, and admins can see it again.
-- So the password is also kept encrypted in Supabase Vault, one secret per login. Only an admin can read it, one client
-- at a time, and every read is logged. Replaces 003's must-change rule, which no longer applies to clients.
-- Run after 003. Undo: rollback/004_rollback.sql. Idempotent.

begin;

-- Saves the login, its email and the readable copy of its password together.
create or replace function public.client_portal_admin_grant(p_banking_client_id uuid, p_client_master_id text, p_username text, p_password text, p_email text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_email text := trim(coalesce(p_email, ''));
  v_name text;
  v_secret uuid;
  r client_portal_accounts%rowtype;
begin
  if not client_portal_is_admin() then raise exception 'Admins only.'; end if;
  if length(v_email) > 254 or v_email !~ '^[^[:space:]@<>,;"]+@[^[:space:]@<>,;"]+\.[^[:space:]@<>,;"]+$' then
    raise exception 'Enter a valid email address.';
  end if;
  v_id := client_portal_admin_save(p_banking_client_id, p_client_master_id, p_username, p_password);
  update client_portal_accounts set email = v_email where id = v_id returning * into r;
  v_name := 'client_portal_pw:' || v_id;
  select id into v_secret from vault.secrets where name = v_name;
  if v_secret is null then
    perform vault.create_secret(p_password, v_name, 'Client portal password');
  else
    perform vault.update_secret(v_secret, p_password);
  end if;
  return jsonb_build_object('id', r.id, 'username', r.username, 'display_name', r.display_name, 'email', r.email, 'actor', auth.uid());
end $$;

-- The login shown inside a client's record. Finds it from either id, because a login may hang off the banking client or the Client Master row.
create or replace function public.client_portal_admin_login(p_banking_client_id uuid, p_client_master_id text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_banking uuid := coalesce(p_banking_client_id, (select id from banking_clients where client_master_id = p_client_master_id limit 1));
  v_master text := coalesce(p_client_master_id, (select client_master_id from banking_clients where id = p_banking_client_id));
begin
  if not client_portal_is_admin() then raise exception 'Admins only.'; end if;
  return (
    select jsonb_build_object(
      'banking_client_id', v_banking, 'client_master_id', v_master, 'account_id', a.id, 'username', a.username,
      'status', a.status, 'last_login_at', a.last_login_at,
      'display_name', coalesce(a.display_name, (select display_name from banking_clients where id = v_banking), (select coalesce(legal_name, client_id) from client_master where client_id = v_master)),
      'email', coalesce(nullif(trim(a.email), ''), client_portal_admin_access_email(v_banking, v_master)),
      'has_password', a.id is not null and exists (select 1 from vault.secrets s where s.name = 'client_portal_pw:' || a.id))
    from (select 1) one
    left join client_portal_accounts a on (v_banking is not null and a.banking_client_id = v_banking) or (v_master is not null and a.client_master_id = v_master)
    limit 1);
end $$;

-- Admin only, and logged every time.
create or replace function public.client_portal_admin_password(p_account uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user text;
  v_password text;
begin
  if not client_portal_is_admin() then raise exception 'Admins only.'; end if;
  select username into v_user from client_portal_accounts where id = p_account;
  if v_user is null then raise exception 'Login not found.'; end if;
  select decrypted_secret into v_password from vault.decrypted_secrets where name = 'client_portal_pw:' || p_account;
  insert into admin_audit (actor, action, target, detail) values (auth.uid(), 'client_portal_password_viewed', v_user, jsonb_build_object('found', v_password is not null));
  return v_password;
end $$;

-- A deleted login leaves no readable password behind.
create or replace function public.client_portal_account_forget_password() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from vault.secrets where name = 'client_portal_pw:' || old.id;
  return old;
end $$;
drop trigger if exists client_portal_account_forget_password on public.client_portal_accounts;
create trigger client_portal_account_forget_password after delete on public.client_portal_accounts
  for each row execute function public.client_portal_account_forget_password();

-- Every password now goes through client_portal_admin_grant, so the Vault copy cannot go stale.
revoke execute on function public.client_portal_admin_save(uuid, text, text, text) from public, anon, authenticated;

-- Clients no longer change passwords, so the must-change rule and the function behind it go.
drop function if exists public.client_portal_change_password(text, text, text);
alter table public.client_portal_accounts drop column if exists must_change_password;

revoke all on function public.client_portal_admin_grant(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.client_portal_admin_login(uuid, text) from public, anon, authenticated;
revoke all on function public.client_portal_admin_password(uuid) from public, anon, authenticated;
revoke all on function public.client_portal_account_forget_password() from public, anon, authenticated;
grant execute on function public.client_portal_admin_grant(uuid, text, text, text, text), public.client_portal_admin_login(uuid, text), public.client_portal_admin_password(uuid) to authenticated;
grant execute on function public.client_portal_admin_grant(uuid, text, text, text, text) to service_role;

commit;
