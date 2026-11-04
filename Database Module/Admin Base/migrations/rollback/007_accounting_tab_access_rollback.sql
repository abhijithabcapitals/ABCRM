-- Undoes 007_accounting_tab_access.sql: the Accounting tab no longer carries accounts.review.

create or replace function public.banking_can(p_permission text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select true from profiles where id = auth.uid() and role = 'admin'),
    (select allowed from banking_user_permissions where user_id = auth.uid() and permission = p_permission),
    (select rp.allowed from banking_user_roles ur join banking_role_permissions rp on rp.role = ur.role
      where ur.user_id = auth.uid() and rp.permission = p_permission),
    false)
$$;
