-- ROLLBACK of Business Setup Base migration 019 (open referral link). Then remove the setup-intake function and revert the site.
--
-- WARNING: this DELETES every link, every submission not yet moved, the referral tag on every case, and forms and documents from a link whose client has no login.
-- Stored files stay in the bucket with nothing pointing at them.

begin;

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
      'form_id', (select f.id from business_setup_onboarding_forms f where f.case_id = c.id order by f.created_at desc limit 1),
      'form_status', (select f.status from business_setup_onboarding_forms f where f.case_id = c.id order by f.created_at desc limit 1),
      'reassign', (select jsonb_build_object('id', r.id, 'to_user', r.to_user, 'to_name', business_setup_person_name(r.to_user), 'reason', r.reason, 'created_by', r.created_by, 'created_at', r.created_at)
                     from business_setup_reassign_requests r where r.case_id = c.id and r.status = 'Pending')
    ) order by c.created_at desc, c.id), '[]'::jsonb)
    from business_setup_cases c left join client_master m on m.client_id = c.client_id
   where c.stage = any (v_stages)
     and (p_view <> 'assigned' or c.owner_id = auth.uid())
     and (p_view <> 'inputs' or exists (select 1 from business_setup_onboarding_forms f where f.case_id = c.id and f.status in ('Submitted', 'In review'))));
end $$;

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
  perform business_setup_case_set_stage(p_case, 'Onboarding', 'Moved to Client Onboarding by ' || business_setup_person_name(auth.uid()));
  perform business_setup_case_sync(p_case);
  return v_client;
end $$;

create or replace function public.client_inputs_file(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r jsonb;
begin
  if not (client_inputs_can() or business_setup_form_doc_can(p_id) or business_setup_claim_proof_can(p_id)) then raise exception 'You do not have access to Client Inputs.'; end if;
  select jsonb_build_object('id', d.id, 'storage_path', d.storage_path, 'file_name', d.file_name, 'doc_type', d.doc_type,
         'status', d.status, 'client', a.display_name, 'filed_path', d.filed_path, 'actor', auth.uid(),
         'can_review', d.assigned_to = auth.uid() or client_portal_is_admin())
    into r from client_portal_documents d join client_portal_accounts a on a.id = d.account_id
   where d.id = p_id and d.upload_complete;
  if r is null then raise exception 'Document not found.'; end if;
  return r;
end $$;

drop function if exists public.business_setup_intake_apply(uuid, text);
drop function if exists public.business_setup_intake_cleanup();
drop function if exists public.business_setup_intake_submit(text, uuid, jsonb, text, uuid);
drop function if exists public.business_setup_intake_upload_ok(text, uuid, text, text, bigint);
drop function if exists public.business_setup_intake_open(text);
drop function if exists public.business_setup_case_spam(uuid, text);
drop function if exists public.business_setup_referrers();
drop function if exists public.business_setup_case_set_referrer(uuid, uuid, text);
drop function if exists public.business_setup_intake_detail(uuid);
drop function if exists public.business_setup_intake_link_revoke(uuid);
drop function if exists public.business_setup_intake_link_list();
drop function if exists public.business_setup_intake_link_new();
drop trigger if exists business_setup_form_account_fill on public.client_portal_accounts;
drop function if exists public.business_setup_form_account_fill();
drop trigger if exists business_setup_form_no_login_guard on public.business_setup_onboarding_forms;
drop function if exists public.business_setup_form_no_login_guard();
delete from public.client_portal_documents where account_id is null;
update public.business_setup_onboarding_forms f set account_id = a.id from public.client_portal_accounts a where f.account_id is null and a.client_master_id = f.client_id;
delete from public.business_setup_onboarding_forms where account_id is null;
alter table public.client_portal_documents alter column account_id set not null;
alter table public.business_setup_onboarding_forms alter column account_id set not null;
drop table if exists public.business_setup_intake_files;
drop table if exists public.business_setup_intake_submissions;
alter table public.business_setup_cases drop column if exists referred_by;
alter table public.business_setup_cases drop column if exists intake_link_id;
drop table if exists public.business_setup_intake_links;

commit;
