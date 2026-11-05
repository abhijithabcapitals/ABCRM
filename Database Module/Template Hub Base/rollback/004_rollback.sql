-- Undoes migrations/004_hub_admin.sql: Template Hub admin rights go back to CRM admins and Banking settings rights.

drop policy quotation_templates_write on storage.objects;
create policy quotation_templates_write on storage.objects for all to authenticated
  using (bucket_id = 'quotation-templates' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (bucket_id = 'quotation-templates' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy quotation_templates_update on public.quotation_templates;
create policy quotation_templates_update on public.quotation_templates for update to authenticated using (true)
  with check (deleted_at is null or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));
drop policy quotation_templates_delete on public.quotation_templates;
create policy quotation_templates_delete on public.quotation_templates for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));
drop policy quotation_templates_insert on public.quotation_templates;
create policy quotation_templates_insert on public.quotation_templates for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

do $$
declare
  f record; def text; changed text;
begin
  for f in select * from (values
    ('public.hub_numbering_status()'::regprocedure,
      $b$hub_is_admin() or banking_can('settings.manage') or business_setup_can('setup.settings.manage')$b$,
      $a$banking_can('settings.manage') or business_setup_can('setup.settings.manage')$a$),
    ('public.hub_numbering_save(text, text, text, integer, text, integer)'::regprocedure,
      $b$if not (hub_is_admin() or (p_department = 'Business Setup' and business_setup_can('setup.settings.manage'))) then$b$,
      $a$if not (p_department = 'Business Setup' and business_setup_can('setup.settings.manage')) then$a$),
    ('public.hub_master_template_set(text, text, text)'::regprocedure,
      $b$if not hub_is_admin() then perform banking_require('settings.manage'); end if;$b$,
      $a$perform banking_require('settings.manage');$a$),
    ('public.banking_numbering_save(text, text, integer, text, integer)'::regprocedure,
      $b$if not hub_is_admin() then perform banking_require('settings.manage'); end if;$b$,
      $a$perform banking_require('settings.manage');$a$)
  ) as v(fn, new_text, old_text) loop
    def := pg_get_functiondef(f.fn);
    changed := replace(def, f.new_text, f.old_text);
    if changed = def then raise exception 'Unexpected definition of %', f.fn; end if;
    execute changed;
  end loop;
end $$;

create or replace function public.my_tabs() returns text[]
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(tab_key), '{}') from member_tab_access where profile_id = auth.uid()
$$;

drop function public.hub_is_admin();
