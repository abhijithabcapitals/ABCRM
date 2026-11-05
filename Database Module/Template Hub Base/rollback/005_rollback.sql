-- Undoes migrations/005_library_fill.sql. Stops if any library document exists, because removing them loses issued numbers.
-- To remove them anyway, first run in the same session: set library.rollback_force = 'yes';
-- Forced: Ardentax library documents are deleted; AB Capital quotes made from a library template stay as ordinary quotes.
do $$
begin
  if to_regclass('public.hub_documents') is not null
     and exists (select 1 from public.hub_documents where doc_type = 'library' or library_template is not null)
     and coalesce(current_setting('library.rollback_force', true), '') <> 'yes' then
    raise exception 'Library documents exist. Export them, then set library.rollback_force to yes.';
  end if;
end $$;

drop policy if exists hub_docs_library_ardentax_read on storage.objects;
drop policy if exists hub_docs_library_ardentax_insert on storage.objects;

drop function if exists public.hub_library_create(jsonb);
drop function if exists public.hub_library_template_upload(text, text, text);
drop function if exists public.hub_library_template_save(jsonb);
drop function if exists public.hub_library_my_access();

delete from public.hub_documents where doc_type = 'library';
alter table public.hub_documents drop constraint if exists hub_documents_library_file_fk;
alter table public.hub_documents drop column if exists library_template;
alter table public.hub_documents drop column if exists library_file_id;
alter table public.hub_documents drop column if exists field_values;
drop table if exists public.hub_library_template_files;
drop table if exists public.hub_library_templates;

-- The policy and the checks as they were before 004.
drop policy if exists hub_doc_read on public.hub_documents;
create policy hub_doc_read on public.hub_documents for select to authenticated using (true);
delete from public.hub_number_counters where department = 'Ardentax Documents' or kind = 'document';
update public.hub_settings set value = value - 'Ardentax Documents' where key = 'document_numbering';
delete from public.service_departments where name = 'Ardentax Documents';
alter table public.hub_documents drop constraint if exists hub_documents_doc_type_check;
alter table public.hub_documents add constraint hub_documents_doc_type_check check (doc_type in ('quote','letter','mail'));
alter table public.hub_number_counters drop constraint if exists hub_number_counters_kind_check;
alter table public.hub_number_counters add constraint hub_number_counters_kind_check check (kind in ('quote','letter','receipt'));

-- The two numbering functions, verbatim from Business Setup 004 (the live text, checked 2026-11-05).
create or replace function public.hub_numbering_status() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_on date := (now() at time zone 'Asia/Dubai')::date; cfg jsonb := (select value from hub_settings where key = 'document_numbering');
  out jsonb := jsonb_build_object('can_manage', hub_is_admin() or banking_can('settings.manage') or business_setup_can('setup.settings.manage')); d text; k text; c jsonb; n int;
begin
  for d in select jsonb_object_keys(cfg) loop
    -- Receipt appears only for a department whose setting has it.
    for k in select unnest(array['quote','letter'] || case when (cfg -> d) ? 'receipt' then array['receipt'] else array[]::text[] end) loop
      c := cfg -> d -> k;
      n := coalesce((select last_serial from hub_number_counters x where x.department = d and x.kind = k and x.period = banking_number_period(c ->> 'restart', v_on)), 0) + 1;
      out := jsonb_set(out, array[d], coalesce(out -> d, '{}'::jsonb) || jsonb_build_object(k, jsonb_build_object('format', c ->> 'format', 'digits', (c ->> 'digits')::int, 'restart', c ->> 'restart', 'next_serial', n, 'preview', banking_number_format(c ->> 'format', (c ->> 'digits')::int, n, v_on))));
    end loop;
  end loop;
  -- Business Banking reads its own numbering.
  return out || jsonb_build_object('Business Banking', (
    select jsonb_object_agg(z.kind, jsonb_build_object('format', z.cf ->> 'format', 'digits', (z.cf ->> 'digits')::int, 'restart', z.cf ->> 'restart', 'next_serial', z.nx, 'preview', banking_number_format(z.cf ->> 'format', (z.cf ->> 'digits')::int, z.nx, v_on)))
      from (select y.kind, y.cf, coalesce((select x.last_serial from banking_number_counters x where x.kind = y.kind and x.period = banking_number_period(y.cf ->> 'restart', v_on)), 0) + 1 as nx
              from (select u.kind, banking_setting('document_numbering') -> u.kind as cf from unnest(array['quote','letter']) as u(kind)) y) z));
end $$;

create or replace function public.hub_numbering_save(p_department text, p_kind text, p_format text, p_digits int, p_restart text, p_next int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_period text;
begin
  -- Numbering is shared by every department: Banking rights as before, and Business Setup settings rights for Business Setup only.
  if not (hub_is_admin() or (p_department = 'Business Setup' and business_setup_can('setup.settings.manage'))) then perform banking_require('settings.manage'); end if;
  if p_department = 'Business Banking' then perform banking_numbering_save(p_kind, p_format, p_digits, p_restart, p_next); return; end if;
  -- Receipt is accepted only where the department's setting already has it.
  if not (p_kind in ('quote','letter') or (p_kind = 'receipt' and coalesce(((select value from hub_settings where key = 'document_numbering') -> p_department) ? 'receipt', false))) then
    raise exception 'Unknown document kind';
  end if;
  if not exists (select 1 from service_departments where name = p_department) then raise exception 'Unknown department'; end if;
  if position('{SERIAL}' in coalesce(p_format, '')) = 0 then raise exception 'The format must contain {SERIAL}'; end if;
  if p_digits not between 1 and 8 then raise exception 'Digits must be between 1 and 8'; end if;
  if p_restart not in ('never','year','month') then raise exception 'Unknown restart rule'; end if;
  if p_next < 1 then raise exception 'The next number must be 1 or more'; end if;
  update hub_settings set value = jsonb_set(value, array[p_department, p_kind], jsonb_build_object('format', p_format, 'digits', p_digits, 'restart', p_restart)) where key = 'document_numbering';
  v_period := banking_number_period(p_restart, (now() at time zone 'Asia/Dubai')::date);
  insert into hub_number_counters (department, kind, period, last_serial) values (p_department, p_kind, v_period, p_next - 1)
  on conflict (department, kind, period) do update set last_serial = excluded.last_serial;
end $$;

revoke all on function public.hub_numbering_status() from public, anon;
grant execute on function public.hub_numbering_status() to authenticated;
revoke all on function public.hub_numbering_save(text, text, text, int, text, int) from public, anon;
grant execute on function public.hub_numbering_save(text, text, text, int, text, int) to authenticated;
