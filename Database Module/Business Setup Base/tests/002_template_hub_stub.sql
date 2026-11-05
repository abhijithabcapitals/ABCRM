-- LOCAL TEST ONLY: what Template Hub 004 expects to exist on the live database and no migration here creates. Run through tests/run-local.sh before that file.
create table if not exists public.quotation_templates (id uuid primary key default gen_random_uuid(), deleted_at timestamptz);
alter table public.quotation_templates enable row level security;
do $$
declare p text;
begin
  foreach p in array array['quotation_templates_insert', 'quotation_templates_delete', 'quotation_templates_update'] loop
    execute format('drop policy if exists %I on public.quotation_templates', p);
    execute format('create policy %I on public.quotation_templates for all to authenticated using (true)', p);
  end loop;
  drop policy if exists quotation_templates_write on storage.objects;
  create policy quotation_templates_write on storage.objects for all to authenticated using (true);
end $$;
