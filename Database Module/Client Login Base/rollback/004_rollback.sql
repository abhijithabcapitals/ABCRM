-- ROLLBACK of Client Login Base migration 004. Afterwards run migrations/003_password_email.sql again, which restores the
-- must-change column and functions. Then redeploy the earlier client-portal function and revert the site.
--
-- WARNING: this DELETES every readable client password from Vault. Clients can still sign in, because the login check uses
-- the hash, but no admin can see those passwords again without setting new ones.

begin;

drop trigger if exists client_portal_account_forget_password on public.client_portal_accounts;
drop function if exists public.client_portal_account_forget_password();
drop function if exists public.client_portal_admin_password(uuid);
drop function if exists public.client_portal_admin_login(uuid, text);
delete from vault.secrets where name like 'client_portal_pw:%';
grant execute on function public.client_portal_admin_save(uuid, text, text, text) to authenticated;

commit;
