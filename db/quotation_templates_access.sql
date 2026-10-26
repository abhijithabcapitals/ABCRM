-- Quotation templates: let everyone EDIT template config, keep file upload +
-- delete admin-only, and maintain an edit history.
-- Run in the Supabase SQL editor (idempotent).
--
-- Access model:
--   SELECT  — any authenticated user (already the case; kept here for clarity).
--   UPDATE  — any authenticated user MAY edit config, but may NOT soft-delete
--             (with-check blocks setting deleted_at unless admin).
--   INSERT  — admins only (creating a new template requires uploading a .docx,
--             and storage upload is admin-only anyway).
--   DELETE  — admins only (hard delete; soft-delete via deleted_at is UPDATE).
-- Storage bucket write (upload/replace/delete the .docx) stays admin-only —
-- see quotation_maker.sql; not changed here.

-- Drop the old blanket admin-write policy and replace with granular ones.
drop policy if exists quotation_templates_admin_write on quotation_templates;

drop policy if exists quotation_templates_insert on quotation_templates;
create policy quotation_templates_insert on quotation_templates
  for insert to authenticated
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists quotation_templates_update on quotation_templates;
create policy quotation_templates_update on quotation_templates
  for update to authenticated
  using (true)
  with check (
    deleted_at is null
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  );

drop policy if exists quotation_templates_delete on quotation_templates;
create policy quotation_templates_delete on quotation_templates
  for delete to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ── Edit history ──
create table if not exists quotation_template_history (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references quotation_templates(id) on delete cascade,
  freezone     text,
  fields       jsonb,
  usd_rate     numeric,
  file_name    text,
  storage_path text,
  action       text,                 -- 'insert' | 'update' | 'delete'
  changed_by   text,
  changed_at   timestamptz default now()
);

create index if not exists quotation_template_history_tpl_idx
  on quotation_template_history (template_id, changed_at desc);

alter table quotation_template_history enable row level security;

-- Read: any authenticated user. Rows are only written by the trigger below
-- (SECURITY DEFINER), so no insert/update/delete policies are needed.
drop policy if exists quotation_template_history_select on quotation_template_history;
create policy quotation_template_history_select on quotation_template_history
  for select to authenticated using (true);

-- Snapshot every insert/update into the history table.
create or replace function _abcap_snapshot_quotation_template()
returns trigger language plpgsql security definer as $$
begin
  insert into quotation_template_history
    (template_id, freezone, fields, usd_rate, file_name, storage_path, action, changed_by, changed_at)
  values (
    new.id, new.freezone, new.fields, new.usd_rate, new.file_name, new.storage_path,
    case
      when tg_op = 'INSERT' then 'insert'
      when new.deleted_at is not null and old.deleted_at is null then 'delete'
      else 'update'
    end,
    new.updated_by, coalesce(new.updated_at, now())
  );
  return new;
end;
$$;

drop trigger if exists trg_snapshot_quotation_template on quotation_templates;
create trigger trg_snapshot_quotation_template
  after insert or update on quotation_templates
  for each row execute function _abcap_snapshot_quotation_template();
