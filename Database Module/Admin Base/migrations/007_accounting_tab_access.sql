-- Whoever is given the Accounting tab can use the page behind it, now and in future.
-- Removing the tab removes the access. A per-person "not allowed" still wins over the tab.

create or replace function public.banking_can(p_permission text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select true from profiles where id = auth.uid() and role = 'admin'),
    (select allowed from banking_user_permissions where user_id = auth.uid() and permission = p_permission),
    (select true where p_permission = 'accounts.review'
      and exists (select 1 from member_tab_access where profile_id = auth.uid() and tab_key = 'accounts')),
    (select rp.allowed from banking_user_roles ur join banking_role_permissions rp on rp.role = ur.role
      where ur.user_id = auth.uid() and rp.permission = p_permission),
    false)
$$;
