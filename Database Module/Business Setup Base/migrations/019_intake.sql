-- =====================================================================
-- Business Setup Base - open referral link    019
-- =====================================================================
-- Any member of staff generates a link. Anyone holding it fills the client form with no login, and each submission is a new case at Review, marked with who
-- generated the link. Links never expire: only a manual Revoke stops one. Commission is paid outside the CRM.
-- Until staff move the case to Client Onboarding, the answers and files sit in the intake tables, with no client row. The move creates the form and its documents.
-- A form made this way has no login until the quote is issued, so client_portal_documents.account_id and the form's account_id can be empty until then.
-- The public side is the setup-intake Edge Function, holding the service role: nothing here is open to anon.
-- Run after 016 and 018. Re-runnable. Undo with rollback/019_rollback.sql.
-- =====================================================================

create table if not exists public.business_setup_intake_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id)
);
create index if not exists business_setup_intake_links_owner_idx on public.business_setup_intake_links (created_by);

alter table public.business_setup_cases add column if not exists intake_link_id uuid references public.business_setup_intake_links(id);
alter table public.business_setup_cases add column if not exists referred_by uuid references public.profiles(id);
create index if not exists business_setup_cases_referred_idx on public.business_setup_cases (referred_by) where referred_by is not null;

create table if not exists public.business_setup_intake_submissions (
  id uuid primary key,
  link_id uuid not null references public.business_setup_intake_links(id),
  case_id uuid not null unique references public.business_setup_cases(id),
  form_version int not null references public.business_setup_form_versions(version),
  answers jsonb not null,
  terms_id uuid,
  terms_version int,
  ip_hash text,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);
create index if not exists business_setup_intake_submissions_rate_idx on public.business_setup_intake_submissions (link_id, created_at);
create index if not exists business_setup_intake_submissions_ip_idx on public.business_setup_intake_submissions (ip_hash, created_at);

-- A file is listed here when its upload starts, so a start with no submission can be cleaned up.
create table if not exists public.business_setup_intake_files (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.business_setup_intake_links(id),
  submission_id uuid not null,
  kind text not null,
  file_name text not null,
  size_bytes bigint not null,
  storage_path text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists business_setup_intake_files_submission_idx on public.business_setup_intake_files (submission_id);

alter table public.business_setup_intake_links enable row level security;
alter table public.business_setup_intake_submissions enable row level security;
alter table public.business_setup_intake_files enable row level security;
revoke all on public.business_setup_intake_links, public.business_setup_intake_submissions, public.business_setup_intake_files from public, anon, authenticated;

alter table public.business_setup_onboarding_forms alter column account_id drop not null;
alter table public.client_portal_documents alter column account_id drop not null;

-- A form with no login cannot go back to the client: staff correct it themselves.
create or replace function public.business_setup_form_no_login_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status = 'Returned' and new.account_id is null then
    raise exception 'This client has no login yet, so the form cannot be returned. Correct it here instead.';
  end if;
  return new;
end $$;
revoke all on function public.business_setup_form_no_login_guard() from public, anon, authenticated;
drop trigger if exists business_setup_form_no_login_guard on public.business_setup_onboarding_forms;
create trigger business_setup_form_no_login_guard before update of status on public.business_setup_onboarding_forms for each row execute function public.business_setup_form_no_login_guard();

-- When the client's login is made, their form and files join it, so they see their own documents.
create or replace function public.business_setup_form_account_fill() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.client_master_id is null then return null; end if;
  update client_portal_documents d set account_id = new.id
    from business_setup_onboarding_forms f where f.id = d.form_id and f.client_id = new.client_master_id and d.account_id is null;
  update business_setup_onboarding_forms set account_id = new.id where client_id = new.client_master_id and account_id is null;
  return null;
end $$;
revoke all on function public.business_setup_form_account_fill() from public, anon, authenticated;
drop trigger if exists business_setup_form_account_fill on public.client_portal_accounts;
create trigger business_setup_form_account_fill after insert or update of client_master_id on public.client_portal_accounts for each row execute function public.business_setup_form_account_fill();

-- ── For staff: the links ─────────────────────────────────────────────
-- Any signed-in member of staff, not only Business Setup: leads land in Business Setup, and only the tag follows the person who generated the link.
create or replace function public.business_setup_intake_link_new() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_token text := md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text);
begin
  if auth.uid() is null or not exists (select 1 from profiles where id = auth.uid()) then raise exception 'Sign in first'; end if;
  insert into business_setup_intake_links (token, created_by) values (v_token, auth.uid()) returning id into v_id;
  perform business_setup_audit('business_setup_intake_links', v_id::text, 'intake_link_new', null, jsonb_build_object('created_by', auth.uid()));
  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;

-- Your own links. A holder of setup.cases.approve sees everyone's, but only your own show the token.
create or replace function public.business_setup_intake_link_list() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'token', case when l.created_by = auth.uid() then l.token end, 'mine', l.created_by = auth.uid(),
             'created_by_name', business_setup_person_name(l.created_by), 'created_at', l.created_at, 'revoked_at', l.revoked_at,
             'submissions', (select count(*) from business_setup_intake_submissions s where s.link_id = l.id)) order by l.revoked_at is not null, l.created_at desc), '[]'::jsonb)
    from business_setup_intake_links l
   where l.created_by = auth.uid() or business_setup_can('setup.cases.approve'));
end $$;

create or replace function public.business_setup_intake_link_revoke(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare l business_setup_intake_links;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into l from business_setup_intake_links where id = p_id for update;
  if l.id is null then raise exception 'Link not found'; end if;
  if l.created_by <> auth.uid() and not business_setup_can('setup.cases.approve') then raise exception 'Only the person who generated this link or a manager can revoke it'; end if;
  if l.revoked_at is not null then return; end if;
  update business_setup_intake_links set revoked_at = now(), revoked_by = auth.uid() where id = p_id;
  perform business_setup_audit('business_setup_intake_links', p_id::text, 'intake_link_revoke', null, jsonb_build_object('revoked_by', auth.uid()));
end $$;

-- What the client sent, for staff to read at All Leads before moving the case. The files open once the case has moved.
create or replace function public.business_setup_intake_detail(p_case uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform business_setup_require('setup.access');
  return (select jsonb_build_object('answers', s.answers, 'created_at', s.created_at, 'applied_at', s.applied_at, 'terms_version', s.terms_version,
             'definition', (select v.definition from business_setup_form_versions v where v.version = s.form_version),
             'files', (select coalesce(jsonb_agg(jsonb_build_object('kind', f.kind, 'file_name', f.file_name) order by f.created_at), '[]'::jsonb) from business_setup_intake_files f where f.submission_id = s.id))
    from business_setup_intake_submissions s where s.case_id = p_case);
end $$;

-- Only an admin changes who a case is credited to, and the audit log keeps each change.
create or replace function public.business_setup_case_set_referrer(p_case uuid, p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c business_setup_cases; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not client_portal_is_admin() then raise exception 'Admins only.'; end if;
  if v_reason is null then raise exception 'Enter a reason'; end if;
  select * into c from business_setup_cases where id = p_case for update;
  if c.id is null then raise exception 'Case not found'; end if;
  if p_user is not null and not exists (select 1 from profiles where id = p_user) then raise exception 'That person was not found'; end if;
  update business_setup_cases set referred_by = p_user where id = p_case;
  perform business_setup_audit('business_setup_cases', p_case::text, 'case_referrer_change', jsonb_build_object('referred_by', c.referred_by), jsonb_build_object('referred_by', p_user, 'reason', v_reason));
end $$;

-- Who referred each client, for the Referred by column on All Clients. A client referred on two cases by two people lists both.
create or replace function public.business_setup_referrers() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  return (select coalesce(jsonb_object_agg(t.client_id, t.names), '{}'::jsonb) from (
    select c.client_id, jsonb_agg(distinct business_setup_person_name(c.referred_by)) as names
      from business_setup_cases c where c.client_id is not null and c.referred_by is not null group by c.client_id) t);
end $$;

-- Spam: closes the lead and hands back its stored files for the Edge Function to delete. Not after the case has moved on.
create or replace function public.business_setup_case_spam(p_case uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s business_setup_intake_submissions; v_paths jsonb;
begin
  perform business_setup_require('setup.cases.approve');
  select * into s from business_setup_intake_submissions where case_id = p_case for update;
  if s.id is null then raise exception 'Only a lead from an open link can be marked as spam'; end if;
  if s.applied_at is not null then raise exception 'This case has moved to Client Onboarding, so it cannot be marked as spam. Mark it lost instead.'; end if;
  perform business_setup_case_lost(p_case, 'Spam: ' || coalesce(nullif(btrim(p_reason), ''), 'no reason given'));
  select coalesce(jsonb_agg(storage_path), '[]'::jsonb) into v_paths from business_setup_intake_files where submission_id = s.id;
  delete from business_setup_intake_files where submission_id = s.id;
  return v_paths;
end $$;

revoke all on function public.business_setup_intake_link_new(), public.business_setup_intake_link_list(), public.business_setup_intake_link_revoke(uuid), public.business_setup_intake_detail(uuid),
  public.business_setup_case_set_referrer(uuid, uuid, text), public.business_setup_referrers(), public.business_setup_case_spam(uuid, text) from public, anon;
grant execute on function public.business_setup_intake_link_new(), public.business_setup_intake_link_list(), public.business_setup_intake_link_revoke(uuid), public.business_setup_intake_detail(uuid),
  public.business_setup_case_set_referrer(uuid, uuid, text), public.business_setup_referrers(), public.business_setup_case_spam(uuid, text) to authenticated;

-- ── For the public function. Service role only ───────────────────────
create or replace function public.business_setup_intake_open(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare l business_setup_intake_links;
begin
  select * into l from business_setup_intake_links where token = p_token;
  if l.id is null or l.revoked_at is not null then raise exception 'This link is no longer active. Please contact AB Capital Services FZE.'; end if;
  return jsonb_build_object(
    'version', (select max(version) from business_setup_form_versions),
    'definition', (select v.definition from business_setup_form_versions v order by v.version desc limit 1),
    'terms', (select jsonb_build_object('id', t.id, 'version', t.version, 'title', t.title, 'body', t.body) from client_portal_terms t where t.status = 'Published'));
end $$;

-- Checks one file before its upload starts, and lists it. Returns the storage path.
create or replace function public.business_setup_intake_upload_ok(p_token text, p_submission uuid, p_kind text, p_filename text, p_size bigint) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare l business_setup_intake_links; v_name text := regexp_replace(coalesce(p_filename, ''), '[^A-Za-z0-9._-]+', '_', 'g'); v_path text;
begin
  select * into l from business_setup_intake_links where token = p_token;
  if l.id is null or l.revoked_at is not null then raise exception 'This link is no longer active. Please contact AB Capital Services FZE.'; end if;
  if p_submission is null then raise exception 'Please reload the page and try again.'; end if;
  if exists (select 1 from business_setup_intake_submissions where id = p_submission) then raise exception 'This form has already been sent.'; end if;
  if p_kind is null or p_kind not in ('Passport', 'Emirates visa', 'Emirates ID', 'Ejari', 'Bank statement', 'Utility bill', 'Old visa', 'Old Emirates ID', 'Other') then raise exception 'Choose the document type.'; end if;
  if v_name !~* '\.(pdf|png|jpe?g|webp|tiff?)$' or v_name ~ '\.\.' then raise exception 'Only PDF, JPG, PNG, WEBP and TIFF files can be uploaded.'; end if;
  if p_size is null or p_size <= 0 or p_size > 10485760 then raise exception 'Each file can be up to 10 MB.'; end if;
  perform pg_advisory_xact_lock(hashtext(p_submission::text));
  if (select count(*) from business_setup_intake_files where submission_id = p_submission) >= 15 then raise exception 'A form can hold up to 15 files.'; end if;
  v_path := 'intake/' || p_submission || '/' || gen_random_uuid() || '-' || right(v_name, 100);
  insert into business_setup_intake_files (link_id, submission_id, kind, file_name, size_bytes, storage_path) values (l.id, p_submission, p_kind, left(coalesce(p_filename, v_name), 200), p_size, v_path);
  return v_path;
end $$;

create or replace function public.business_setup_intake_submit(p_token text, p_submission uuid, p_answers jsonb, p_ip_hash text, p_terms uuid default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  l business_setup_intake_links; v_case uuid; t client_portal_terms; v_version int := (select max(version) from business_setup_form_versions);
  v_name text := nullif(btrim(coalesce(p_answers ->> 'client_name', '')), ''); v_email text := nullif(btrim(coalesce(p_answers ->> 'email', '')), ''); v_phone text := nullif(btrim(coalesce(p_answers ->> 'phone', '')), '');
begin
  select * into l from business_setup_intake_links where token = p_token;
  if l.id is null or l.revoked_at is not null then raise exception 'This link is no longer active. Please contact AB Capital Services FZE.'; end if;
  if p_submission is null then raise exception 'Please reload the page and try again.'; end if;
  perform pg_advisory_xact_lock(hashtext(p_submission::text));
  select case_id into v_case from business_setup_intake_submissions where id = p_submission;
  if v_case is not null then return v_case; end if;   -- a double click or a retry makes one case
  if jsonb_typeof(p_answers) is distinct from 'object' or octet_length(p_answers::text) > 100000 then raise exception 'Please check the form and try again.'; end if;
  if v_name is null or v_email is null or v_phone is null then raise exception 'Enter the client name, email and phone.'; end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Enter a valid email address.'; end if;
  perform pg_advisory_xact_lock(hashtext(l.id::text));
  if (select count(*) from business_setup_intake_submissions where link_id = l.id and created_at > now() - interval '24 hours') >= 30 then raise exception 'This link has taken too many forms today. Please try again tomorrow.'; end if;
  if p_ip_hash is not null and (select count(*) from business_setup_intake_submissions where ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 5 then raise exception 'Too many forms were sent from here. Please try again later.'; end if;
  select * into t from client_portal_terms where status = 'Published';
  if t.id is not null and p_terms is distinct from t.id then raise exception 'Please read and agree to the current Terms and Conditions.'; end if;
  insert into business_setup_cases (stage, source, lead_name, contact_person, phone, email, intake_link_id, referred_by)
  values ('Review', 'Open link', left(v_name, 200), left(nullif(btrim(coalesce(p_answers ->> 'contact_person', '')), ''), 200), left(v_phone, 60), left(v_email, 200), l.id, l.created_by) returning id into v_case;
  insert into business_setup_intake_submissions (id, link_id, case_id, form_version, answers, terms_id, terms_version, ip_hash) values (p_submission, l.id, v_case, v_version, p_answers, t.id, t.version, p_ip_hash);
  perform business_setup_audit('business_setup_cases', v_case::text, 'case_referred', null, jsonb_build_object('referred_by', l.created_by, 'referrer', business_setup_person_name(l.created_by), 'link_generated', l.created_at));
  return v_case;
end $$;

-- Listed files older than 7 days with no submission: gone from the list, and the paths handed back for the Edge Function to delete.
create or replace function public.business_setup_intake_cleanup() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_paths jsonb;
begin
  with gone as (
    delete from business_setup_intake_files f where f.created_at < now() - interval '7 days'
       and not exists (select 1 from business_setup_intake_submissions s where s.id = f.submission_id) returning f.storage_path)
  select coalesce(jsonb_agg(storage_path), '[]'::jsonb) into v_paths from gone;
  return v_paths;
end $$;
revoke all on function public.business_setup_intake_open(text), public.business_setup_intake_upload_ok(text, uuid, text, text, bigint),
  public.business_setup_intake_submit(text, uuid, jsonb, text, uuid), public.business_setup_intake_cleanup() from public, anon, authenticated;
grant execute on function public.business_setup_intake_open(text), public.business_setup_intake_upload_ok(text, uuid, text, text, bigint),
  public.business_setup_intake_submit(text, uuid, jsonb, text, uuid), public.business_setup_intake_cleanup() to service_role;

-- ── Moving the case: the form and its documents are made here. Internal ──
-- A client who already has an open form keeps it, and the new files join it.
create or replace function public.business_setup_intake_apply(p_case uuid, p_client text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s business_setup_intake_submissions; v_form uuid;
begin
  select * into s from business_setup_intake_submissions where case_id = p_case and applied_at is null for update;
  if s.id is null then return; end if;
  select id into v_form from business_setup_onboarding_forms where client_id = p_client and status in ('Draft', 'Submitted', 'In review', 'Returned') order by created_at desc limit 1;
  if v_form is null then
    insert into business_setup_onboarding_forms (client_id, account_id, form_version, answers, status, submitted_at, case_id)
    values (p_client, business_setup_portal_account(p_client), s.form_version, s.answers, 'Submitted', s.created_at, p_case) returning id into v_form;
  else
    update business_setup_onboarding_forms set case_id = p_case where id = v_form and case_id is null;
  end if;
  insert into client_portal_documents (account_id, form_id, doc_type, note, file_name, size_bytes, storage_path, upload_complete, status)
  select business_setup_portal_account(p_client), v_form, f.kind, 'Sent through the open link', f.file_name, f.size_bytes, f.storage_path, true, 'pending'
    from business_setup_intake_files f
   where f.submission_id = s.id and exists (select 1 from storage.objects o where o.bucket_id = 'client-portal' and o.name = f.storage_path)
  on conflict (storage_path) do nothing;
  update business_setup_intake_submissions set applied_at = now() where id = s.id;
end $$;
revoke all on function public.business_setup_intake_apply(uuid, text) from public, anon, authenticated;

-- As in 016, plus the cases waiting at Client Inputs from an open link.
create or replace function public.business_setup_case_list(p_view text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_stages text[];
begin
  perform business_setup_require('setup.access');
  v_stages := case p_view
    when 'assigned' then array['Lead', 'Review']
    when 'leads' then array['Lead', 'Review']
    when 'inputs' then array['Lead', 'Review']
    when 'onboarding' then array['Onboarding']
    when 'pipeline' then array['Pipeline']
    when 'completion' then array['Completion', 'With Accounts']
    when 'closed' then array['Lost']
    when 'documentation' then array['Onboarding']
    when 'cases' then array['Pipeline', 'Completion', 'With Accounts', 'Completed', 'Cancelled']
    when 'all' then array['Lead', 'Review', 'Onboarding', 'Pipeline', 'Completion', 'With Accounts', 'Completed', 'Cancelled', 'Lost'] end;
  if v_stages is null then raise exception 'Unknown view %: use assigned, leads, inputs, onboarding, pipeline, completion or closed', p_view; end if;
  return (select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object(
      'client_name', m.legal_name,
      'owner_name', case when c.owner_id is not null then business_setup_person_name(c.owner_id) end,
      'referred_by_name', case when (to_jsonb(c) ->> 'referred_by') is not null then business_setup_person_name((to_jsonb(c) ->> 'referred_by')::uuid) end,
      'docs', business_setup_case_docs(c.id),
      'intake_pending', exists (select 1 from business_setup_intake_submissions s where s.case_id = c.id and s.applied_at is null),
      'form_id', (select f.id from business_setup_onboarding_forms f where f.case_id = c.id order by f.created_at desc limit 1),
      'form_status', (select f.status from business_setup_onboarding_forms f where f.case_id = c.id order by f.created_at desc limit 1),
      'reassign', (select jsonb_build_object('id', r.id, 'to_user', r.to_user, 'to_name', business_setup_person_name(r.to_user), 'reason', r.reason, 'created_by', r.created_by, 'created_at', r.created_at)
                     from business_setup_reassign_requests r where r.case_id = c.id and r.status = 'Pending')
    ) order by c.created_at desc, c.id), '[]'::jsonb)
    from business_setup_cases c left join client_master m on m.client_id = c.client_id
   where c.stage = any (v_stages)
     and (p_view <> 'assigned' or c.owner_id = auth.uid())
     and (p_view <> 'inputs' or exists (select 1 from business_setup_onboarding_forms f where f.case_id = c.id and f.status in ('Submitted', 'In review'))
          or exists (select 1 from business_setup_intake_submissions s where s.case_id = c.id and s.applied_at is null)));
end $$;

-- As in 016, and it brings across what came through the open link.
create or replace function public.business_setup_case_move_to_onboarding(p_case uuid, p_client text default null, p_allow_duplicate boolean default false) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare c business_setup_cases; v_client text;
begin
  perform business_setup_require('setup.leads.manage');
  select * into c from business_setup_cases where id = p_case for update;
  if c.id is null then raise exception 'Case not found'; end if;
  if c.stage in ('Completed', 'Cancelled', 'Lost') then raise exception 'This case is closed'; end if;
  if c.stage not in ('Lead', 'Review') then raise exception 'Only a lead or a case in review can move to Client Onboarding'; end if;
  if c.owner_id is null then raise exception 'Assign the lead before moving it.'; end if;
  if c.owner_id <> auth.uid() and not business_setup_can('setup.cases.approve') then
    raise exception 'Only the owner (%) or a manager can move this case to Client Onboarding', business_setup_person_name(c.owner_id);
  end if;
  v_client := business_setup_case_link_client_body(p_case, p_client, p_allow_duplicate);
  perform business_setup_intake_apply(p_case, v_client);
  perform business_setup_case_set_stage(p_case, 'Onboarding', 'Moved to Client Onboarding by ' || business_setup_person_name(auth.uid()));
  perform business_setup_case_sync(p_case);
  return v_client;
end $$;

-- As in 016, and a document whose client has no login yet can still be opened.
create or replace function public.client_inputs_file(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r jsonb;
begin
  if not (client_inputs_can() or business_setup_form_doc_can(p_id) or business_setup_claim_proof_can(p_id)) then raise exception 'You do not have access to Client Inputs.'; end if;
  select jsonb_build_object('id', d.id, 'storage_path', d.storage_path, 'file_name', d.file_name, 'doc_type', d.doc_type,
         'status', d.status, 'client', coalesce(a.display_name, (select m.legal_name from business_setup_onboarding_forms f join client_master m on m.client_id = f.client_id where f.id = d.form_id)), 'filed_path', d.filed_path, 'actor', auth.uid(),
         'can_review', d.assigned_to = auth.uid() or client_portal_is_admin())
    into r from client_portal_documents d left join client_portal_accounts a on a.id = d.account_id
   where d.id = p_id and d.upload_complete;
  if r is null then raise exception 'Document not found.'; end if;
  return r;
end $$;
