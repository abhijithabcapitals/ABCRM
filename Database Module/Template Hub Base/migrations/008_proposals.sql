-- =====================================================================
-- Template Hub Base - Business Formation Proposal                    008
-- =====================================================================
-- A proposal is a Business Setup quote (doc_type quote, library_template 'AB Capital/Proposal') that holds several options,
-- one per authority. Options are never added together: the quote mirrors Option 1 until the client chooses, and the
-- engagement letter takes the chosen option. Authority wording is stored here by an admin; the migration holds no prices.
-- Run after 007 and Business Setup 004-018. Re-runnable. Undo with rollback/008_rollback.sql.
-- =====================================================================
alter table public.hub_documents add column if not exists word_path text;            -- Word file of a proposal (storage_path is its PDF)
alter table public.hub_documents add column if not exists onedrive_path text;
alter table public.hub_documents add column if not exists onedrive_saved_at timestamptz;
alter table public.hub_documents add column if not exists mail_sent_at timestamptz;
alter table public.hub_documents add column if not exists mail_sent_by uuid references public.profiles(id);
alter table public.hub_documents add column if not exists mail_sent_to text;

create table if not exists public.hub_proposal_authorities (
  authority_key text primary key,
  name text not null,
  kind text not null check (kind in ('free_zone','mainland')),
  description text,
  logo_path text,
  timeline_path text,
  table_title text,
  services jsonb not null default '[]'::jsonb,
  package_includes jsonb not null default '[]'::jsonb,
  red_notes jsonb not null default '[]'::jsonb,
  addons jsonb not null default '[]'::jsonb,
  documents jsonb not null default '[]'::jsonb,
  payment jsonb not null default '[]'::jsonb,
  scope jsonb not null default '[]'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
alter table public.hub_proposal_authorities enable row level security;
revoke all on public.hub_proposal_authorities from public, anon, authenticated;
grant select on public.hub_proposal_authorities to authenticated;
drop policy if exists hub_proposal_authorities_read on public.hub_proposal_authorities;
create policy hub_proposal_authorities_read on public.hub_proposal_authorities for select to authenticated using (true);

-- Blank by design: the repo is public. An admin fills the rate and contact in Template Hub settings.
insert into public.hub_settings (key, value)
values ('proposal_defaults', '{"usd_rate": 3.6725, "contact": {"name": "", "phone": "", "email": "", "website": ""}}'::jsonb)
on conflict (key) do nothing;

-- Checks one list of texts and returns it trimmed.
create or replace function public.hub_proposal_texts(p_list jsonb, p_what text) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $$
declare t jsonb;
begin
  if p_list is null or jsonb_typeof(p_list) = 'null' then return '[]'::jsonb; end if;
  if jsonb_typeof(p_list) <> 'array' then raise exception '% must be a list', p_what; end if;
  return coalesce((select jsonb_agg(to_jsonb(btrim(x))) from jsonb_array_elements_text(p_list) x where btrim(x) <> ''), '[]'::jsonb);
end $$;
revoke all on function public.hub_proposal_texts(jsonb, text) from public, anon, authenticated;

-- Validates the stored shape and returns it clean. Service amounts are recalculated from sub services.
create or replace function public.hub_proposal_clean(p jsonb) returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_rate numeric; o jsonb; s jsonb; b jsonb; v_opts jsonb := '[]'::jsonb; v_svcs jsonb; v_subs jsonb; v_amt numeric; v_sum numeric; v_n int := 0;
  v_shared jsonb := coalesce(p -> 'shared', '{}'::jsonb); v_add jsonb := '[]'::jsonb; k text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'The proposal is missing'; end if;
  if coalesce(p ->> 'usd_rate', '') !~ '^\s*[0-9]+(\.[0-9]+)?\s*$' or (p ->> 'usd_rate')::numeric <= 0 then raise exception 'The USD rate must be more than zero'; end if;
  v_rate := (p ->> 'usd_rate')::numeric;
  if jsonb_typeof(p -> 'options') is distinct from 'array' or jsonb_array_length(p -> 'options') = 0 then raise exception 'Add at least one option'; end if;
  if jsonb_typeof(v_shared) <> 'object' then raise exception 'The shared sections must be an object'; end if;
  for o in select * from jsonb_array_elements(p -> 'options') loop
    v_n := v_n + 1;
    if jsonb_typeof(o) <> 'object' then raise exception 'Option % is not valid', v_n; end if;
    if nullif(btrim(coalesce(o ->> 'authority_key', '')), '') is null then raise exception 'Option % needs an authority', v_n; end if;
    if nullif(btrim(coalesce(o ->> 'activity', '')), '') is null then raise exception 'Option % needs a business activity', v_n; end if;
    if jsonb_typeof(o -> 'services') is distinct from 'array' or jsonb_array_length(o -> 'services') = 0 then raise exception 'Option % needs at least one service', v_n; end if;
    v_svcs := '[]'::jsonb;
    for s in select * from jsonb_array_elements(o -> 'services') loop
      if jsonb_typeof(s) <> 'object' or nullif(btrim(coalesce(s ->> 'name', '')), '') is null then raise exception 'Each service in option % needs a name', v_n; end if;
      v_subs := '[]'::jsonb; v_sum := 0;
      if s -> 'subs' is not null and jsonb_typeof(s -> 'subs') <> 'null' then
        if jsonb_typeof(s -> 'subs') <> 'array' then raise exception 'Sub services of % must be a list', s ->> 'name'; end if;
        for b in select * from jsonb_array_elements(s -> 'subs') loop
          if jsonb_typeof(b) <> 'object' or nullif(btrim(coalesce(b ->> 'name', '')), '') is null then raise exception 'Each sub service of % needs a name', s ->> 'name'; end if;
          if coalesce(b ->> 'amount', '') !~ '^\s*[0-9]+(\.[0-9]+)?\s*$' then raise exception 'Enter an amount of zero or more for %', b ->> 'name'; end if;
          v_amt := (b ->> 'amount')::numeric;
          v_sum := v_sum + v_amt;
          v_subs := v_subs || jsonb_build_array(jsonb_build_object('name', btrim(b ->> 'name'), 'amount', v_amt));
        end loop;
      end if;
      if jsonb_array_length(v_subs) > 0 then
        if nullif(btrim(coalesce(s ->> 'amount', '')), '') is not null then
          if s ->> 'amount' !~ '^\s*[0-9]+(\.[0-9]+)?\s*$' then raise exception 'Enter an amount of zero or more for %', s ->> 'name'; end if;
          if (s ->> 'amount')::numeric <> v_sum then raise exception 'The amount of % disagrees with its sub services', s ->> 'name'; end if;
        end if;
        v_amt := v_sum;
      else
        if coalesce(s ->> 'amount', '') !~ '^\s*[0-9]+(\.[0-9]+)?\s*$' then raise exception 'Enter an amount of zero or more for %', s ->> 'name'; end if;
        v_amt := (s ->> 'amount')::numeric;
      end if;
      v_svcs := v_svcs || jsonb_build_array(jsonb_build_object('name', btrim(s ->> 'name'), 'remarks', nullif(btrim(coalesce(s ->> 'remarks', '')), ''), 'amount', v_amt, 'subs', v_subs));
    end loop;
    v_opts := v_opts || jsonb_build_array(jsonb_build_object(
      'authority_key', btrim(o ->> 'authority_key'), 'authority_name', nullif(btrim(coalesce(o ->> 'authority_name', '')), ''),
      'activity', btrim(o ->> 'activity'), 'title', nullif(btrim(coalesce(o ->> 'title', '')), ''), 'description', nullif(btrim(coalesce(o ->> 'description', '')), ''),
      'logo_path', nullif(btrim(coalesce(o ->> 'logo_path', '')), ''), 'timeline_path', nullif(btrim(coalesce(o ->> 'timeline_path', '')), ''),
      'package_includes', hub_proposal_texts(o -> 'package_includes', 'Package includes'), 'red_notes', hub_proposal_texts(o -> 'red_notes', 'Red notes'),
      'services', v_svcs));
  end loop;
  if v_shared -> 'addons' is not null and jsonb_typeof(v_shared -> 'addons') <> 'null' then
    if jsonb_typeof(v_shared -> 'addons') <> 'array' then raise exception 'Add-ons must be a list'; end if;
    for s in select * from jsonb_array_elements(v_shared -> 'addons') loop
      if jsonb_typeof(s) <> 'object' or nullif(btrim(coalesce(s ->> 'name', '')), '') is null then raise exception 'Each add-on needs a name'; end if;
      if nullif(btrim(coalesce(s ->> 'amount', '')), '') is not null and s ->> 'amount' !~ '^\s*[0-9]+(\.[0-9]+)?\s*$' then raise exception 'Enter an amount of zero or more for %', s ->> 'name'; end if;
      v_add := v_add || jsonb_build_array(jsonb_build_object('name', btrim(s ->> 'name'), 'amount', nullif(btrim(coalesce(s ->> 'amount', '')), '')::numeric, 'text', nullif(btrim(coalesce(s ->> 'text', '')), '')));
    end loop;
  end if;
  return jsonb_build_object('usd_rate', v_rate, 'accepted_option', null, 'options', v_opts,
    'shared', jsonb_build_object('addons', v_add, 'documents', hub_proposal_texts(v_shared -> 'documents', 'Documents'), 'payment', hub_proposal_texts(v_shared -> 'payment', 'Payment'),
      'scope', hub_proposal_texts(v_shared -> 'scope', 'Scope'), 'notes', hub_proposal_texts(v_shared -> 'notes', 'Notes')));
end $$;
revoke all on function public.hub_proposal_clean(jsonb) from public, anon, authenticated;

-- The lines of one option as stored on the quote and letter: one line per service, sub services inside.
create or replace function public.hub_proposal_lines(p_option jsonb) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('description', s ->> 'name', 'amount', (s ->> 'amount')::numeric, 'remarks', s -> 'remarks', 'subs', s -> 'subs')), '[]'::jsonb)
  from jsonb_array_elements(p_option -> 'services') s
$$;
revoke all on function public.hub_proposal_lines(jsonb) from public, anon, authenticated;

create or replace function public.hub_proposal_total(p_option jsonb) returns numeric
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(sum((s ->> 'amount')::numeric), 0) from jsonb_array_elements(p_option -> 'services') s
$$;
revoke all on function public.hub_proposal_total(jsonb) from public, anon, authenticated;

create or replace function public.hub_proposal_create(p jsonb) returns public.hub_documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r hub_documents; v_prop jsonb; v_client text := nullif(btrim(coalesce(p ->> 'client_id', '')), ''); v_email text := btrim(coalesce(p ->> 'contact_email', '')); v_number text; v_id uuid := gen_random_uuid();
  v_first jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  perform business_setup_require('setup.quotes.manage');
  if nullif(btrim(coalesce(p ->> 'client_name', '')), '') is null then raise exception 'Enter the client name'; end if;
  if nullif(btrim(coalesce(p ->> 'contact_name', '')), '') is null then raise exception 'Enter the contact name'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid contact email'; end if;
  if v_client is not null and not exists (select 1 from client_master where client_id = v_client) then raise exception 'Unknown client %', v_client; end if;
  v_prop := hub_proposal_clean(p -> 'proposal');
  v_first := v_prop -> 'options' -> 0;
  v_number := hub_next_number('Business Setup', 'quote');
  insert into hub_documents (id, root_quote_id, doc_type, department, document_number, document_serial, client_id, client_name, contact_name, contact_email, contact_phone,
                             services, lines, vat_mode, vat_rate, vat_amount, total_amount, library_template, field_values)
  values (v_id, v_id, 'quote', 'Business Setup', v_number, hub_serial_of('Business Setup', 'quote', v_number), v_client, btrim(p ->> 'client_name'), btrim(p ->> 'contact_name'), v_email,
          nullif(btrim(coalesce(p ->> 'contact_phone', '')), ''),
          array(select s ->> 'name' from jsonb_array_elements(v_first -> 'services') s), hub_proposal_lines(v_first), 'none', 0, 0, hub_proposal_total(v_first),
          'AB Capital/Proposal', jsonb_build_object('proposal', v_prop))
  returning * into r;
  return r;
end $$;

create or replace function public.hub_proposal_attach(p_id uuid, p_pdf text, p_word text) returns public.hub_documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare r hub_documents;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  perform business_setup_require('setup.quotes.manage');
  if nullif(btrim(coalesce(p_pdf, '')), '') is null then raise exception 'The PDF path is missing'; end if;
  update hub_documents set storage_path = btrim(p_pdf), word_path = nullif(btrim(coalesce(p_word, '')), '')
   where id = p_id and doc_type = 'quote' and library_template = 'AB Capital/Proposal' returning * into r;
  if r.id is null then raise exception 'The proposal was not found'; end if;
  return r;
end $$;

create or replace function public.hub_proposal_saved(p_id uuid, p_path text) returns public.hub_documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare r hub_documents;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  perform business_setup_require('setup.quotes.manage');
  if nullif(btrim(coalesce(p_path, '')), '') is null then raise exception 'The OneDrive path is missing'; end if;
  update hub_documents set onedrive_path = btrim(p_path), onedrive_saved_at = now()
   where id = p_id and doc_type = 'quote' and library_template = 'AB Capital/Proposal' returning * into r;
  if r.id is null then raise exception 'The proposal was not found'; end if;
  return r;
end $$;

-- The engagement letter of a proposal takes the option the client chose (0-based) and fixes the quote to it.
create or replace function public.hub_proposal_letter_create(p jsonb) returns public.hub_documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q hub_documents; r hub_documents; v_opt int; v_o jsonb; v_number text; v_prop jsonb; v_lines jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  perform business_setup_require('setup.quotes.manage');
  select * into q from hub_documents where id = nullif(p ->> 'quote_id', '')::uuid and doc_type = 'quote' and library_template = 'AB Capital/Proposal' for update;
  if q.id is null then raise exception 'The proposal was not found'; end if;
  if q.status not in ('issued', 'accepted') then raise exception 'Proposal % is % and cannot have a letter', q.document_number, q.status; end if;
  if exists (select 1 from hub_documents where parent_id = q.id and doc_type = 'letter' and status <> 'rejected') then raise exception 'Quote % already has its engagement letter', q.document_number; end if;
  if coalesce(p ->> 'option', '') !~ '^[0-9]+$' then raise exception 'Choose the accepted option'; end if;
  v_opt := (p ->> 'option')::int;
  v_prop := q.field_values -> 'proposal';
  v_o := v_prop -> 'options' -> v_opt;
  if v_o is null then raise exception 'Choose the accepted option'; end if;
  v_lines := hub_proposal_lines(v_o);
  v_number := hub_next_number('Business Setup', 'letter');
  insert into hub_documents (parent_id, doc_type, department, document_number, document_serial, client_id, client_name, contact_name, contact_email, contact_phone, client_address,
                             license_number, vat_trn, services, lines, vat_mode, vat_rate, vat_amount, total_amount, library_template, field_values)
  values (q.id, 'letter', 'Business Setup', v_number, hub_serial_of('Business Setup', 'letter', v_number), q.client_id, q.client_name, q.contact_name, q.contact_email,
          coalesce(nullif(btrim(coalesce(p ->> 'contact_phone', '')), ''), q.contact_phone), nullif(btrim(coalesce(p ->> 'client_address', '')), ''),
          nullif(btrim(coalesce(p ->> 'license_number', '')), ''), nullif(btrim(coalesce(p ->> 'vat_trn', '')), ''),
          array(select s ->> 'name' from jsonb_array_elements(v_o -> 'services') s), v_lines, 'none', 0, 0, hub_proposal_total(v_o), 'AB Capital/Engagement Letter',
          jsonb_build_object('accepted_option', v_opt, 'authority_key', v_o ->> 'authority_key', 'authority_name', v_o ->> 'authority_name', 'activity', v_o ->> 'activity'))
  returning * into r;
  update hub_documents set field_values = jsonb_set(field_values, '{proposal,accepted_option}', to_jsonb(v_opt)), lines = v_lines,
         services = r.services, total_amount = r.total_amount,
         status = 'accepted', status_at = case when status = 'accepted' then status_at else now() end, status_by = case when status = 'accepted' then status_by else auth.uid() end
   where id = q.id;
  return r;
end $$;

-- No letter on a proposal until an option is chosen, however the letter is made.
create or replace function public.hub_proposal_letter_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.doc_type = 'letter' and new.parent_id is not null
     and exists (select 1 from hub_documents where id = new.parent_id and library_template = 'AB Capital/Proposal')
     and not (coalesce(new.field_values, '{}'::jsonb) ? 'accepted_option') then
    raise exception 'Choose the accepted option before making the engagement letter';
  end if;
  return new;
end $$;
drop trigger if exists hub_proposal_letter_guard on public.hub_documents;
create trigger hub_proposal_letter_guard before insert on public.hub_documents for each row execute function public.hub_proposal_letter_guard();

create or replace function public.hub_proposal_authority_save(p jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_key text := btrim(coalesce(p ->> 'authority_key', '')); v_name text := btrim(coalesce(p ->> 'name', '')); v_kind text := btrim(coalesce(p ->> 'kind', ''));
  v_services jsonb := coalesce(p -> 'services', '[]'::jsonb); v_active boolean := coalesce((p ->> 'active')::boolean, true); k text; v_lists jsonb := '{}'::jsonb;
begin
  if not hub_is_admin() then raise exception 'You do not have permission to edit authority sets'; end if;
  if v_key = '' or v_name = '' then raise exception 'An authority needs a key and a name'; end if;
  if v_kind not in ('free_zone', 'mainland') then raise exception 'The kind must be free_zone or mainland'; end if;
  if jsonb_typeof(v_services) <> 'array' then raise exception 'Services must be a list'; end if;
  foreach k in array array['package_includes', 'red_notes', 'documents', 'payment', 'scope', 'notes'] loop
    v_lists := v_lists || jsonb_build_object(k, hub_proposal_texts(p -> k, k));
  end loop;
  if jsonb_typeof(coalesce(p -> 'addons', '[]'::jsonb)) <> 'array' then raise exception 'Add-ons must be a list'; end if;
  insert into hub_proposal_authorities (authority_key, name, kind, description, logo_path, timeline_path, table_title, services, package_includes, red_notes, addons, documents, payment, scope, notes, active, updated_by, updated_at)
  values (v_key, v_name, v_kind, nullif(btrim(coalesce(p ->> 'description', '')), ''), nullif(btrim(coalesce(p ->> 'logo_path', '')), ''), nullif(btrim(coalesce(p ->> 'timeline_path', '')), ''),
          nullif(btrim(coalesce(p ->> 'table_title', '')), ''), v_services, v_lists -> 'package_includes', v_lists -> 'red_notes', coalesce(p -> 'addons', '[]'::jsonb), v_lists -> 'documents',
          v_lists -> 'payment', v_lists -> 'scope', v_lists -> 'notes', v_active, auth.uid(), now())
  on conflict (authority_key) do update set name = excluded.name, kind = excluded.kind, description = excluded.description, logo_path = excluded.logo_path, timeline_path = excluded.timeline_path,
    table_title = excluded.table_title, services = excluded.services, package_includes = excluded.package_includes, red_notes = excluded.red_notes, addons = excluded.addons,
    documents = excluded.documents, payment = excluded.payment, scope = excluded.scope, notes = excluded.notes, active = excluded.active, updated_by = auth.uid(), updated_at = now();
  return v_key;
end $$;

create or replace function public.hub_proposal_defaults_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_rate numeric; v_c jsonb := coalesce(p -> 'contact', '{}'::jsonb); v_out jsonb;
begin
  if not hub_is_admin() then raise exception 'You do not have permission to edit the proposal defaults'; end if;
  if coalesce(p ->> 'usd_rate', '') !~ '^\s*[0-9]+(\.[0-9]+)?\s*$' or (p ->> 'usd_rate')::numeric <= 0 then raise exception 'The USD rate must be more than zero'; end if;
  v_rate := (p ->> 'usd_rate')::numeric;
  if jsonb_typeof(v_c) <> 'object' then raise exception 'The contact must be an object'; end if;
  v_out := jsonb_build_object('usd_rate', v_rate, 'contact', jsonb_build_object('name', btrim(coalesce(v_c ->> 'name', '')), 'phone', btrim(coalesce(v_c ->> 'phone', '')),
           'email', btrim(coalesce(v_c ->> 'email', '')), 'website', btrim(coalesce(v_c ->> 'website', ''))));
  insert into hub_settings (key, value) values ('proposal_defaults', v_out) on conflict (key) do update set value = excluded.value;
  return v_out;
end $$;

create or replace function public.hub_proposal_can_send() returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform business_setup_require('setup.quotes.manage');
  return true;
exception when others then
  return false;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'hub_proposal_create(jsonb)', 'hub_proposal_attach(uuid, text, text)', 'hub_proposal_saved(uuid, text)', 'hub_proposal_letter_create(jsonb)',
    'hub_proposal_authority_save(jsonb)', 'hub_proposal_defaults_save(jsonb)', 'hub_proposal_can_send()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.hub_proposal_letter_guard() from public, anon, authenticated;
