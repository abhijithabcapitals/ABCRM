-- =====================================================================
-- Template Hub Base - Accounting quote and agreement                008
-- =====================================================================
-- A multi-option Accounting quote (ACQ) and, from the accepted option, the Accounting agreement (ACE), kept in hub_documents:
-- doc_type quote / letter, department Accounting, library_template 'AB Capital/Accounting Quote' / 'AB Capital/Accounting Agreement'.
-- Prices come from the people who type them: nothing in this file holds a price, a bank detail, a client or a signatory.
-- The signature image lives in the private hub-documents bucket under accounting-signature/ and only approvers read it.
-- Run after 007. Re-runnable. Undo with rollback/008_rollback.sql.
-- =====================================================================

-- ── Columns (shared with other proposal work, so each is add-if-missing) ────────────────────────────────
alter table public.hub_documents add column if not exists word_path text;                 -- the Word file; storage_path holds the PDF
alter table public.hub_documents add column if not exists onedrive_path text;
alter table public.hub_documents add column if not exists onedrive_saved_at timestamptz;
alter table public.hub_documents add column if not exists mail_sent_at timestamptz;
alter table public.hub_documents add column if not exists mail_sent_by uuid references public.profiles(id);
alter table public.hub_documents add column if not exists mail_sent_to text;
alter table public.hub_documents add column if not exists mail_claimed_at timestamptz;         -- set while a mail is being sent, so two clicks cannot send twice; expires after 5 minutes
alter table public.hub_documents add column if not exists approved_by uuid references public.profiles(id);
alter table public.hub_documents add column if not exists approved_at timestamptz;
alter table public.hub_documents add column if not exists agreement_changed_at timestamptz; -- when the agreement text last changed; Approve compares it with what the approver read

-- ── Saved packages ───────────────────────────────────────────────────────
create table if not exists public.hub_accounting_packages (
  package_key text primary key,
  name text not null,
  description text not null default '',
  services jsonb not null default '[]'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  schedule1 jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
alter table public.hub_accounting_packages enable row level security;
revoke all on public.hub_accounting_packages from anon, authenticated;
grant select on public.hub_accounting_packages to authenticated;
drop policy if exists hub_acct_packages_read on public.hub_accounting_packages;
create policy hub_acct_packages_read on public.hub_accounting_packages for select to authenticated using (true);

-- ── Settings ─────────────────────────────────────────────────────────────
-- Standard wording and contact start blank: they are typed in Settings. Nothing here holds a price.
insert into public.hub_settings (key, value) values ('accounting_proposal_defaults', jsonb_build_object(
  'approvers', '[]'::jsonb, 'signature_path', null, 'signature_uploaded_at', null, 'signature_uploaded_by', null,
  'standard', jsonb_build_object('scope_notes', '[]'::jsonb, 'fee_notes', '[]'::jsonb, 'please_note', '[]'::jsonb,
                                 'billing', jsonb_build_object('monthly', '', 'quarterly', '', 'commencement', '')),
  'contact', jsonb_build_object('name', '', 'phone', '', 'email', '', 'website', '')))
on conflict (key) do nothing;

-- ── Helpers (not callable from the browser) ──────────────────────────────
create or replace function public.hub_acct_num(p_val jsonb, p_what text) returns numeric
language plpgsql immutable set search_path = public, pg_temp as $$
declare t text;
begin
  if p_val is null or jsonb_typeof(p_val) = 'null' then return null; end if;
  if jsonb_typeof(p_val) = 'number' then return round((p_val #>> '{}')::numeric, 2); end if;
  if jsonb_typeof(p_val) = 'string' then
    t := btrim(p_val #>> '{}');
    if t = '' then return null; end if;
    if t ~ '^-?[0-9]+(\.[0-9]+)?$' then return round(t::numeric, 2); end if;
  end if;
  raise exception 'Enter a valid amount for %', p_what;
end $$;

create or replace function public.hub_acct_texts(p_val jsonb, p_what text) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $$
declare v jsonb := '[]'::jsonb; t jsonb;
begin
  if p_val is null or jsonb_typeof(p_val) = 'null' then return v; end if;
  if jsonb_typeof(p_val) <> 'array' then raise exception '% must be a list', p_what; end if;
  for t in select * from jsonb_array_elements(p_val) loop
    if jsonb_typeof(t) <> 'string' then raise exception '% must be a list of text', p_what; end if;
    if btrim(t #>> '{}') <> '' then v := v || jsonb_build_array(btrim(t #>> '{}')); end if;
  end loop;
  return v;
end $$;

-- Checks a quote and returns it in the stored shape, with every service amount worked out from its sub services.
create or replace function public.hub_acct_quote_clean(q jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o jsonb; s jsonb; b jsonb; v_opts jsonb := '[]'::jsonb; v_svcs jsonb; v_subs jsonb; v_in jsonb; v_n int := 0;
  v_name text; v_sname text; v_basis text; v_bname text; v_amt numeric; v_bamt numeric; v_sum numeric;
begin
  if q is null or jsonb_typeof(q) <> 'object' or jsonb_typeof(q -> 'options') is distinct from 'array' or jsonb_array_length(q -> 'options') = 0 then
    raise exception 'Add at least one option';
  end if;
  for o in select * from jsonb_array_elements(q -> 'options') loop
    v_n := v_n + 1;
    if jsonb_typeof(o) <> 'object' then raise exception 'Option % is not valid', v_n; end if;
    v_name := btrim(coalesce(o ->> 'name', ''));
    if v_name = '' then raise exception 'Option % needs a package name', v_n; end if;
    if jsonb_typeof(o -> 'services') is distinct from 'array' or jsonb_array_length(o -> 'services') = 0 then
      raise exception 'Option % needs at least one service', v_n;
    end if;
    v_svcs := '[]'::jsonb;
    for s in select * from jsonb_array_elements(o -> 'services') loop
      if jsonb_typeof(s) <> 'object' then raise exception 'A service in option % is not valid', v_n; end if;
      v_sname := btrim(coalesce(s ->> 'name', ''));
      if v_sname = '' then raise exception 'A service in option % needs a name', v_n; end if;
      v_basis := coalesce(s ->> 'basis', '');
      if v_basis not in ('month', 'quarter', 'year', 'once', 'included', 'separate', 'na') then
        raise exception 'Unknown fee basis "%" for %', v_basis, v_sname;
      end if;
      v_amt := hub_acct_num(s -> 'amount', v_sname);
      v_in := case when s -> 'subs' is null or jsonb_typeof(s -> 'subs') = 'null' then '[]'::jsonb else s -> 'subs' end;
      if jsonb_typeof(v_in) <> 'array' then raise exception 'The sub services of % must be a list', v_sname; end if;
      if v_basis in ('included', 'separate', 'na') then
        if v_amt is not null or jsonb_array_length(v_in) > 0 then raise exception '% carries no amount on this fee basis', v_sname; end if;
        v_subs := '[]'::jsonb;
      else
        if v_amt is not null and v_amt < 0 then raise exception 'Enter a fee of zero or more for %', v_sname; end if;
        v_subs := '[]'::jsonb;
        if jsonb_array_length(v_in) > 0 then
          v_sum := 0;
          for b in select * from jsonb_array_elements(v_in) loop
            if jsonb_typeof(b) <> 'object' then raise exception 'A sub service of % is not valid', v_sname; end if;
            v_bname := btrim(coalesce(b ->> 'name', ''));
            if v_bname = '' then raise exception 'A sub service of % needs a name', v_sname; end if;
            v_bamt := hub_acct_num(b -> 'amount', v_bname);
            if v_bamt is null then raise exception 'Sub service % needs an amount', v_bname; end if;
            if v_bamt < 0 then raise exception 'Enter a fee of zero or more for %', v_bname; end if;
            v_sum := v_sum + v_bamt;
            v_subs := v_subs || jsonb_build_array(jsonb_build_object('name', v_bname, 'amount', v_bamt));
          end loop;
          if v_amt is not null and v_amt <> v_sum then raise exception 'The sub services of % do not add up to its amount', v_sname; end if;
          v_amt := v_sum;
        elsif v_amt is null then
          raise exception '% needs an amount', v_sname;
        end if;
      end if;
      v_svcs := v_svcs || jsonb_build_array(jsonb_build_object('name', v_sname, 'basis', v_basis, 'amount', v_amt, 'subs', v_subs));
    end loop;
    v_opts := v_opts || jsonb_build_array(jsonb_build_object(
      'package_key', nullif(btrim(coalesce(o ->> 'package_key', '')), ''), 'name', v_name, 'description', btrim(coalesce(o ->> 'description', '')),
      'notes', hub_acct_texts(o -> 'notes', 'Notes'), 'services', v_svcs));
  end loop;
  return jsonb_build_object('accepted_option', null, 'options', v_opts, 'shared', jsonb_build_object(
    'scope', hub_acct_texts(q #> '{shared,scope}', 'Scope'), 'payment', hub_acct_texts(q #> '{shared,payment}', 'Payment terms'),
    'notes', hub_acct_texts(q #> '{shared,notes}', 'Notes')));
end $$;

-- The lines, service names and total a document row carries for one option. Different fee bases are never added together:
-- the total is the monthly total, or else the first of quarter, year, once, or 0 when no service has an amount.
create or replace function public.hub_acct_mirror(q jsonb, p_idx int) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  o jsonb := q -> 'options' -> p_idx; s jsonb; v_lines jsonb := '[]'::jsonb; v_names jsonb := '[]'::jsonb;
  v_m numeric; v_q numeric; v_y numeric; v_o numeric; v_amt numeric;
begin
  if o is null then raise exception 'Option % does not exist', p_idx + 1; end if;
  for s in select * from jsonb_array_elements(o -> 'services') loop
    v_amt := nullif(s ->> 'amount', '')::numeric;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('description', s ->> 'name', 'basis', s ->> 'basis', 'amount', v_amt, 'subs', s -> 'subs'));
    v_names := v_names || jsonb_build_array(s ->> 'name');
    case s ->> 'basis'
      when 'month' then v_m := coalesce(v_m, 0) + v_amt;
      when 'quarter' then v_q := coalesce(v_q, 0) + v_amt;
      when 'year' then v_y := coalesce(v_y, 0) + v_amt;
      when 'once' then v_o := coalesce(v_o, 0) + v_amt;
      else null;
    end case;
  end loop;
  return jsonb_build_object('lines', v_lines, 'services', v_names, 'total', coalesce(v_m, v_q, v_y, v_o, 0));
end $$;

-- Checks an agreement and returns it in the stored shape.
create or replace function public.hub_acct_agreement_clean(a jsonb, p_option int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_addr jsonb; v_s1 jsonb := '[]'::jsonb; v_s2 jsonb := '[]'::jsonb; r jsonb; v_email text; v_months int := 12; v_days int := 30;
begin
  if a is null or jsonb_typeof(a) <> 'object' then raise exception 'The agreement details are missing'; end if;
  v_addr := hub_acct_texts(a -> 'address', 'Address');
  if jsonb_array_length(v_addr) = 0 then raise exception 'Enter the client address'; end if;
  if btrim(coalesce(a ->> 'signatory_name', '')) = '' then raise exception 'Enter the name of the client signatory'; end if;
  if btrim(coalesce(a ->> 'signatory_title', '')) = '' then raise exception 'Enter the designation of the client signatory'; end if;
  v_email := btrim(coalesce(a ->> 'notices_email', ''));
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Enter a valid email address for notices'; end if;
  if jsonb_typeof(a -> 'schedule1') = 'array' then
    for r in select * from jsonb_array_elements(a -> 'schedule1') loop
      if jsonb_typeof(r) <> 'object' or btrim(coalesce(r ->> 'name', '')) = '' then raise exception 'Each Schedule 1 row needs a name'; end if;
      v_s1 := v_s1 || jsonb_build_array(jsonb_build_object('name', btrim(r ->> 'name'), 'description', btrim(coalesce(r ->> 'description', ''))));
    end loop;
  elsif a -> 'schedule1' is not null and jsonb_typeof(a -> 'schedule1') <> 'null' then raise exception 'Schedule 1 must be a list'; end if;
  if jsonb_typeof(a -> 'schedule2') = 'array' then
    for r in select * from jsonb_array_elements(a -> 'schedule2') loop
      if jsonb_typeof(r) <> 'object' or btrim(coalesce(r ->> 'description', '')) = '' then raise exception 'Each Schedule 2 row needs a description'; end if;
      v_s2 := v_s2 || jsonb_build_array(jsonb_build_object('description', btrim(r ->> 'description'), 'fee', btrim(coalesce(r ->> 'fee', ''))));
    end loop;
  elsif a -> 'schedule2' is not null and jsonb_typeof(a -> 'schedule2') <> 'null' then raise exception 'Schedule 2 must be a list'; end if;
  if nullif(btrim(coalesce(a ->> 'effective_months', '')), '') is not null then
    if btrim(a ->> 'effective_months') !~ '^[0-9]{1,3}$' or btrim(a ->> 'effective_months')::int < 1 then raise exception 'Enter the agreement period in months'; end if;
    v_months := btrim(a ->> 'effective_months')::int;
  end if;
  if nullif(btrim(coalesce(a ->> 'notice_days', '')), '') is not null then
    if btrim(a ->> 'notice_days') !~ '^[0-9]{1,3}$' or btrim(a ->> 'notice_days')::int < 1 then raise exception 'Enter the notice period in days'; end if;
    v_days := btrim(a ->> 'notice_days')::int;
  end if;
  return jsonb_build_object(
    'accepted_option', p_option, 'address', v_addr, 'attention', coalesce(nullif(btrim(coalesce(a ->> 'attention', '')), ''), 'The Management'),
    'signatory_name', btrim(a ->> 'signatory_name'), 'signatory_title', btrim(a ->> 'signatory_title'), 'notices_email', v_email,
    'scope_sentence', btrim(coalesce(a ->> 'scope_sentence', '')), 'schedule1', v_s1, 'scope_notes', hub_acct_texts(a -> 'scope_notes', 'Scope notes'),
    'schedule2', v_s2, 'billing', btrim(coalesce(a ->> 'billing', '')), 'billing_notes', hub_acct_texts(a -> 'billing_notes', 'Billing notes'),
    'effective_months', v_months, 'notice_days', v_days);
end $$;

create or replace function public.hub_acct_approvers() returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array(select x::uuid from hub_settings s, jsonb_array_elements_text(s.value -> 'approvers') x where s.key = 'accounting_proposal_defaults'), '{}'::uuid[])
$$;

revoke all on function public.hub_acct_num(jsonb, text), public.hub_acct_texts(jsonb, text), public.hub_acct_quote_clean(jsonb),
  public.hub_acct_mirror(jsonb, int), public.hub_acct_agreement_clean(jsonb, int), public.hub_acct_approvers() from public, anon, authenticated;

-- ── Who may approve ──────────────────────────────────────────────────────
-- The approver list in Settings; while it is empty, a CRM administrator (profiles.role = 'admin'). Hub admins and managers do not count.
create or replace function public.hub_acct_can_approve() returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v uuid[] := hub_acct_approvers(); u uuid := auth.uid();
begin
  if u is null then return false; end if;
  if cardinality(v) > 0 then return u = any(v); end if;
  return admin_is();
end $$;

-- ── Quote ────────────────────────────────────────────────────────────────
create or replace function public.hub_acct_quote_create(p jsonb) returns public.hub_documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r hub_documents; v_client text := nullif(btrim(coalesce(p ->> 'client_id', '')), ''); v_email text := btrim(coalesce(p ->> 'contact_email', ''));
  v_q jsonb; m jsonb; v_number text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if btrim(coalesce(p ->> 'client_name', '')) = '' then raise exception 'Enter the client name'; end if;
  if btrim(coalesce(p ->> 'contact_name', '')) = '' then raise exception 'Enter the contact person'; end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Enter a valid email address'; end if;
  if v_client is not null and not exists (select 1 from client_master where client_id = v_client) then raise exception 'Unknown client %', v_client; end if;
  v_q := hub_acct_quote_clean(p -> 'quote');
  m := hub_acct_mirror(v_q, 0);
  v_number := hub_next_number('Accounting', 'quote');
  insert into hub_documents (doc_type, department, document_number, document_serial, client_id, client_name, contact_name, contact_email, contact_phone,
                             services, lines, vat_mode, vat_rate, vat_amount, total_amount, library_template, field_values)
  values ('quote', 'Accounting', v_number, hub_serial_of('Accounting', 'quote', v_number), v_client, btrim(p ->> 'client_name'), btrim(p ->> 'contact_name'), v_email,
          nullif(btrim(coalesce(p ->> 'contact_phone', '')), ''), array(select jsonb_array_elements_text(m -> 'services')), m -> 'lines',
          'exclusive', 5, 0, (m ->> 'total')::numeric, 'AB Capital/Accounting Quote', jsonb_build_object('quote', v_q))
  returning * into r;
  return r;
end $$;

-- p_option counts from 0, as accepted_option does.
create or replace function public.hub_acct_accept(p_quote uuid, p_option int) returns public.hub_documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare q hub_documents; r hub_documents; m jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into q from hub_documents where id = p_quote and library_template = 'AB Capital/Accounting Quote' for update;
  if q.id is null then raise exception 'The Accounting quote was not found'; end if;
  if q.status not in ('issued', 'accepted') then raise exception 'Quote % is % and cannot be accepted', q.document_number, q.status; end if;
  if exists (select 1 from hub_documents where parent_id = q.id and doc_type = 'letter' and status <> 'rejected') then
    raise exception 'Quote % already has its agreement, so the accepted option cannot change', q.document_number;
  end if;
  if p_option is null or p_option < 0 or p_option >= jsonb_array_length(q.field_values -> 'quote' -> 'options') then
    raise exception 'Option % does not exist', coalesce(p_option + 1, 0);
  end if;
  m := hub_acct_mirror(q.field_values -> 'quote', p_option);
  update hub_documents set field_values = jsonb_set(field_values, '{quote,accepted_option}', to_jsonb(p_option)),
         services = array(select jsonb_array_elements_text(m -> 'services')), lines = m -> 'lines', total_amount = (m ->> 'total')::numeric,
         status = 'accepted', status_at = now(), status_by = auth.uid()
   where id = q.id returning * into r;
  return r;
end $$;

-- ── Agreement ────────────────────────────────────────────────────────────
create or replace function public.hub_acct_agreement_create(p jsonb) returns public.hub_documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare q hub_documents; r hub_documents; a jsonb; v_number text; v_opt int;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into q from hub_documents where id = nullif(p ->> 'quote_id', '')::uuid and library_template = 'AB Capital/Accounting Quote' for update;
  if q.id is null then raise exception 'The Accounting quote was not found'; end if;
  if q.status <> 'accepted' or q.field_values #>> '{quote,accepted_option}' is null then raise exception 'Accept an option on quote % first', q.document_number; end if;
  if exists (select 1 from hub_documents where parent_id = q.id and doc_type = 'letter' and status <> 'rejected') then
    raise exception 'Quote % already has its agreement', q.document_number;
  end if;
  v_opt := (q.field_values #>> '{quote,accepted_option}')::int;
  a := hub_acct_agreement_clean(p -> 'agreement', v_opt);
  v_number := hub_next_number('Accounting', 'letter');
  insert into hub_documents (parent_id, doc_type, department, document_number, document_serial, client_id, client_name, contact_name, contact_email, contact_phone, client_address,
                             services, lines, vat_mode, vat_rate, vat_amount, total_amount, library_template, field_values, agreement_changed_at)
  values (q.id, 'letter', 'Accounting', v_number, hub_serial_of('Accounting', 'letter', v_number), q.client_id, q.client_name, q.contact_name, q.contact_email, q.contact_phone,
          (select string_agg(x, E'\n') from jsonb_array_elements_text(a -> 'address') x), q.services, q.lines, 'exclusive', q.vat_rate, 0, q.total_amount,
          'AB Capital/Accounting Agreement', jsonb_build_object('agreement', a), now())
  returning * into r;
  return r;
end $$;

-- Editing clears the approval and keeps the files it replaces in field_values.file_history.
create or replace function public.hub_acct_agreement_update(p_id uuid, p_agreement jsonb) returns public.hub_documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare d hub_documents; r hub_documents; a jsonb; v_hist jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into d from hub_documents where id = p_id and library_template = 'AB Capital/Accounting Agreement' for update;
  if d.id is null then raise exception 'The Accounting agreement was not found'; end if;
  a := hub_acct_agreement_clean(p_agreement, (d.field_values #>> '{agreement,accepted_option}')::int);
  v_hist := coalesce(d.field_values -> 'file_history', '[]'::jsonb);
  if d.storage_path is not null or d.word_path is not null then
    v_hist := v_hist || jsonb_build_array(jsonb_build_object('storage_path', d.storage_path, 'word_path', d.word_path,
      'approved_by', d.approved_by, 'approved_at', d.approved_at, 'archived_at', now(), 'archived_by', auth.uid(), 'reason', 'edited'));
  end if;
  update hub_documents set field_values = jsonb_set(jsonb_set(coalesce(field_values, '{}'::jsonb), '{agreement}', a), '{file_history}', v_hist),
         client_address = (select string_agg(x, E'\n') from jsonb_array_elements_text(a -> 'address') x),
         storage_path = null, word_path = null, approved_by = null, approved_at = null, agreement_changed_at = now()
   where id = d.id returning * into r;
  return r;
end $$;

-- Records the approval and swaps in the signed files in one step. p_seen is the agreement_changed_at the approver read.
create or replace function public.hub_acct_approve(p_id uuid, p_pdf text, p_word text, p_seen timestamptz) returns public.hub_documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d hub_documents; r hub_documents; u uuid := auth.uid(); v uuid[] := hub_acct_approvers(); v_hist jsonb; v_other boolean;
begin
  if u is null then raise exception 'Sign in first'; end if;
  if not hub_acct_can_approve() then raise exception 'You are not an approver of Accounting agreements'; end if;
  select * into d from hub_documents where id = p_id and library_template = 'AB Capital/Accounting Agreement' for update;
  if d.id is null then raise exception 'The Accounting agreement was not found'; end if;
  if d.approved_at is not null then raise exception 'Agreement % is already approved', d.document_number; end if;
  if d.created_by = u then
    v_other := case when cardinality(v) > 0 then exists (select 1 from unnest(v) x where x <> u)
                    else exists (select 1 from profiles where role = 'admin' and id <> u) end;
    if v_other then raise exception 'An approver cannot approve an agreement they created'; end if;
  end if;
  if nullif(btrim(coalesce((select value ->> 'signature_path' from hub_settings where key = 'accounting_proposal_defaults'), '')), '') is null then
    raise exception 'Upload the signature first';
  end if;
  if p_seen is null or d.agreement_changed_at is null or date_trunc('milliseconds', p_seen) < date_trunc('milliseconds', d.agreement_changed_at) then raise exception 'The agreement changed after you read it. Read it again'; end if;
  if nullif(btrim(coalesce(p_pdf, '')), '') is null or nullif(btrim(coalesce(p_word, '')), '') is null then raise exception 'The approved PDF and Word files are needed'; end if;
  v_hist := coalesce(d.field_values -> 'file_history', '[]'::jsonb);
  if d.storage_path is not null or d.word_path is not null then
    v_hist := v_hist || jsonb_build_array(jsonb_build_object('storage_path', d.storage_path, 'word_path', d.word_path,
      'approved_by', null, 'approved_at', null, 'archived_at', now(), 'archived_by', u, 'reason', 'draft before approval'));
  end if;
  update hub_documents set storage_path = btrim(p_pdf), word_path = btrim(p_word), approved_by = u, approved_at = now(),
         field_values = jsonb_set(coalesce(field_values, '{}'::jsonb), '{file_history}', v_hist)
   where id = d.id returning * into r;
  return r;
end $$;

-- ── Files, OneDrive, signed copy, Send ───────────────────────────────────
create or replace function public.hub_acct_attach(p_id uuid, p_pdf text, p_word text) returns public.hub_documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare d hub_documents; r hub_documents;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into d from hub_documents where id = p_id and library_template in ('AB Capital/Accounting Quote', 'AB Capital/Accounting Agreement') for update;
  if d.id is null then raise exception 'The Accounting document was not found'; end if;
  if d.approved_at is not null then raise exception 'Approved files cannot be replaced. Edit the agreement first'; end if;
  update hub_documents set storage_path = nullif(btrim(coalesce(p_pdf, '')), ''), word_path = nullif(btrim(coalesce(p_word, '')), '') where id = d.id returning * into r;
  return r;
end $$;

create or replace function public.hub_acct_saved(p_id uuid, p_path text) returns public.hub_documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare r hub_documents;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if nullif(btrim(coalesce(p_path, '')), '') is null then raise exception 'The OneDrive folder is needed'; end if;
  update hub_documents set onedrive_path = btrim(p_path), onedrive_saved_at = now()
   where id = p_id and library_template in ('AB Capital/Accounting Quote', 'AB Capital/Accounting Agreement') returning * into r;
  if r.id is null then raise exception 'The Accounting document was not found'; end if;
  return r;
end $$;

create or replace function public.hub_acct_signed(p_id uuid, p_date date, p_path text) returns public.hub_documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare r hub_documents;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_date is null then raise exception 'Enter the date it was signed'; end if;
  if nullif(btrim(coalesce(p_path, '')), '') is null then raise exception 'Upload the signed copy'; end if;
  update hub_documents set signed_at = p_date, signed_path = btrim(p_path)
   where id = p_id and library_template in ('AB Capital/Accounting Quote', 'AB Capital/Accounting Agreement') returning * into r;
  if r.id is null then raise exception 'The Accounting document was not found'; end if;
  return r;
end $$;

-- A quote can go once it has a PDF. An agreement needs the PDF and its approval.
create or replace function public.hub_acct_can_send(p_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select d.storage_path is not null and (d.library_template = 'AB Capital/Accounting Quote' or d.approved_at is not null)
                     from hub_documents d where d.id = p_id and d.library_template in ('AB Capital/Accounting Quote', 'AB Capital/Accounting Agreement')), false)
$$;

-- ── Settings screens ─────────────────────────────────────────────────────
create or replace function public.hub_acct_package_save(p jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_key text := btrim(coalesce(p ->> 'package_key', '')); v_name text := btrim(coalesce(p ->> 'name', ''));
  v_services jsonb := coalesce(p -> 'services', '[]'::jsonb); v_notes jsonb := coalesce(p -> 'notes', '[]'::jsonb); v_s1 jsonb := coalesce(p -> 'schedule1', '[]'::jsonb);
  v_active boolean := coalesce((p ->> 'active')::boolean, true);
begin
  if not hub_is_admin() then raise exception 'Only a Template Hub administrator can change packages'; end if;
  if v_key = '' or v_name = '' then raise exception 'A package needs a key and a name'; end if;
  if jsonb_typeof(v_services) <> 'array' or jsonb_typeof(v_notes) <> 'array' or jsonb_typeof(v_s1) <> 'array' then raise exception 'Services, notes and Schedule 1 must be lists'; end if;
  insert into hub_accounting_packages (package_key, name, description, services, notes, schedule1, active, updated_at, updated_by)
  values (v_key, v_name, btrim(coalesce(p ->> 'description', '')), v_services, v_notes, v_s1, v_active, now(), auth.uid())
  on conflict (package_key) do update set name = excluded.name, description = excluded.description, services = excluded.services, notes = excluded.notes,
    schedule1 = excluded.schedule1, active = excluded.active, updated_at = now(), updated_by = auth.uid();
  return v_key;
end $$;

-- Standard wording and contact. The approvers and the signature are not touched here.
create or replace function public.hub_acct_defaults_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_std jsonb := p -> 'standard'; v_contact jsonb := p -> 'contact'; v_bill jsonb; cur jsonb; k text;
begin
  if not hub_is_admin() then raise exception 'Only a Template Hub administrator can change the standard wording'; end if;
  if jsonb_typeof(v_std) is distinct from 'object' or jsonb_typeof(v_contact) is distinct from 'object' then raise exception 'Send the standard wording and the contact details'; end if;
  v_bill := coalesce(v_std -> 'billing', '{}'::jsonb);
  if jsonb_typeof(v_bill) <> 'object' then raise exception 'Billing wording must be an object'; end if;
  v_std := jsonb_build_object('scope_notes', hub_acct_texts(v_std -> 'scope_notes', 'Scope notes'), 'fee_notes', hub_acct_texts(v_std -> 'fee_notes', 'Fee notes'),
    'please_note', hub_acct_texts(v_std -> 'please_note', 'Please note'),
    'billing', jsonb_build_object('monthly', btrim(coalesce(v_bill ->> 'monthly', '')), 'quarterly', btrim(coalesce(v_bill ->> 'quarterly', '')),
                                  'commencement', btrim(coalesce(v_bill ->> 'commencement', ''))));
  v_contact := jsonb_build_object('name', btrim(coalesce(v_contact ->> 'name', '')), 'phone', btrim(coalesce(v_contact ->> 'phone', '')),
                                  'email', btrim(coalesce(v_contact ->> 'email', '')), 'website', btrim(coalesce(v_contact ->> 'website', '')));
  update hub_settings set value = value || jsonb_build_object('standard', v_std, 'contact', v_contact) where key = 'accounting_proposal_defaults' returning value into cur;
  if cur is null then raise exception 'The Accounting defaults are missing. Run migration 008 again'; end if;
  return cur;
end $$;

-- The approver list and the signature image path. CRM administrators only: every manager is a Template Hub admin.
create or replace function public.hub_acct_admin_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare cur jsonb; v_list jsonb := '[]'::jsonb; x text; v_path text;
begin
  if auth.uid() is null or not admin_is() then raise exception 'Only a CRM administrator can change the approvers or the signature'; end if;
  select value into cur from hub_settings where key = 'accounting_proposal_defaults' for update;
  if cur is null then raise exception 'The Accounting defaults are missing. Run migration 008 again'; end if;
  if p ? 'approvers' then
    if jsonb_typeof(p -> 'approvers') <> 'array' then raise exception 'The approvers must be a list'; end if;
    for x in select jsonb_array_elements_text(p -> 'approvers') loop
      if x !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or not exists (select 1 from profiles where id = x::uuid) then
        raise exception 'An approver is not a known user';
      end if;
      if not v_list @> to_jsonb(lower(x)) then v_list := v_list || jsonb_build_array(lower(x)); end if;
    end loop;
    cur := cur || jsonb_build_object('approvers', v_list);
  end if;
  if p ? 'signature_path' then
    v_path := nullif(btrim(coalesce(p ->> 'signature_path', '')), '');
    if v_path is null then
      cur := cur || jsonb_build_object('signature_path', null, 'signature_uploaded_at', null, 'signature_uploaded_by', null);
    else
      if v_path not like 'accounting-signature/%' then raise exception 'The signature must be stored under accounting-signature/'; end if;
      cur := cur || jsonb_build_object('signature_path', v_path, 'signature_uploaded_at', now(), 'signature_uploaded_by', auth.uid());
    end if;
  end if;
  update hub_settings set value = cur where key = 'accounting_proposal_defaults';
  return cur;
end $$;

-- ── One kind of letter under an Accounting quote ─────────────────────────
-- hub_document_create makes a plain letter. Under a quote made here only the Accounting agreement may be a letter, and only after an option is accepted.
create or replace function public.hub_acct_letter_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare pq hub_documents;
begin
  if new.doc_type <> 'letter' then return new; end if;
  select * into pq from hub_documents where id = new.parent_id;
  if pq.id is not null and pq.library_template = 'AB Capital/Accounting Quote' then
    if new.library_template is distinct from 'AB Capital/Accounting Agreement' then raise exception 'Use the Accounting agreement'; end if;
    if pq.field_values #>> '{quote,accepted_option}' is null then raise exception 'Accept an option on quote % first', pq.document_number; end if;
  elsif new.library_template = 'AB Capital/Accounting Agreement' then
    raise exception 'An Accounting agreement comes from an Accounting quote';
  end if;
  return new;
end $$;
revoke all on function public.hub_acct_letter_guard() from public, anon, authenticated;
drop trigger if exists hub_acct_letter_guard on public.hub_documents;
create trigger hub_acct_letter_guard before insert on public.hub_documents for each row execute function public.hub_acct_letter_guard();

-- ── Grants ───────────────────────────────────────────────────────────────
revoke all on function public.hub_acct_can_approve(), public.hub_acct_quote_create(jsonb), public.hub_acct_accept(uuid, int), public.hub_acct_agreement_create(jsonb),
  public.hub_acct_agreement_update(uuid, jsonb), public.hub_acct_approve(uuid, text, text, timestamptz), public.hub_acct_attach(uuid, text, text),
  public.hub_acct_saved(uuid, text), public.hub_acct_signed(uuid, date, text), public.hub_acct_can_send(uuid), public.hub_acct_package_save(jsonb),
  public.hub_acct_defaults_save(jsonb), public.hub_acct_admin_save(jsonb) from public, anon;
grant execute on function public.hub_acct_can_approve(), public.hub_acct_quote_create(jsonb), public.hub_acct_accept(uuid, int), public.hub_acct_agreement_create(jsonb),
  public.hub_acct_agreement_update(uuid, jsonb), public.hub_acct_approve(uuid, text, text, timestamptz), public.hub_acct_attach(uuid, text, text),
  public.hub_acct_saved(uuid, text), public.hub_acct_signed(uuid, date, text), public.hub_acct_can_send(uuid), public.hub_acct_package_save(jsonb),
  public.hub_acct_defaults_save(jsonb), public.hub_acct_admin_save(jsonb) to authenticated;

-- ── The signature image ──────────────────────────────────────────────────
-- hub_docs_read lets any signed-in user read the whole hub-documents bucket. These restrictive policies keep the signature to approvers and
-- let only a CRM administrator add it. storage.objects is owned by supabase_storage_admin on live, so the release checks the policies exist.
do $do$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  drop policy if exists hub_docs_accounting_signature_read on storage.objects;
  create policy hub_docs_accounting_signature_read on storage.objects as restrictive for select to authenticated
    using (bucket_id <> 'hub-documents' or name not like 'accounting-signature/%' or public.hub_acct_can_approve());
  drop policy if exists hub_docs_accounting_signature_insert on storage.objects;
  create policy hub_docs_accounting_signature_insert on storage.objects as restrictive for insert to authenticated
    with check (bucket_id <> 'hub-documents' or name not like 'accounting-signature/%' or public.admin_is());
  -- Without these a permissive policy could move a file into the prefix or delete the image.
  drop policy if exists hub_docs_accounting_signature_update on storage.objects;
  create policy hub_docs_accounting_signature_update on storage.objects as restrictive for update to authenticated
    using (bucket_id <> 'hub-documents' or name not like 'accounting-signature/%' or public.admin_is())
    with check (bucket_id <> 'hub-documents' or name not like 'accounting-signature/%' or public.admin_is());
  drop policy if exists hub_docs_accounting_signature_delete on storage.objects;
  create policy hub_docs_accounting_signature_delete on storage.objects as restrictive for delete to authenticated
    using (bucket_id <> 'hub-documents' or name not like 'accounting-signature/%' or public.admin_is());
end $do$;
