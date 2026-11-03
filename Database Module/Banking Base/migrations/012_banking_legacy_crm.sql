-- =====================================================================
-- Banking Base - import from the old CRM                           012
-- =====================================================================
-- The old CRM's Banking Working Sheet export reuses the Excel import tables, one import per source, and each
-- row is keyed by the old task id, so a later export can be loaded without repeating anything. The loader
-- (scripts/legacy_crm_load.py) merges the two folders first, so a row here is one deal.
-- Staging writes only to the import tables. Applying follows one rule, decided by the user on 02/11/2026:
-- the old CRM wins on status, fee and RM fee, and fills other blanks. A committed case changed in the CRM
-- since its import is never overwritten. Those rows, and rows the loader or an unknown bank held, wait for
-- a person (reconcile_result = 'Conflict').
-- Payment notes are never posted here: a person confirms each one, as with Excel rows.
-- Idempotent: safe to re-run.
-- =====================================================================
alter table public.banking_applications add column if not exists signing_date date;
alter table public.banking_applications add column if not exists opening_date date;

alter table public.banking_excel_import_rows add column if not exists legacy_task_id text;
alter table public.banking_excel_import_rows add column if not exists matched_row_id uuid references public.banking_excel_import_rows(id);
alter table public.banking_excel_import_rows add column if not exists reconcile_result text
  check (reconcile_result in ('New','Matches Draft','Matches Committed','Conflict','No Status'));
alter table public.banking_excel_import_rows add column if not exists conflicts jsonb not null default '[]';
create unique index if not exists banking_imp_rows_legacy_uq on public.banking_excel_import_rows (legacy_task_id) where legacy_task_id is not null;
create index if not exists banking_imp_rows_matched_idx on public.banking_excel_import_rows (matched_row_id) where matched_row_id is not null;

update public.banking_partners set aliases = aliases || 'MASHREQ BANK'::text
 where bank_code = 'MASHREQ' and not 'MASHREQ BANK' = any(aliases);

create or replace function public.banking_legacy_key(p text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select replace(banking_name_key(p), ' ', '')
$$;
create index if not exists banking_imp_rows_company_idx on public.banking_excel_import_rows (public.banking_legacy_key(mapped ->> 'company'));

create or replace function public.banking_legacy_bank(p text) returns text
language sql stable set search_path = public, pg_temp as $$
  select bank_code from banking_partners where upper(trim(p)) = any(aliases) or upper(bank_name) = upper(trim(p)) limit 1
$$;

-- Where the old CRM overrides the row it matched. Blanks are not differences. Dates and RM
-- names are not listed: the dates go to their own columns, and RM spellings vary too much to hold a row for.
create or replace function public.banking_legacy_conflicts(m jsonb, d jsonb, p_committed boolean, p_status text, p_draft_status text) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  out jsonb := '[]';
  f1 numeric := coalesce((m ->> 'fee')::numeric, 0); f2 numeric := coalesce((d ->> 'fee')::numeric, 0);
  k1 numeric := coalesce((m ->> 'rm_fee')::numeric, 0); k2 numeric := coalesce((d ->> 'rm_fee')::numeric, 0);
begin
  if p_status <> p_draft_status then out := out || jsonb_build_object('field', 'status', 'old_crm', p_status, 'draft', p_draft_status); end if;
  if (f1 > 0 and f2 > 0 and f1 <> f2) or (p_committed and f1 > 0 and f2 = 0) then out := out || jsonb_build_object('field', 'fee', 'old_crm', f1, 'draft', f2); end if;
  if k1 > 0 and k2 > 0 and k1 <> k2 then out := out || jsonb_build_object('field', 'rm_fee', 'old_crm', k1, 'draft', k2); end if;
  return out;
end $$;

-- Matches each waiting old CRM row to a draft row by company and bank. The closest date wins, then the
-- furthest-along row. A draft row is claimed by one old CRM row only. Writes to the import tables only.
create or replace function public.banking_legacy_reconcile(p_import uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare rw banking_excel_import_rows; d banking_excel_import_rows; m jsonb; c jsonb; w jsonb; v_result text; v_sign date;
begin
  perform banking_require('imports.manage');
  update banking_excel_import_rows set matched_row_id = null, reconcile_result = null, conflicts = '[]' where import_id = p_import and decision = 'Pending';
  for rw in select * from banking_excel_import_rows where import_id = p_import and decision = 'Pending' order by source_row loop
    m := rw.mapped; v_sign := (m ->> 'signing_date')::date; d := null;
    select x.* into d from banking_excel_import_rows x
     where x.import_id <> p_import
       and banking_legacy_key(x.mapped ->> 'company') = banking_legacy_key(m ->> 'company')
       and coalesce(nullif(x.mapped ->> 'bank_resolved', ''), banking_legacy_bank(x.mapped ->> 'bank_raw')) = m ->> 'bank_resolved'
       and not exists (select 1 from banking_excel_import_rows o where o.import_id = p_import and o.matched_row_id = x.id)
     order by coalesce(m ->> 'signing_date' in (x.mapped ->> 'signing_date', x.mapped ->> 'date', x.mapped ->> 'lead_date'), false) desc,
       case x.decision when 'Committed' then 0 when 'Approved' then 1 when 'Pending' then 2 else 3 end,
       abs(coalesce((x.mapped ->> 'signing_date')::date, (x.mapped ->> 'date')::date, (x.mapped ->> 'lead_date')::date) - v_sign) nulls last,
       x.source_sheet, x.source_row
     limit 1;
    -- A repeat of a row that already has a case belongs to that case.
    if d.id is not null and d.decision <> 'Committed' then
      select x.* into d from banking_excel_import_rows x
       where x.id = d.id or (x.duplicate_key = d.duplicate_key and x.decision = 'Committed' and x.import_id <> p_import
         and not exists (select 1 from banking_excel_import_rows o where o.import_id = p_import and o.matched_row_id = x.id))
       order by (x.decision = 'Committed') desc, x.source_sheet, x.source_row limit 1;
    end if;
    c := '[]'; w := '[]';
    if m ->> 'hold_reason' is not null then c := c || jsonb_build_object('field', 'review', 'old_crm', m ->> 'hold_reason'); end if;
    if m ->> 'bank_resolved' is null then c := c || jsonb_build_object('field', 'bank', 'old_crm', m ->> 'bank_raw', 'draft', 'not in the bank list'); end if;
    if d.id is not null then
      w := banking_legacy_conflicts(m, d.mapped, d.decision = 'Committed', rw.suggested_status, coalesce(d.decided_status, d.suggested_status));
      if d.decision in ('Skipped', 'Error') then c := c || jsonb_build_object('field', 'decision', 'old_crm', 'present', 'draft', d.decision); end if;
    end if;
    v_result := case when jsonb_array_length(c) > 0 then 'Conflict'
                     when d.id is null and rw.suggested_status is null then 'No Status'
                     when d.id is null then 'New'
                     when d.decision = 'Committed' then 'Matches Committed'
                     when coalesce(rw.suggested_status, d.decided_status, d.suggested_status) is null then 'No Status'
                     else 'Matches Draft' end;
    update banking_excel_import_rows set matched_row_id = d.id, reconcile_result = v_result, conflicts = c || w,
      duplicate_key = coalesce(d.duplicate_key, duplicate_key) where id = rw.id;
  end loop;
  return (select jsonb_object_agg(k, n) from (select coalesce(reconcile_result, decision) k, count(*) n from banking_excel_import_rows where import_id = p_import group by 1) s);
end $$;

-- p_rows: [{task_id, raw, mapped, status, payment_note, issues}]. Same task id again replaces
-- the row unless it already has a case. Then matches against the draft. Nothing outside the import tables changes.
create or replace function public.banking_legacy_stage(p_file text, p_sha text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_imp uuid; it jsonb; v_bank text; v_m jsonb; v_row int; v_month text;
begin
  perform banking_require('imports.manage');
  select id into v_imp from banking_excel_imports where column_mapping ->> 'source' = 'old_crm_banking_sheet';
  if v_imp is null then
    insert into banking_excel_imports (file_name, file_sha256, sheets, column_mapping)
    values (p_file, p_sha, '{Old CRM}', jsonb_build_object('source', 'old_crm_banking_sheet')) returning id into v_imp;
  else
    update banking_excel_imports set file_name = p_file, file_sha256 = p_sha where id = v_imp;
  end if;
  for it in select * from jsonb_array_elements(p_rows) loop
    v_m := it -> 'mapped';
    v_bank := banking_legacy_bank(v_m ->> 'bank_raw');
    v_m := v_m || jsonb_build_object('bank_resolved', v_bank);
    v_month := left(v_m ->> 'lead_date', 7);
    select source_row into v_row from banking_excel_import_rows where legacy_task_id = it ->> 'task_id';
    if v_row is null then
      select coalesce(max(source_row), 0) + 1 into v_row from banking_excel_import_rows where import_id = v_imp;
    end if;
    insert into banking_excel_import_rows (import_id, source_sheet, source_row, legacy_task_id, raw, mapped, suggested_status, confidence, issues, duplicate_key, payment_note, payment_review)
    values (v_imp, 'Old CRM', v_row, it ->> 'task_id', it -> 'raw', v_m, it ->> 'status', 'Medium',
            coalesce(array(select jsonb_array_elements_text(it -> 'issues')), '{}'),
            banking_legacy_key(v_m ->> 'company') || '|' || coalesce(v_bank, upper(v_m ->> 'bank_raw')) || '|' || coalesce(v_month, ''),
            it ->> 'payment_note', case when it ->> 'payment_note' is null then 'Not Needed' else 'Pending' end)
    on conflict (legacy_task_id) where legacy_task_id is not null do update set
      raw = excluded.raw, mapped = excluded.mapped, suggested_status = excluded.suggested_status, issues = excluded.issues,
      duplicate_key = excluded.duplicate_key, payment_note = excluded.payment_note, payment_review = excluded.payment_review,
      decision = 'Pending', error = null
    where banking_excel_import_rows.decision <> 'Committed' and banking_excel_import_rows.raw is distinct from excluded.raw;
  end loop;
  update banking_excel_imports i set total_rows = (select count(*) from banking_excel_import_rows r where r.import_id = i.id) where i.id = v_imp;
  return jsonb_build_object('import_id', v_imp, 'result', banking_legacy_reconcile(v_imp));
end $$;

-- Puts the old CRM's status and fee on a case committed from the draft. False, changing nothing, if anyone
-- has worked on the case since its import.
create or replace function public.banking_legacy_override(rw banking_excel_import_rows, d banking_excel_import_rows) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare a banking_applications; v_quote uuid; v_reco uuid; v_status text := rw.suggested_status; v_fee numeric := (rw.mapped ->> 'fee')::numeric; v_stage int; v_old int;
begin
  select * into a from banking_applications where id = d.application_id for update;
  if a.status is distinct from coalesce(d.decided_status, d.suggested_status)
     or exists (select 1 from banking_quotations where case_id = d.case_id and not is_imported)
     or not (select is_historical from banking_cases where id = d.case_id) then
    return false;
  end if;
  if rw.conflicts @> '[{"field":"status"}]' then
    v_stage := case when v_status in ('Approved', 'Rejected') then 17 else 8 end;
    update banking_applications set status = v_status, status_date = now(), is_active = v_status <> 'Rejected' where id = a.id;
    insert into banking_application_status_history (application_id, previous_status, new_status, remarks)
    values (a.id, a.status, v_status, 'Old CRM import: old CRM status ' || coalesce(rw.mapped ->> 'status_raw', '–'));
    select current_stage into v_old from banking_cases where id = d.case_id;
    update banking_cases set current_stage = v_stage, legacy_status = rw.mapped ->> 'status_raw',
      outcome = case v_status when 'Approved' then 'Approved' when 'Rejected' then 'Rejected' end where id = d.case_id;
    if v_old is distinct from v_stage then
      insert into banking_case_stage_history (case_id, from_stage, to_stage, remarks) values (d.case_id, v_old, v_stage, 'Old CRM import');
    end if;
  end if;
  if rw.conflicts @> '[{"field":"fee"}]' then
    select id into v_quote from banking_quotations where case_id = d.case_id and is_imported and status = 'Accepted';
    if v_quote is null then
      select id into v_reco from banking_bank_recommendations where case_id = d.case_id and is_selected;
      insert into banking_quotations (case_id, recommendation_id, bank_id, status, vat_mode, is_imported, quotation_date, accepted_at, remarks)
      values (d.case_id, v_reco, a.bank_id, 'Accepted', 'none', true, coalesce((rw.mapped ->> 'lead_date')::date, current_date), now(), 'Imported fee from the old CRM. VAT treatment not recorded in the source.')
      returning id into v_quote;
      insert into banking_quotation_items (quotation_id, item_type, description, unit_amount) values (v_quote, 'Service Fee', 'Historical fee as recorded in the old CRM', v_fee);
    else
      update banking_quotation_items set unit_amount = v_fee where quotation_id = v_quote and item_type = 'Service Fee';
    end if;
    perform banking_quote_recalc(v_quote);
  end if;
  return true;
end $$;

-- Applies the reconciled rows in one transaction. Conflict and No Status rows are left for a person.
create or replace function public.banking_legacy_apply(p_import uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare rw banking_excel_import_rows; d banking_excel_import_rows; v_note text; v_commit jsonb; n_fill int := 0;
begin
  perform banking_require('imports.manage');
  perform set_config('banking.internal', '1', true);
  update banking_excel_import_rows set decision = 'Skipped',
    error = 'Differs from the draft: ' || (select string_agg(e ->> 'field', ', ') from jsonb_array_elements(conflicts) e)
   where import_id = p_import and decision = 'Pending' and reconcile_result = 'Conflict';

  for rw in select * from banking_excel_import_rows where import_id = p_import and decision = 'Pending' and reconcile_result in ('Matches Committed', 'Matches Draft', 'New') loop
    select * into d from banking_excel_import_rows where id = rw.matched_row_id;
    -- The workbook's other sheet often repeats the row: every waiting copy stands down with it.
    if d.id is not null then
      update banking_excel_import_rows set decision = 'Skipped', duplicate_of = rw.id, payment_review = 'Not Needed'
       where import_id <> p_import and decision = 'Pending' and (id = d.id or duplicate_key = d.duplicate_key);
    end if;
    if rw.reconcile_result = 'Matches Committed' and not banking_legacy_override(rw, d) then
      update banking_excel_import_rows set decision = 'Skipped', reconcile_result = 'Conflict', error = 'Changed in the CRM since the import' where id = rw.id;
    elsif rw.reconcile_result = 'Matches Committed' then
      -- The draft row keeps its own note, so the same payment cannot be queued twice for one case.
      update banking_excel_import_rows set decision = 'Committed', client_id = d.client_id, lead_id = d.lead_id, case_id = d.case_id, application_id = d.application_id,
        payment_review = case when d.payment_note is null then rw.payment_review else 'Not Needed' end
       where id = rw.id;
    else
      if d.id is not null then
        v_note := coalesce(rw.payment_note, d.payment_note);
        update banking_excel_import_rows set
          mapped = d.mapped || jsonb_strip_nulls(rw.mapped),
          decided_status = coalesce(rw.suggested_status, d.decided_status, d.suggested_status),
          payment_note = v_note, payment_review = case when v_note is null then 'Not Needed' else 'Pending' end,
          issues = issues || case when rw.payment_note is not null and d.payment_note is not null and rw.payment_note <> d.payment_note
                                  then array['Draft payment note: ' || d.payment_note] else '{}'::text[] end,
          decision = 'Approved' where id = rw.id;
      else
        update banking_excel_import_rows set decided_status = suggested_status, decision = 'Approved' where id = rw.id;
      end if;
    end if;
  end loop;

  v_commit := banking_import_commit(p_import, 100000);
  perform set_config('banking.internal', '1', true);

  for rw in select * from banking_excel_import_rows where import_id = p_import and decision = 'Committed' and application_id is not null loop
    update banking_applications set
      signing_date = coalesce(signing_date, (rw.mapped ->> 'signing_date')::date),
      opening_date = coalesce(opening_date, (rw.mapped ->> 'opening_date')::date),
      relationship_manager_text = coalesce(relationship_manager_text, rw.mapped ->> 'rm')
     where id = rw.application_id;
    update banking_leads set
      contact_person = coalesce(contact_person, rw.mapped ->> 'contact'),
      nationality = coalesce(nationality, rw.mapped ->> 'nationality')
     where id = rw.lead_id;
    if coalesce((rw.mapped ->> 'rm_fee')::numeric, 0) > 0 then
      insert into banking_commissions (application_id, amount, source) values (rw.application_id, (rw.mapped ->> 'rm_fee')::numeric, 'Old CRM RM KB')
      on conflict (application_id) do update set amount = excluded.amount, source = excluded.source where banking_commissions.amount <> excluded.amount;
    end if;
    n_fill := n_fill + 1;
  end loop;

  update banking_excel_imports i set
    committed_rows = (select count(*) from banking_excel_import_rows r where r.import_id = i.id and r.decision = 'Committed'),
    skipped_rows = (select count(*) from banking_excel_import_rows r where r.import_id = i.id and r.decision = 'Skipped'),
    error_rows = (select count(*) from banking_excel_import_rows r where r.import_id = i.id and r.decision = 'Error'),
    status = case when exists (select 1 from banking_excel_import_rows r where r.import_id = i.id and r.decision in ('Pending','Approved','Error')) then 'Partly Committed' else 'Committed' end
   where i.id = p_import;
  perform set_config('banking.internal', '', true);
  return v_commit || jsonb_build_object('linked', n_fill);
end $$;

do $$
declare f text;
begin
  foreach f in array array['banking_legacy_override(public.banking_excel_import_rows, public.banking_excel_import_rows)', 'banking_legacy_reconcile(uuid)', 'banking_legacy_stage(text, text, jsonb)', 'banking_legacy_apply(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
