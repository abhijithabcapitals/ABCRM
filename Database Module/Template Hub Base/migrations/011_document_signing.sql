-- =====================================================================
-- Template Hub Base - shared document signing                       011
-- =====================================================================
-- One signing record for every client document family, with an approver list per signing company.
--   Companies: ab_capital and ardentax, always derived from the document row, never from the caller. Ardentax for ardentax_documents
--   and for hub_documents whose library_template starts with 'Ardentax'; AB Capital for everything else.
--   Approver: a listed approver of that company or, while its list is empty, a CRM administrator (admin_is()). Hub admins and managers
--   do not count. Only a CRM administrator edits the lists and the image paths.
--   Signing is optional: nothing here blocks the send, download, insert or update of an unsigned document. The document row keeps its
--   own unsigned files; the signed copies are named in document_signatures, under <document prefix>/<id>/signed/.
--   Images: private bucket hub-documents, under signatures/<company>/ (and accounting-signature/ for ab_capital, as Accounting has it today).
-- Until Accounting moves onto this (Task 5), its approvers and image stay mirrored in accounting_proposal_defaults, both ways.
-- Nothing in this file holds a name of a person, an image, a price or a client.
-- Run after 010. Re-runnable. Undo with rollback/011_rollback.sql. Live migration name: template_hub_011_document_signing.
-- =====================================================================

-- ── Settings ─────────────────────────────────────────────────────────────
-- Seeded once from Accounting's approvers and image. A re-run keeps what was saved since.
insert into public.hub_settings (key, value)
select 'document_signing', jsonb_build_object('companies', jsonb_build_object(
  'ab_capital', jsonb_build_object('name', 'AB Capital Services FZE', 'approvers', coalesce(d.v -> 'approvers', '[]'::jsonb),
                                   'signature_path', d.v -> 'signature_path', 'uploaded_at', d.v -> 'signature_uploaded_at', 'uploaded_by', d.v -> 'signature_uploaded_by'),
  'ardentax',   jsonb_build_object('name', 'Ardentax', 'approvers', '[]'::jsonb, 'signature_path', null, 'uploaded_at', null, 'uploaded_by', null)))
  from (select (select value from public.hub_settings where key = 'accounting_proposal_defaults') as v) d
on conflict (key) do nothing;

-- ── Change stamps ────────────────────────────────────────────────────────
-- content_changed_at moves only when a content column changes value (doc_sign_content_changed below). Status, mail, approval, OneDrive and
-- signing columns do not move it. The banking tables have no created_at, so their stamp starts at the row's creation (or this migration).
-- banking_receipts is append-only, so there the column is only the creation stamp.
alter table public.hub_documents add column if not exists content_changed_at timestamptz;
alter table public.ardentax_documents add column if not exists content_changed_at timestamptz;
alter table public.banking_quotations add column if not exists content_changed_at timestamptz default now();
alter table public.banking_engagement_letters add column if not exists content_changed_at timestamptz default now();
alter table public.banking_receipts add column if not exists content_changed_at timestamptz default now();

-- ── The signing record ───────────────────────────────────────────────────
create table if not exists public.document_signatures (
  id uuid primary key default gen_random_uuid(),
  source_table text not null check (source_table in ('hub_documents', 'ardentax_documents', 'banking_quotations', 'banking_engagement_letters', 'banking_receipts')),
  source_id uuid not null,
  company text not null check (company in ('ab_capital', 'ardentax')),
  signed_by uuid not null references public.profiles(id),
  signed_at timestamptz not null default now(),
  word_path text,
  pdf_path text,
  unsigned_word_path text,          -- what the document held when it was signed
  unsigned_pdf_path text,
  document_changed_at timestamptz,  -- the document's change stamp the signer read
  superseded_at timestamptz,
  superseded_reason text
);
create unique index if not exists document_signatures_one_live on public.document_signatures (source_table, source_id) where superseded_at is null;
create index if not exists document_signatures_source_idx on public.document_signatures (source_table, source_id, signed_at desc);
alter table public.document_signatures enable row level security;
revoke all on public.document_signatures from public, anon, authenticated;
grant select on public.document_signatures to authenticated;
-- Whoever can select the document row sees its signatures: each subquery runs under the caller's own policies on that table.
drop policy if exists doc_sign_read on public.document_signatures;
create policy doc_sign_read on public.document_signatures for select to authenticated using (
  case source_table
    when 'hub_documents' then exists (select 1 from public.hub_documents d where d.id = source_id)
    when 'ardentax_documents' then exists (select 1 from public.ardentax_documents d where d.id = source_id)
    when 'banking_quotations' then exists (select 1 from public.banking_quotations d where d.id = source_id)
    when 'banking_engagement_letters' then exists (select 1 from public.banking_engagement_letters d where d.id = source_id)
    when 'banking_receipts' then exists (select 1 from public.banking_receipts d where d.id = source_id)
    else false end);

-- ── Helpers (not callable from the browser) ──────────────────────────────
-- The signing company of a document row; null when the row does not exist.
create or replace function public.doc_company(p_table text, p_id uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  case p_table
    when 'hub_documents' then
      return (select case when left(coalesce(library_template, ''), 8) = 'Ardentax' then 'ardentax' else 'ab_capital' end from hub_documents where id = p_id);
    when 'ardentax_documents' then return (select 'ardentax' from ardentax_documents where id = p_id);
    when 'banking_quotations' then return (select 'ab_capital' from banking_quotations where id = p_id);
    when 'banking_engagement_letters' then return (select 'ab_capital' from banking_engagement_letters where id = p_id);
    when 'banking_receipts' then return (select 'ab_capital' from banking_receipts where id = p_id);
    else raise exception 'Unknown document table %', coalesce(p_table, '(none)');
  end case;
end $$;

-- The caller may read the row. Same rules as each table's select policy (Template Hub 005, ArdentTax 001, Banking 011).
create or replace function public.doc_sign_readable(p_table text, p_id uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return false; end if;
  case p_table
    when 'hub_documents' then return coalesce((select doc_type <> 'library' or ardentax_can() from hub_documents where id = p_id), false);
    when 'ardentax_documents' then return exists (select 1 from ardentax_documents where id = p_id) and ardentax_can();
    when 'banking_quotations' then return coalesce((select banking_can('quotes.view') and banking_case_visible(case_id) from banking_quotations where id = p_id), false);
    when 'banking_engagement_letters' then return coalesce((select banking_can('agreements.view') and banking_case_visible(case_id) from banking_engagement_letters where id = p_id), false);
    when 'banking_receipts' then
      return coalesce((select banking_can('payments.view') and banking_case_visible(p.case_id) from banking_receipts r join banking_payments p on p.id = r.payment_id where r.id = p_id), false);
    else return false;
  end case;
end $$;

-- The change stamp without the read check.
--   hub_documents: the later of agreement_changed_at and content_changed_at, else created_at.
--   ardentax_documents: content_changed_at, else created_at.
--   banking: the later of content_changed_at and the newest generated Word file of that document (banking_generated_documents).
create or replace function public.doc_sign_stamp(p_table text, p_id uuid) returns timestamptz
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  case p_table
    when 'hub_documents' then return (select coalesce(greatest(agreement_changed_at, content_changed_at), created_at) from hub_documents where id = p_id);
    when 'ardentax_documents' then return (select coalesce(content_changed_at, created_at) from ardentax_documents where id = p_id);
    when 'banking_quotations' then
      return (select greatest(q.content_changed_at, (select max(g.created_at) from banking_generated_documents g where g.kind = 'quote' and g.quotation_id = q.id)) from banking_quotations q where q.id = p_id);
    when 'banking_engagement_letters' then
      return (select greatest(l.content_changed_at, (select max(g.created_at) from banking_generated_documents g where g.kind = 'letter' and g.letter_id = l.id)) from banking_engagement_letters l where l.id = p_id);
    when 'banking_receipts' then
      return (select greatest(r.content_changed_at, (select max(g.created_at) from banking_generated_documents g where g.kind = 'receipt' and g.payment_id = r.payment_id)) from banking_receipts r where r.id = p_id);
    else return null;
  end case;
end $$;

-- Where a document's signed files go. Each sits beside the unsigned files, so the same storage rules apply to both:
--   hub_documents       hub-documents      <department>/<id>/signed/        (as Template Hub, Accounting and proposals store them today)
--   ardentax_documents  hub-documents      ArdentTax (ASP)/<id>/signed/
--   banking_*           banking-documents  <case id>/generated/<id>/signed/ (generated files are <case id>/generated/<uuid>-<name>)
create or replace function public.doc_sign_prefix(p_table text, p_id uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  case p_table
    when 'hub_documents' then return (select department || '/' || id || '/signed/' from hub_documents where id = p_id);
    when 'ardentax_documents' then return (select 'ArdentTax (ASP)/' || id || '/signed/' from ardentax_documents where id = p_id);
    when 'banking_quotations' then return (select case_id || '/generated/' || id || '/signed/' from banking_quotations where id = p_id);
    when 'banking_engagement_letters' then return (select case_id || '/generated/' || id || '/signed/' from banking_engagement_letters where id = p_id);
    when 'banking_receipts' then return (select p.case_id || '/generated/' || r.id || '/signed/' from banking_receipts r join banking_payments p on p.id = r.payment_id where r.id = p_id);
    else return null;
  end case;
end $$;

-- The unsigned files a document holds now: {word, pdf}. Old Template Hub rows keep their Word file in storage_path.
create or replace function public.doc_sign_unsigned(p_table text, p_id uuid) returns text[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  case p_table
    when 'hub_documents' then
      return (select array[coalesce(word_path, case when storage_path ilike '%.docx' then storage_path end), case when storage_path ilike '%.pdf' then storage_path end] from hub_documents where id = p_id);
    when 'ardentax_documents' then return (select array[word_path, pdf_path] from ardentax_documents where id = p_id);
    when 'banking_quotations' then
      return array[(select g.storage_path from banking_generated_documents g where g.kind = 'quote' and g.quotation_id = p_id order by g.created_at desc limit 1), null];
    when 'banking_engagement_letters' then
      return array[(select g.storage_path from banking_generated_documents g where g.kind = 'letter' and g.letter_id = p_id order by g.created_at desc limit 1), null];
    when 'banking_receipts' then
      return array[(select g.storage_path from banking_generated_documents g join banking_receipts r on r.payment_id = g.payment_id
                     where g.kind = 'receipt' and r.id = p_id order by g.created_at desc limit 1), null];
    else return array[null, null]::text[];
  end case;
end $$;

-- Ends the live signature of a document, if any. True when one was ended.
create or replace function public.doc_sign_withdraw(p_table text, p_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update document_signatures set superseded_at = now(), superseded_reason = p_reason
   where source_table = p_table and source_id = p_id and superseded_at is null;
  return found;
end $$;

revoke all on function public.doc_company(text, uuid), public.doc_sign_readable(text, uuid), public.doc_sign_stamp(text, uuid),
  public.doc_sign_prefix(text, uuid), public.doc_sign_unsigned(text, uuid), public.doc_sign_withdraw(text, uuid, text) from public, anon, authenticated;

-- ── Who may sign ─────────────────────────────────────────────────────────
create or replace function public.doc_sign_can(p_company text) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); c jsonb; v uuid[];
begin
  if u is null or p_company is null then return false; end if;
  c := (select value from hub_settings where key = 'document_signing') -> 'companies' -> p_company;
  if c is null or jsonb_typeof(c) <> 'object' then return false; end if;
  v := coalesce(array(select x::uuid from jsonb_array_elements_text(coalesce(c -> 'approvers', '[]'::jsonb)) x), '{}'::uuid[]);
  if cardinality(v) > 0 then return u = any(v); end if;
  return admin_is();
end $$;

-- Accounting reads the AB Capital list from here until Task 5 moves it onto the shared step. Same rule as in 008.
create or replace function public.hub_acct_can_approve() returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return doc_sign_can('ab_capital');
end $$;

-- The change stamp a signer must send back as `seen`. Null when the caller cannot read the document.
create or replace function public.doc_changed_at(p_table text, p_id uuid) returns timestamptz
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not doc_sign_readable(p_table, p_id) then return null; end if;
  return doc_sign_stamp(p_table, p_id);
end $$;

-- ── Signing ──────────────────────────────────────────────────────────────
-- p: source_table, source_id, word_path, pdf_path, seen. Any company in p is ignored: it comes from the row.
create or replace function public.doc_sign_record(p jsonb) returns public.document_signatures
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid := auth.uid(); v_table text := p ->> 'source_table'; v_id uuid := nullif(p ->> 'source_id', '')::uuid;
  v_co text; v_c jsonb; v_seen timestamptz := nullif(p ->> 'seen', '')::timestamptz; v_stamp timestamptz; v_prefix text;
  v_word text := nullif(btrim(coalesce(p ->> 'word_path', '')), ''); v_pdf text := nullif(btrim(coalesce(p ->> 'pdf_path', '')), '');
  v_unsigned text[]; v_found boolean; x text; r document_signatures;
begin
  if u is null then raise exception 'Sign in first'; end if;
  if v_table is null or v_table not in ('hub_documents', 'ardentax_documents', 'banking_quotations', 'banking_engagement_letters', 'banking_receipts') then
    raise exception 'Unknown document table %', coalesce(v_table, '(none)');
  end if;
  -- Read access first, with one message for missing and unreadable, so a caller who cannot read a document learns nothing about it
  -- (not whether it exists, nor its company) and cannot lock it.
  if not doc_sign_readable(v_table, v_id) then raise exception 'The document was not found'; end if;
  -- The row is locked so an edit cannot slip in between the stamp check and the record.
  execute format('select true from public.%I where id = $1 for update', v_table) into v_found using v_id;
  if v_found is null then raise exception 'The document was not found'; end if;
  v_co := doc_company(v_table, v_id);
  v_c := (select value from hub_settings where key = 'document_signing') -> 'companies' -> v_co;
  if not doc_sign_can(v_co) then raise exception 'You are not an approver of %', coalesce(v_c ->> 'name', v_co); end if;
  if nullif(btrim(coalesce(v_c ->> 'signature_path', '')), '') is null then
    raise exception 'Upload the % signature in Settings > Signing first', coalesce(v_c ->> 'name', v_co);
  end if;
  v_stamp := doc_sign_stamp(v_table, v_id);
  -- seen must be the stamp the signer read, to the millisecond: older means the document changed, newer is not a stamp it ever had.
  if v_seen is null or v_stamp is null or date_trunc('milliseconds', v_seen) <> date_trunc('milliseconds', v_stamp) then
    raise exception 'The document changed. Open it again and sign.';
  end if;
  if v_word is null or v_pdf is null then raise exception 'The signed Word and PDF files are needed'; end if;
  v_prefix := doc_sign_prefix(v_table, v_id);
  foreach x in array array[v_word, v_pdf] loop
    if v_prefix is null or left(x, length(v_prefix)) <> v_prefix or substr(x, length(v_prefix) + 1) !~ '^[^/]+$' or substr(x, length(v_prefix) + 1) in ('.', '..') then
      raise exception 'The signed files must be stored under %', coalesce(v_prefix, 'the document''s signed/ folder');
    end if;
  end loop;
  v_unsigned := doc_sign_unsigned(v_table, v_id);
  perform doc_sign_withdraw(v_table, v_id, 'Signed again');
  insert into document_signatures (source_table, source_id, company, signed_by, word_path, pdf_path, unsigned_word_path, unsigned_pdf_path, document_changed_at)
  values (v_table, v_id, v_co, u, v_word, v_pdf, v_unsigned[1], v_unsigned[2], v_stamp)
  returning * into r;
  return r;
end $$;

-- The live signature of a document, or null. Runs under the caller's own read rules.
create or replace function public.doc_sign_live(p_table text, p_id uuid) returns public.document_signatures
language sql stable security invoker set search_path = public, pg_temp as $$
  select * from public.document_signatures where source_table = p_table and source_id = p_id and superseded_at is null
$$;

-- Ends the live signature, from a family's edit or regenerate path. A reader may call it once the document changed after signing;
-- an approver of the company may call it at any time. True when a signature was ended.
create or replace function public.doc_sign_supersede(p_table text, p_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_co text; s document_signatures; v_stamp timestamptz;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  v_co := doc_company(p_table, p_id);
  if v_co is null or not doc_sign_readable(p_table, p_id) then raise exception 'The document was not found'; end if;
  select * into s from document_signatures where source_table = p_table and source_id = p_id and superseded_at is null for update;
  if s.id is null then return false; end if;
  v_stamp := doc_sign_stamp(p_table, p_id);
  if not doc_sign_can(v_co) and not (v_stamp is not null and (s.document_changed_at is null or date_trunc('milliseconds', v_stamp) > date_trunc('milliseconds', s.document_changed_at))) then
    raise exception 'You are not an approver of %, and the document has not changed since it was signed',
      coalesce((select value from hub_settings where key = 'document_signing') #>> array['companies', v_co, 'name'], v_co);
  end if;
  return doc_sign_withdraw(p_table, p_id, coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Withdrawn'));
end $$;

-- ── Settings > Signing ───────────────────────────────────────────────────
-- p: company, approvers?, signature_path?. CRM administrators only.
create or replace function public.doc_sign_admin_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare cur jsonb; c jsonb; v_co text := p ->> 'company'; v_list jsonb := '[]'::jsonb; x text; v_path text; v_folder text;
begin
  if auth.uid() is null or not admin_is() then raise exception 'Only a CRM administrator can change the signing approvers or images'; end if;
  select value into cur from hub_settings where key = 'document_signing' for update;
  if cur is null then raise exception 'The signing settings are missing. Run migration 011 again'; end if;
  c := cur -> 'companies' -> v_co;
  if v_co is null or c is null or jsonb_typeof(c) <> 'object' then raise exception 'Unknown signing company %', coalesce(v_co, '(none)'); end if;
  if p ? 'approvers' then
    if jsonb_typeof(p -> 'approvers') <> 'array' then raise exception 'The approvers must be a list'; end if;
    for x in select jsonb_array_elements_text(p -> 'approvers') loop
      if x !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or not exists (select 1 from profiles where id = x::uuid) then
        raise exception 'An approver is not a known user';
      end if;
      if not v_list @> to_jsonb(lower(x)) then v_list := v_list || jsonb_build_array(lower(x)); end if;
    end loop;
    c := c || jsonb_build_object('approvers', v_list);
  end if;
  if p ? 'signature_path' then
    v_path := nullif(btrim(coalesce(p ->> 'signature_path', '')), '');
    if v_path is null then
      c := c || jsonb_build_object('signature_path', null, 'uploaded_at', null, 'uploaded_by', null);
    else
      v_folder := 'signatures/' || v_co || '/';
      if not ((left(v_path, length(v_folder)) = v_folder or (v_co = 'ab_capital' and left(v_path, 21) = 'accounting-signature/'))
              and position('..' in v_path) = 0) then
        raise exception 'The signature must be stored under %', v_folder;
      end if;
      c := c || jsonb_build_object('signature_path', v_path, 'uploaded_at', now(), 'uploaded_by', auth.uid());
    end if;
  end if;
  cur := jsonb_set(cur, array['companies', v_co], c);
  update hub_settings set value = cur where key = 'document_signing';
  return cur;
end $$;

-- ── Accounting mirror ────────────────────────────────────────────────────
-- Accounting's screens (hub_acct_admin_save, the approve step's image) still use accounting_proposal_defaults. Until Task 5 the AB Capital
-- approvers and image are copied between the two keys whenever either changes, so both always agree.
create or replace function public.doc_sign_settings_sync() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare a jsonb; c jsonb;
begin
  -- Set only around this function's own mirror write, so the copy it makes does not copy back. Any other update, from any depth, mirrors.
  if coalesce(current_setting('doc_sign.syncing', true), '') = 'on' then return null; end if;
  perform set_config('doc_sign.syncing', 'on', true);
  if new.key = 'accounting_proposal_defaults' then
    a := jsonb_build_object('approvers', coalesce(new.value -> 'approvers', '[]'::jsonb), 'signature_path', new.value -> 'signature_path',
                            'uploaded_at', new.value -> 'signature_uploaded_at', 'uploaded_by', new.value -> 'signature_uploaded_by');
    update hub_settings set value = jsonb_set(value, '{companies,ab_capital}', (value #> '{companies,ab_capital}') || a)
     where key = 'document_signing' and jsonb_typeof(value #> '{companies,ab_capital}') = 'object'
       and jsonb_build_object('approvers', coalesce(value #> '{companies,ab_capital,approvers}', '[]'::jsonb), 'signature_path', value #> '{companies,ab_capital,signature_path}',
                              'uploaded_at', value #> '{companies,ab_capital,uploaded_at}', 'uploaded_by', value #> '{companies,ab_capital,uploaded_by}') is distinct from a;
  elsif new.key = 'document_signing' then
    c := new.value #> '{companies,ab_capital}';
    if c is null then perform set_config('doc_sign.syncing', 'off', true); return null; end if;
    a := jsonb_build_object('approvers', coalesce(c -> 'approvers', '[]'::jsonb), 'signature_path', c -> 'signature_path',
                            'signature_uploaded_at', c -> 'uploaded_at', 'signature_uploaded_by', c -> 'uploaded_by');
    update hub_settings set value = value || a
     where key = 'accounting_proposal_defaults'
       and jsonb_build_object('approvers', coalesce(value -> 'approvers', '[]'::jsonb), 'signature_path', value -> 'signature_path',
                              'signature_uploaded_at', value -> 'signature_uploaded_at', 'signature_uploaded_by', value -> 'signature_uploaded_by') is distinct from a;
  end if;
  perform set_config('doc_sign.syncing', 'off', true);
  return null;
end $$;
revoke all on function public.doc_sign_settings_sync() from public, anon, authenticated;
drop trigger if exists doc_sign_settings_sync on public.hub_settings;
create trigger doc_sign_settings_sync after update on public.hub_settings for each row
  when (new.key in ('accounting_proposal_defaults', 'document_signing')) execute function public.doc_sign_settings_sync();

-- ── A content edit ends the live signature ───────────────────────────────
-- The trigger arguments are the table's content columns. When any of them changes value, content_changed_at moves and the live
-- signature is superseded ('Document changed'). hub_documents: the accepted option and file_history inside field_values are not content;
-- on multi-option documents (Accounting quote, proposal) lines, services and totals mirror the accepted option, so they are not content either.
create or replace function public.doc_sign_content_changed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare o jsonb; n jsonb;
begin
  select jsonb_object_agg(key, value) into o from jsonb_each(to_jsonb(old)) where key = any(tg_argv);
  select jsonb_object_agg(key, value) into n from jsonb_each(to_jsonb(new)) where key = any(tg_argv);
  if tg_table_name = 'hub_documents' then
    if jsonb_typeof(o -> 'field_values') = 'object' then o := jsonb_set(o, '{field_values}', (o -> 'field_values') #- '{quote,accepted_option}' #- '{proposal,accepted_option}' #- '{file_history}'); end if;
    if jsonb_typeof(n -> 'field_values') = 'object' then n := jsonb_set(n, '{field_values}', (n -> 'field_values') #- '{quote,accepted_option}' #- '{proposal,accepted_option}' #- '{file_history}'); end if;
    if to_jsonb(new) ->> 'library_template' in ('AB Capital/Accounting Quote', 'AB Capital/Proposal') then
      o := o - array['lines', 'services', 'vat_mode', 'vat_rate', 'vat_amount', 'total_amount'];
      n := n - array['lines', 'services', 'vat_mode', 'vat_rate', 'vat_amount', 'total_amount'];
    end if;
  end if;
  if o is distinct from n then
    new.content_changed_at := now();
    perform doc_sign_withdraw(tg_table_name, (to_jsonb(new) ->> 'id')::uuid, 'Document changed');
  end if;
  return new;
end $$;
revoke all on function public.doc_sign_content_changed() from public, anon, authenticated;

drop trigger if exists doc_sign_content on public.hub_documents;
create trigger doc_sign_content before update on public.hub_documents for each row execute function public.doc_sign_content_changed(
  'doc_type', 'department', 'company', 'document_number', 'client_name', 'contact_name', 'contact_email', 'contact_phone', 'client_address',
  'license_number', 'vat_trn', 'services', 'lines', 'vat_mode', 'vat_rate', 'vat_amount', 'total_amount', 'valid_until', 'notes',
  'field_values', 'library_template', 'library_file_id', 'template_key', 'storage_path', 'word_path', 'agreement_changed_at');
drop trigger if exists doc_sign_content on public.ardentax_documents;
create trigger doc_sign_content before update on public.ardentax_documents for each row execute function public.doc_sign_content_changed(
  'doc_type', 'document_number', 'version', 'quote_type', 'client_name', 'selected_package', 'volume', 'one_time', 'annual', 'year1_total',
  'details', 'word_path', 'pdf_path');
drop trigger if exists doc_sign_content on public.banking_quotations;
create trigger doc_sign_content before update on public.banking_quotations for each row execute function public.doc_sign_content_changed(
  'quotation_number', 'version', 'case_id', 'recommendation_id', 'bank_id', 'scheme_id', 'quotation_date', 'valid_until', 'payment_terms', 'remarks',
  'vat_mode', 'vat_rate', 'bank_fee_total', 'service_fee_total', 'supplementary_total', 'discount_total', 'vat_amount', 'total_amount',
  'direct_to_bank_total', 'initial_deposit_memo', 'minimum_balance_memo');
drop trigger if exists doc_sign_content on public.banking_engagement_letters;
create trigger doc_sign_content before update on public.banking_engagement_letters for each row execute function public.doc_sign_content_changed(
  'letter_number', 'case_id', 'quotation_id', 'version', 'letter_date', 'content');
-- banking_receipts is append-only (banking_receipts_immutable, Banking 001), so its row never changes: content_changed_at is only its creation stamp,
-- and a regenerated receipt file moves the stamp through banking_generated_documents.
drop trigger if exists doc_sign_content on public.banking_receipts;

-- ── Grants ───────────────────────────────────────────────────────────────
revoke all on function public.doc_sign_can(text), public.hub_acct_can_approve(), public.doc_changed_at(text, uuid), public.doc_sign_record(jsonb),
  public.doc_sign_live(text, uuid), public.doc_sign_supersede(text, uuid, text), public.doc_sign_admin_save(jsonb) from public, anon;
grant execute on function public.doc_sign_can(text), public.hub_acct_can_approve(), public.doc_changed_at(text, uuid), public.doc_sign_record(jsonb),
  public.doc_sign_live(text, uuid), public.doc_sign_supersede(text, uuid, text), public.doc_sign_admin_save(jsonb) to authenticated;

-- ── Signature images ─────────────────────────────────────────────────────
-- hub_docs_read lets any signed-in user read the whole hub-documents bucket. These restrictive policies keep each company's image to
-- that company's approvers (accounting-signature/ counts as ab_capital) and CRM administrators, and let only a CRM administrator add,
-- move or delete one. Administrators read them so the storage API's update and delete (which carry WHERE or RETURNING) find the row.
-- The two permissive admin policies are what lets an administrator update or delete there at all (the bucket has no other).
-- Accounting's hub_docs_accounting_signature_* policies (008) stay until Task 5. Their read rule has no administrator exception, so under
-- accounting-signature/ an administrator who is not an AB Capital approver still cannot read, replace or delete the image until then.
-- storage.objects is owned by supabase_storage_admin on live, so the release checks these policies exist.
do $do$
begin
  if to_regclass('storage.objects') is null then return; end if;
  drop policy if exists doc_sign_image_read on storage.objects;
  create policy doc_sign_image_read on storage.objects as restrictive for select to authenticated
    using (bucket_id <> 'hub-documents' or (name not like 'signatures/%' and name not like 'accounting-signature/%')
           or public.admin_is() or public.doc_sign_can(case when name like 'accounting-signature/%' then 'ab_capital' else split_part(name, '/', 2) end));
  drop policy if exists doc_sign_image_insert on storage.objects;
  create policy doc_sign_image_insert on storage.objects as restrictive for insert to authenticated
    with check (bucket_id <> 'hub-documents' or (name not like 'signatures/%' and name not like 'accounting-signature/%') or public.admin_is());
  drop policy if exists doc_sign_image_update on storage.objects;
  create policy doc_sign_image_update on storage.objects as restrictive for update to authenticated
    using (bucket_id <> 'hub-documents' or (name not like 'signatures/%' and name not like 'accounting-signature/%') or public.admin_is())
    with check (bucket_id <> 'hub-documents' or (name not like 'signatures/%' and name not like 'accounting-signature/%') or public.admin_is());
  drop policy if exists doc_sign_image_delete on storage.objects;
  create policy doc_sign_image_delete on storage.objects as restrictive for delete to authenticated
    using (bucket_id <> 'hub-documents' or (name not like 'signatures/%' and name not like 'accounting-signature/%') or public.admin_is());
  drop policy if exists doc_sign_image_admin_update on storage.objects;
  create policy doc_sign_image_admin_update on storage.objects for update to authenticated
    using (bucket_id = 'hub-documents' and (name like 'signatures/%' or name like 'accounting-signature/%') and public.admin_is())
    with check (bucket_id = 'hub-documents' and (name like 'signatures/%' or name like 'accounting-signature/%') and public.admin_is());
  drop policy if exists doc_sign_image_admin_delete on storage.objects;
  create policy doc_sign_image_admin_delete on storage.objects for delete to authenticated
    using (bucket_id = 'hub-documents' and (name like 'signatures/%' or name like 'accounting-signature/%') and public.admin_is());
end $do$;
