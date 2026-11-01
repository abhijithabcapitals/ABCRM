-- =====================================================================
-- Template Hub Base - master templates                             002
-- =====================================================================
-- The Word file each generated document is built from. Every upload is a new row and old rows are kept: the latest
-- row for a template is the one in use, and a row with no file means back to the template built into the CRM.
-- Read: signed-in users, who need it to generate. Change: settings.manage. Run after 001. Idempotent.
-- =====================================================================
create table if not exists public.hub_master_templates (
  id bigint generated always as identity primary key,
  template_file text not null check (template_file in ('Service_Quotation_Template.docx', 'Service_Engagement_Template.docx', 'Quotation_Template.docx', 'Engagement_Letter_Template.docx', 'Fee_Receipt_Voucher_Template.docx')),
  file_name text,
  storage_path text,
  uploaded_by uuid default auth.uid(),
  uploaded_at timestamptz not null default now()
);
create index if not exists hub_master_templates_file_idx on public.hub_master_templates (template_file, id desc);
alter table public.hub_master_templates enable row level security;
revoke all on public.hub_master_templates from public, anon, authenticated;
grant select on public.hub_master_templates to authenticated;
drop policy if exists hub_master_templates_read on public.hub_master_templates;
create policy hub_master_templates_read on public.hub_master_templates for select to authenticated using (true);

-- p_path null returns the template to the built-in file.
create or replace function public.hub_master_template_set(p_file text, p_name text, p_path text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform banking_require('settings.manage');
  if p_path is not null and (coalesce(p_name, '') !~* '\.docx$' or p_path not like 'master-templates/%') then raise exception 'A master template must be an uploaded Word (.docx) file'; end if;
  insert into hub_master_templates (template_file, file_name, storage_path) values (p_file, p_name, p_path);
end $$;
revoke all on function public.hub_master_template_set(text, text, text) from public, anon;
grant execute on function public.hub_master_template_set(text, text, text) to authenticated;
