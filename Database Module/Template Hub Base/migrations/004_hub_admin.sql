-- Template Hub admin rights for managers, without making them CRM admins.
-- A manager is anyone with the MANAGER data role, or an active employee whose HR designation is Manager.
-- The rule is live: a new manager gets the rights at once, and losing the role or designation removes them.
-- They get the Template Hub and ArdentTax tabs, template upload and delete, master templates and all numbering.
-- Rollback: rollback/004_rollback.sql.

create or replace function public.hub_is_admin() returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select admin_is()
    or exists (select 1 from banking_user_roles where user_id = auth.uid() and role = 'MANAGER')
    or exists (select 1 from hr_employees where profile_id = auth.uid() and status = 'Active' and designation ilike 'manager')
$$;
revoke all on function public.hub_is_admin() from public, anon;
grant execute on function public.hub_is_admin() to authenticated;

-- Settings still lists the ticks an admin gave; the two tabs from this rule are added on top.
create or replace function public.my_tabs() returns text[]
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct t), '{}') from (
    select tab_key as t from member_tab_access where profile_id = auth.uid()
    union all
    select unnest(array['quotations', 'ardentax']) where hub_is_admin()
  ) x
$$;

-- The existing checks each gain one condition. A changed definition that no longer matches stops the migration.
do $$
declare
  f record; def text; changed text;
begin
  for f in select * from (values
    ('public.hub_numbering_status()'::regprocedure,
      $a$banking_can('settings.manage') or business_setup_can('setup.settings.manage')$a$,
      $b$hub_is_admin() or banking_can('settings.manage') or business_setup_can('setup.settings.manage')$b$),
    ('public.hub_numbering_save(text, text, text, integer, text, integer)'::regprocedure,
      $a$if not (p_department = 'Business Setup' and business_setup_can('setup.settings.manage')) then$a$,
      $b$if not (hub_is_admin() or (p_department = 'Business Setup' and business_setup_can('setup.settings.manage'))) then$b$),
    ('public.hub_master_template_set(text, text, text)'::regprocedure,
      $a$perform banking_require('settings.manage');$a$,
      $b$if not hub_is_admin() then perform banking_require('settings.manage'); end if;$b$),
    ('public.banking_numbering_save(text, text, integer, text, integer)'::regprocedure,
      $a$perform banking_require('settings.manage');$a$,
      $b$if not hub_is_admin() then perform banking_require('settings.manage'); end if;$b$)
  ) as v(fn, old_text, new_text) loop
    def := pg_get_functiondef(f.fn);
    changed := replace(def, f.old_text, f.new_text);
    if changed = def then raise exception 'Unexpected definition of %', f.fn; end if;
    execute changed;
  end loop;
end $$;

drop policy quotation_templates_insert on public.quotation_templates;
create policy quotation_templates_insert on public.quotation_templates for insert to authenticated with check (public.hub_is_admin());
drop policy quotation_templates_delete on public.quotation_templates;
create policy quotation_templates_delete on public.quotation_templates for delete to authenticated using (public.hub_is_admin());
drop policy quotation_templates_update on public.quotation_templates;
create policy quotation_templates_update on public.quotation_templates for update to authenticated using (true) with check (deleted_at is null or public.hub_is_admin());

drop policy quotation_templates_write on storage.objects;
create policy quotation_templates_write on storage.objects for all to authenticated
  using (bucket_id = 'quotation-templates' and public.hub_is_admin())
  with check (bucket_id = 'quotation-templates' and public.hub_is_admin());
