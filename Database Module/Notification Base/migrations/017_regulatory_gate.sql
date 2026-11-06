-- Review fixes I2, I3, I4: the regulatory gate.
-- I2: verify takes only statuses that are law and official evidence, and a source must be https://. No domain check.
-- I3: a proposed list is dropped when the effective date or applicability it was built from changes.
-- I4: list matching ignores case and spaces, a blank status under a statuses filter is Check, and an empty list is refused.
-- regulatory_insert, _update_save and _propose_list are 010's, regulatory_verify is 014's, each with those changes.
-- Re-runnable. Rollback: rollback/015_018_rollback.sql.

create or replace function public.regulatory_insert(p jsonb, p_source text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_title text := nullif(btrim(p->>'title'), ''); v_url text := nullif(btrim(p->>'official_url'), '');
begin
  if v_title is null then raise exception 'A title is required.'; end if;
  if v_url is not null and v_url !~ '^https://' then raise exception 'The official source must be a web address starting with https://.'; end if;
  insert into regulatory_updates (title, category, issuing_authority, document_number, publication_date, issue_date, effective_date, official_url, summary,
                                  legal_status, evidence_level, source, created_by)
  values (v_title, p->>'category', nullif(btrim(p->>'issuing_authority'), ''), nullif(btrim(p->>'document_number'), ''),
          nullif(p->>'publication_date', '')::date, nullif(p->>'issue_date', '')::date, nullif(p->>'effective_date', '')::date,
          v_url, nullif(btrim(p->>'summary'), ''),
          coalesce(nullif(p->>'legal_status', ''), 'UNVERIFIED'), coalesce(nullif(p->>'evidence_level', ''), 'E4'), p_source, auth.uid())
  returning id into v_id;
  perform alert_raise('regulatory_new', 'regulatory:new:' || v_id, null, v_title, null, nullif(p->>'effective_date', '')::date, 0, 'Medium', null, 'regulatory_updates', v_id::text);
  update alerts set regulatory_update_id = v_id where dedupe_key = 'regulatory:new:' || v_id;
  return v_id;
end $$;

create or replace function public.regulatory_update_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_old regulatory_updates%rowtype; v_new regulatory_updates%rowtype; v_url text := nullif(btrim(p->>'official_url'), '');
begin
  perform regulatory_require_manage();
  if v_id is null then return regulatory_insert(p, 'Manual'); end if;
  select * into v_old from regulatory_updates where id = v_id for update;
  if not found then raise exception 'That update does not exist.'; end if;
  if v_old.workflow_status in ('Verified', 'Tasks created', 'Closed') then raise exception 'A verified update cannot be changed.'; end if;
  if v_url is not null and v_url !~ '^https://' then raise exception 'The official source must be a web address starting with https://.'; end if;
  update regulatory_updates set
    title = coalesce(nullif(btrim(p->>'title'), ''), title), category = coalesce(p->>'category', category),
    issuing_authority = case when p ? 'issuing_authority' then nullif(btrim(p->>'issuing_authority'), '') else issuing_authority end,
    document_number = case when p ? 'document_number' then nullif(btrim(p->>'document_number'), '') else document_number end,
    publication_date = case when p ? 'publication_date' then nullif(p->>'publication_date', '')::date else publication_date end,
    issue_date = case when p ? 'issue_date' then nullif(p->>'issue_date', '')::date else issue_date end,
    effective_date = case when p ? 'effective_date' then nullif(p->>'effective_date', '')::date else effective_date end,
    official_url = case when p ? 'official_url' then v_url else official_url end,
    summary = case when p ? 'summary' then nullif(btrim(p->>'summary'), '') else summary end,
    legal_status = coalesce(nullif(p->>'legal_status', ''), legal_status), evidence_level = coalesce(nullif(p->>'evidence_level', ''), evidence_level),
    applicability = case when p ? 'applicability' then p->'applicability' else applicability end,
    updated_at = now()
  where id = v_id
  returning * into v_new;
  -- A list built from the old date or applicability no longer holds.
  if v_old.workflow_status = 'List proposed'
     and (v_new.effective_date is distinct from v_old.effective_date or v_new.applicability is distinct from v_old.applicability) then
    delete from regulatory_update_clients where update_id = v_id;
    update regulatory_updates set workflow_status = 'Under review', updated_at = now() where id = v_id;
  end if;
  return v_id;
end $$;

-- applicability: {"all_clients": true} or any of {"jurisdictions": [...], "statuses": [...], "has_visa": true|false}.
-- Closed clients are left out. A client whose profile cannot answer a filter is Check, never Does not apply.
create or replace function public.regulatory_propose_list(p_id uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_u regulatory_updates%rowtype; v_a jsonb; v_all boolean; v_j text[]; v_s text[]; v_v jsonb; v_n int;
begin
  perform regulatory_require_manage();
  select * into v_u from regulatory_updates where id = p_id for update;
  if not found then raise exception 'That update does not exist.'; end if;
  if v_u.workflow_status not in ('Under review', 'List proposed') then raise exception 'Start the review first.'; end if;
  if v_u.effective_date is null then raise exception 'Confirm the effective date first.'; end if;
  v_a := v_u.applicability; v_all := coalesce((v_a->>'all_clients')::boolean, false);
  if jsonb_typeof(v_a->'jurisdictions') = 'array' then
    v_j := nullif(array(select lower(btrim(x)) from jsonb_array_elements_text(v_a->'jurisdictions') x where btrim(x) <> ''), '{}');
  end if;
  if jsonb_typeof(v_a->'statuses') = 'array' then
    v_s := nullif(array(select lower(btrim(x)) from jsonb_array_elements_text(v_a->'statuses') x where btrim(x) <> ''), '{}');
  end if;
  v_v := v_a->'has_visa';
  if not v_all and v_j is null and v_s is null and v_v is null then raise exception 'Set who this applies to first.'; end if;

  delete from regulatory_update_clients where update_id = p_id;
  insert into regulatory_update_clients (update_id, client_id, match_reason, decision)
  select p_id, c.client_id,
         case when c.incomplete then 'Profile incomplete: check by hand' when v_all then 'All clients' else 'Matches the applicability set' end,
         case when c.incomplete then 'Check' else 'Applies' end
  from (
    select m.client_id, k.client_status,
           (k.client_id is null or (v_j is not null and nullif(btrim(k.jurisdiction), '') is null)
                                or (v_s is not null and nullif(btrim(k.client_status), '') is null)) as incomplete,
           (v_j is null or k.client_id is null or nullif(btrim(k.jurisdiction), '') is null or lower(btrim(k.jurisdiction)) = any (v_j)) as j_ok,
           (v_s is null or k.client_id is null or nullif(btrim(k.client_status), '') is null or lower(btrim(k.client_status)) = any (v_s)) as s_ok,
           (v_v is null or v_v = 'null'::jsonb or k.client_id is null
              or (v_v::text::boolean = exists (select 1 from business_setup_visas x where x.client_id = m.client_id))) as v_ok
    from client_master m left join business_setup_kyc_profiles k on k.client_id = m.client_id
    where coalesce(k.client_status, '') !~* 'liquidated|cancel|rejected'
  ) c
  where c.j_ok and c.s_ok and c.v_ok;
  get diagnostics v_n = row_count;
  -- The exception undoes the delete above, so a refused run leaves the old list and status alone.
  if v_n = 0 then raise exception 'No client matches who this applies to. Change it and propose the list again.'; end if;
  update regulatory_updates set workflow_status = 'List proposed', updated_at = now() where id = p_id;
  return v_n;
end $$;

-- The gate. Only law in official evidence passes, and verifying closes the new-update alert as in 014.
create or replace function public.regulatory_verify(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_u regulatory_updates%rowtype;
begin
  perform regulatory_require_manage();
  select * into v_u from regulatory_updates where id = p_id for update;
  if not found then raise exception 'That update does not exist.'; end if;
  if v_u.workflow_status <> 'List proposed' then raise exception 'Propose the client list first.'; end if;
  if v_u.effective_date is null then raise exception 'Confirm the effective date first.'; end if;
  if nullif(btrim(v_u.official_url), '') is null then raise exception 'Add the official source first.'; end if;
  if v_u.official_url !~ '^https://' then raise exception 'The official source must be a web address starting with https://.'; end if;
  if v_u.evidence_level = 'E4' then raise exception 'A third-party source stays information only. Find the official document first.'; end if;
  if v_u.evidence_level not in ('E1', 'E2') then raise exception 'Only E1 or E2 evidence can be verified. Read the official document or page first.'; end if;
  if v_u.legal_status in ('PROPOSED', 'UNDER CONSULTATION', 'UNVERIFIED') then raise exception 'This status is not yet law, so it stays information only.'; end if;
  if v_u.legal_status not in ('ENACTED', 'IN FORCE', 'PUBLISHED', 'SCHEDULED') then raise exception 'Only ENACTED, IN FORCE, PUBLISHED or SCHEDULED can be verified, so this stays information only.'; end if;
  if exists (select 1 from regulatory_update_clients where update_id = p_id and decision = 'Check') then raise exception 'Decide every client marked Check first.'; end if;
  update regulatory_updates set workflow_status = 'Verified', verified_by = auth.uid(), verified_at = now(), updated_at = now() where id = p_id;

  with closed as (
    update alerts set status = 'Resolved', resolved_at = now(), resolved_by = auth.uid(), resolution_note = 'Update verified by a manager.', updated_at = now()
    where dedupe_key = 'regulatory:new:' || p_id and status in ('Open', 'In progress')
    returning id
  )
  insert into alert_events (alert_id, event, detail, created_by)
  select id, 'resolved', jsonb_build_object('note', 'Update verified by a manager.'), auth.uid() from closed;
end $$;
