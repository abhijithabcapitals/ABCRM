-- ROLLBACK of Client Login Base migration 003. Run before 001_002_rollback.sql if undoing both.
-- It removes the saved login emails and the must-change state, and restores client_portal_change_password from Client Base 003.
-- Redeploy the earlier client-portal function and revert the site straight after: until then Give access fails.

begin;

drop function if exists public.client_portal_admin_grant(uuid, text, text, text, text);
drop function if exists public.client_portal_admin_access_email(uuid, text);

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
revoke all on function public.client_portal_change_password(text, text, text) from public, anon, authenticated;
grant execute on function public.client_portal_change_password(text, text, text) to service_role;

alter table public.client_portal_accounts drop column if exists must_change_password;
alter table public.client_portal_accounts drop column if exists email;

commit;
