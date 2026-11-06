-- UAE Regulatory Updates Centre (spec section 12). Works with no AI.
-- An announcement never becomes a client obligation by itself: tasks exist only after a manager verifies the update and its list.
create sequence if not exists public.regulatory_number_seq;

create table if not exists public.regulatory_updates (
  id uuid primary key default gen_random_uuid(),
  update_number text not null unique default ('REG-' || lpad(nextval('public.regulatory_number_seq')::text, 6, '0')),
  title text not null,
  category text not null check (category in ('Company Formation', 'Free Zones', 'Immigration', 'Labour', 'Corporate Compliance', 'Tax', 'Banking', 'Municipality', 'Customs', 'Economic Regulations')),
  issuing_authority text,
  document_number text,
  publication_date date,
  issue_date date,
  effective_date date,
  official_url text,
  summary text,
  legal_status text not null default 'UNVERIFIED' check (legal_status in ('ENACTED', 'IN FORCE', 'PUBLISHED', 'ANNOUNCED', 'PROPOSED', 'UNDER CONSULTATION', 'SCHEDULED', 'SUPERSEDED', 'REPEALED', 'UNVERIFIED', 'UNCERTAIN')),
  evidence_level text not null default 'E4' check (evidence_level in ('E1', 'E2', 'E3', 'E4')),
  applicability jsonb not null default '{}'::jsonb,
  workflow_status text not null default 'Draft' check (workflow_status in ('Draft', 'Under review', 'List proposed', 'Verified', 'Tasks created', 'Closed')),
  source text not null default 'Manual' check (source in ('Manual', 'Tax Agent')),
  verified_by uuid references public.profiles (id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.regulatory_update_clients (
  update_id uuid not null references public.regulatory_updates (id) on delete cascade,
  client_id text not null references public.client_master (client_id),
  match_reason text,
  decision text not null check (decision in ('Applies', 'Does not apply', 'Check')),
  decided_by uuid references public.profiles (id) on delete set null,
  alert_id uuid,
  primary key (update_id, client_id)
);

alter table public.alerts add column if not exists regulatory_update_id uuid references public.regulatory_updates (id) on delete set null;

alter table public.regulatory_updates enable row level security;
alter table public.regulatory_update_clients enable row level security;
revoke all on public.regulatory_updates, public.regulatory_update_clients from anon, authenticated;
revoke all on sequence public.regulatory_number_seq from public, anon, authenticated;

-- Raised by these functions only, so the scan must never run them: it calls enabled rules, and these stay off.
insert into public.alert_rules (code, category, department, title_template, action_template, steps, enabled)
values
  ('regulatory_new', 'Regulatory', null, 'New regulatory update: {subject}', 'Review the update, confirm its effective date and who it applies to.', '[]', false),
  ('regulatory_impact', 'Regulatory', 'Business Setup', 'Regulatory change: {subject}', 'Check what this client must do, and act before the effective date.', '[]', false)
on conflict (code) do nothing;

create or replace function public.regulatory_can_manage() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and (alert_is_admin() or alert_is_manager())
$$;

create or replace function public.regulatory_require_manage() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not regulatory_can_manage() then raise exception 'You do not have permission to change regulatory updates.'; end if;
end $$;

-- Writes the record and tells the managers. Shared by the screen and the later Tax Agent intake.
create or replace function public.regulatory_insert(p jsonb, p_source text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_title text := nullif(btrim(p->>'title'), '');
begin
  if v_title is null then raise exception 'A title is required.'; end if;
  insert into regulatory_updates (title, category, issuing_authority, document_number, publication_date, issue_date, effective_date, official_url, summary,
                                  legal_status, evidence_level, source, created_by)
  values (v_title, p->>'category', nullif(btrim(p->>'issuing_authority'), ''), nullif(btrim(p->>'document_number'), ''),
          nullif(p->>'publication_date', '')::date, nullif(p->>'issue_date', '')::date, nullif(p->>'effective_date', '')::date,
          nullif(btrim(p->>'official_url'), ''), nullif(btrim(p->>'summary'), ''),
          coalesce(nullif(p->>'legal_status', ''), 'UNVERIFIED'), coalesce(nullif(p->>'evidence_level', ''), 'E4'), p_source, auth.uid())
  returning id into v_id;
  perform alert_raise('regulatory_new', 'regulatory:new:' || v_id, null, v_title, null, nullif(p->>'effective_date', '')::date, 0, 'Medium', null, 'regulatory_updates', v_id::text);
  update alerts set regulatory_update_id = v_id where dedupe_key = 'regulatory:new:' || v_id;
  return v_id;
end $$;

create or replace function public.regulatory_update_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_status text;
begin
  perform regulatory_require_manage();
  if v_id is null then return regulatory_insert(p, 'Manual'); end if;
  select workflow_status into v_status from regulatory_updates where id = v_id for update;
  if not found then raise exception 'That update does not exist.'; end if;
  if v_status in ('Verified', 'Tasks created', 'Closed') then raise exception 'A verified update cannot be changed.'; end if;
  update regulatory_updates set
    title = coalesce(nullif(btrim(p->>'title'), ''), title), category = coalesce(p->>'category', category),
    issuing_authority = case when p ? 'issuing_authority' then nullif(btrim(p->>'issuing_authority'), '') else issuing_authority end,
    document_number = case when p ? 'document_number' then nullif(btrim(p->>'document_number'), '') else document_number end,
    publication_date = case when p ? 'publication_date' then nullif(p->>'publication_date', '')::date else publication_date end,
    issue_date = case when p ? 'issue_date' then nullif(p->>'issue_date', '')::date else issue_date end,
    effective_date = case when p ? 'effective_date' then nullif(p->>'effective_date', '')::date else effective_date end,
    official_url = case when p ? 'official_url' then nullif(btrim(p->>'official_url'), '') else official_url end,
    summary = case when p ? 'summary' then nullif(btrim(p->>'summary'), '') else summary end,
    legal_status = coalesce(nullif(p->>'legal_status', ''), legal_status), evidence_level = coalesce(nullif(p->>'evidence_level', ''), evidence_level),
    applicability = case when p ? 'applicability' then p->'applicability' else applicability end,
    updated_at = now()
  where id = v_id;
  return v_id;
end $$;

-- For the Tax Agent later. Always a Draft: it cannot set a workflow state, verify or create tasks.
create or replace function public.regulatory_update_intake(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return regulatory_insert(p - 'workflow_status' - 'verified_by' - 'verified_at' - 'applicability', 'Tax Agent');
end $$;

create or replace function public.regulatory_start_review(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform regulatory_require_manage();
  update regulatory_updates set workflow_status = 'Under review', updated_at = now() where id = p_id and workflow_status = 'Draft';
  if not found then raise exception 'Only a Draft can go to review.'; end if;
end $$;

-- applicability: {"all_clients": true} or any of {"jurisdictions": [...], "statuses": [...], "has_visa": true|false}.
-- Closed clients are left out. A client whose profile cannot answer a filter is Check, never Does not apply.
create or replace function public.regulatory_propose_list(p_id uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_u regulatory_updates%rowtype; v_a jsonb; v_all boolean; v_j jsonb; v_s jsonb; v_v jsonb; v_n int;
begin
  perform regulatory_require_manage();
  select * into v_u from regulatory_updates where id = p_id for update;
  if not found then raise exception 'That update does not exist.'; end if;
  if v_u.workflow_status not in ('Under review', 'List proposed') then raise exception 'Start the review first.'; end if;
  if v_u.effective_date is null then raise exception 'Confirm the effective date first.'; end if;
  v_a := v_u.applicability; v_all := coalesce((v_a->>'all_clients')::boolean, false);
  v_j := nullif(v_a->'jurisdictions', '[]'::jsonb); v_s := nullif(v_a->'statuses', '[]'::jsonb); v_v := v_a->'has_visa';
  if not v_all and v_j is null and v_s is null and v_v is null then raise exception 'Set who this applies to first.'; end if;

  delete from regulatory_update_clients where update_id = p_id;
  insert into regulatory_update_clients (update_id, client_id, match_reason, decision)
  select p_id, c.client_id,
         case when c.incomplete then 'Profile incomplete: check by hand' when v_all then 'All clients' else 'Matches the applicability set' end,
         case when c.incomplete then 'Check' else 'Applies' end
  from (
    select m.client_id, k.client_status,
           (k.client_id is null or (v_j is not null and nullif(btrim(k.jurisdiction), '') is null)) as incomplete,
           (v_j is null or k.client_id is null or nullif(btrim(k.jurisdiction), '') is null or v_j ? k.jurisdiction) as j_ok,
           (v_s is null or k.client_id is null or v_s ? coalesce(k.client_status, '')) as s_ok,
           (v_v is null or v_v = 'null'::jsonb or k.client_id is null
              or (v_v::text::boolean = exists (select 1 from business_setup_visas x where x.client_id = m.client_id))) as v_ok
    from client_master m left join business_setup_kyc_profiles k on k.client_id = m.client_id
    where coalesce(k.client_status, '') !~* 'liquidated|cancel|rejected'
  ) c
  where c.j_ok and c.s_ok and c.v_ok;
  get diagnostics v_n = row_count;
  update regulatory_updates set workflow_status = 'List proposed', updated_at = now() where id = p_id;
  return v_n;
end $$;

create or replace function public.regulatory_decide_client(p_id uuid, p_client text, p_decision text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform regulatory_require_manage();
  if p_decision is null or p_decision not in ('Applies', 'Does not apply', 'Check') then raise exception 'Decision must be Applies, Does not apply or Check.'; end if;
  if not exists (select 1 from regulatory_updates where id = p_id and workflow_status = 'List proposed') then raise exception 'The list can only change before verification.'; end if;
  update regulatory_update_clients set decision = p_decision, decided_by = auth.uid() where update_id = p_id and client_id = p_client;
  if not found then raise exception 'That client is not on this list.'; end if;
end $$;

-- The gate. Proposals, consultations, unverified claims and third-party sources stay information only.
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
  if v_u.evidence_level = 'E4' then raise exception 'A third-party source stays information only. Find the official document first.'; end if;
  if v_u.legal_status in ('PROPOSED', 'UNDER CONSULTATION', 'UNVERIFIED') then raise exception 'This status is not yet law, so it stays information only.'; end if;
  if exists (select 1 from regulatory_update_clients where update_id = p_id and decision = 'Check') then raise exception 'Decide every client marked Check first.'; end if;
  update regulatory_updates set workflow_status = 'Verified', verified_by = auth.uid(), verified_at = now(), updated_at = now() where id = p_id;
end $$;

-- One alert per client marked Applies. Refuses anything not verified, whatever is asked.
create or replace function public.regulatory_create_tasks(p_id uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_u regulatory_updates%rowtype; r record; v_alert uuid; v_n int := 0;
begin
  perform regulatory_require_manage();
  select * into v_u from regulatory_updates where id = p_id for update;
  if not found then raise exception 'That update does not exist.'; end if;
  if v_u.workflow_status <> 'Verified' or v_u.verified_at is null then raise exception 'Only a verified update can create tasks.'; end if;
  if v_u.effective_date is null then raise exception 'Confirm the effective date first.'; end if;
  if v_u.applicability = '{}'::jsonb then raise exception 'Set who this applies to first.'; end if;
  for r in
    select c.client_id, m.legal_name from regulatory_update_clients c join client_master m on m.client_id = c.client_id
    where c.update_id = p_id and c.decision = 'Applies' order by c.client_id
  loop
    v_alert := alert_raise('regulatory_impact', 'regulatory:' || p_id || ':' || r.client_id, r.client_id, v_u.title || ' - ' || r.legal_name, 'Business Setup',
                           v_u.effective_date, 0, 'High', alert_owner(r.client_id, 'Business Setup'), 'regulatory_updates', p_id::text);
    update alerts set regulatory_update_id = p_id where id = v_alert;
    update regulatory_update_clients set alert_id = v_alert where update_id = p_id and client_id = r.client_id;
    v_n := v_n + 1;
  end loop;
  update regulatory_updates set workflow_status = case when v_n = 0 then 'Closed' else 'Tasks created' end, updated_at = now() where id = p_id;
  return v_n;
end $$;

-- Closes the update when its last client task is resolved. A failure here must never block resolving an alert.
create or replace function public.regulatory_track_completion() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    if new.regulatory_update_id is not null and new.rule_code = 'regulatory_impact' and new.status in ('Resolved', 'Dismissed')
       and not exists (select 1 from alerts a where a.regulatory_update_id = new.regulatory_update_id and a.rule_code = 'regulatory_impact' and a.status in ('Open', 'In progress')) then
      update regulatory_updates set workflow_status = 'Closed', updated_at = now() where id = new.regulatory_update_id and workflow_status = 'Tasks created';
    end if;
  exception when others then
    raise warning 'regulatory_track_completion: %', sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists regulatory_track_completion on public.alerts;
create trigger regulatory_track_completion after update of status on public.alerts
  for each row when (old.status is distinct from new.status) execute function public.regulatory_track_completion();

-- Managers see everything. Others see only what has been verified.
create or replace function public.regulatory_list(p_status text default null, p_limit int default 50, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_mgr boolean := regulatory_can_manage(); v_rows jsonb; v_total bigint;
begin
  if auth.uid() is null then raise exception 'Sign in to see regulatory updates.'; end if;
  with s as (
    select u.* from regulatory_updates u
    where (v_mgr or u.workflow_status in ('Verified', 'Tasks created', 'Closed'))
      and (p_status is null or (p_status = 'Needs review' and u.workflow_status in ('Draft', 'Under review', 'List proposed')) or u.workflow_status = p_status)
  ), pg as (
    select s.id, s.update_number, s.title, s.category, s.issuing_authority, s.effective_date, s.legal_status, s.evidence_level, s.workflow_status, s.source, s.created_at
    from s order by s.created_at desc, s.id limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
  )
  select coalesce((select jsonb_agg(to_jsonb(pg) order by pg.created_at desc, pg.id) from pg), '[]'::jsonb), (select count(*) from s) into v_rows, v_total;
  return jsonb_build_object('rows', v_rows, 'total', v_total, 'can_manage', v_mgr);
end $$;

create or replace function public.regulatory_detail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_mgr boolean := regulatory_can_manage(); v_u regulatory_updates%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in to see regulatory updates.'; end if;
  select * into v_u from regulatory_updates where id = p_id;
  if not found or not (v_mgr or v_u.workflow_status in ('Verified', 'Tasks created', 'Closed')) then raise exception 'That update is not available.'; end if;
  return jsonb_build_object('update', to_jsonb(v_u), 'can_manage', v_mgr,
    'clients', case when v_mgr then coalesce((select jsonb_agg(jsonb_build_object('client_id', c.client_id, 'client_name', m.legal_name, 'match_reason', c.match_reason, 'decision', c.decision,
                     'task_status', a.status) order by c.decision, c.client_id)
                   from regulatory_update_clients c join client_master m on m.client_id = c.client_id left join alerts a on a.id = c.alert_id where c.update_id = p_id), '[]'::jsonb)
                    else '[]'::jsonb end,
    'tasks_total', (select count(*) from alerts a where a.regulatory_update_id = p_id and a.rule_code = 'regulatory_impact'),
    'tasks_open', (select count(*) from alerts a where a.regulatory_update_id = p_id and a.rule_code = 'regulatory_impact' and a.status in ('Open', 'In progress')));
end $$;

revoke all on function public.regulatory_can_manage(), public.regulatory_require_manage(), public.regulatory_insert(jsonb, text), public.regulatory_update_save(jsonb),
  public.regulatory_update_intake(jsonb), public.regulatory_start_review(uuid), public.regulatory_propose_list(uuid), public.regulatory_decide_client(uuid, text, text),
  public.regulatory_verify(uuid), public.regulatory_create_tasks(uuid), public.regulatory_list(text, int, int), public.regulatory_detail(uuid),
  public.regulatory_track_completion() from public, anon, authenticated;
grant execute on function public.regulatory_update_save(jsonb), public.regulatory_start_review(uuid), public.regulatory_propose_list(uuid), public.regulatory_decide_client(uuid, text, text),
  public.regulatory_verify(uuid), public.regulatory_create_tasks(uuid), public.regulatory_list(text, int, int), public.regulatory_detail(uuid) to authenticated;
grant execute on function public.regulatory_update_intake(jsonb) to service_role;
