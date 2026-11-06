# Builds migrations/022_checkpoints.sql and rollback/022_rollback.sql from docs/2026-11-05-business-setup-service-checklists.md
# and the latest definitions in 006, 017, 018 and 019. Run from the repository root: python "Database Module/Business Setup Base/scripts/build_checkpoints.py"
# Changes only those files and adds the 022 undo to rollback/013_019 and 015_018 once.
import json, re
base = "Database Module/Business Setup Base/"
M = base + "migrations/"
rd = lambda p: open(p, encoding='utf-8', newline='').read().replace('\r\n', '\n')
def fn(src, name):
    m = re.search(r"create or replace function public\." + name + r"\(.*?\n(end \$\$;|\$\$;)", src, re.S)
    assert m, name
    return m.group(0)

# ── The seed, from the checklists file ──
sets = []; cat = None; cur = None
for line in rd("Business Setup Module/docs/2026-11-05-business-setup-service-checklists.md").split('\n'):
    m = re.match(r"## [A-J]\. (.+)", line)
    if m: cat = m.group(1); continue
    m = re.match(r"### \d+\. (.+)", line)
    if m: cur = {"c": cat, "n": m.group(1).strip(), "s": []}; sets.append(cur); continue
    if line.startswith("- ") and cur:
        label = line[2:].strip()
        cur["s"].append({"l": label, "r": "Optional" if re.search(r"\((if|where) ", label) else "Mandatory"})
assert len(sets) == 45 and sum(len(s["s"]) for s in sets) == 512 and sum(1 for s in sets for x in s["s"] if x["r"] == "Optional") == 40
seed = json.dumps(sets, ensure_ascii=False, separators=(",", ":"))
assert "$seed$" not in seed

accept0 = fn(rd(M + "017_kyc_finished.sql"), "business_setup_quote_accept_body")
a = "    values (v_svc, null, 'Not started', 'Created from quote ' || q.document_number);\n"
assert a in accept0
accept = accept0.replace(a, a + "    -- The list is copied now, so later edits to it leave this service unchanged. The case owner starts as the assigned employee.\n    perform business_setup_checkpoints_copy(v_svc, v_fee);\n    update business_setup_services set owner_id = coalesce(owner_id, (select c.owner_id from business_setup_cases c where c.id = q.case_id)) where id = v_svc;\n")

complete0 = fn(rd(M + "006_quotes_tracker.sql"), "business_setup_service_complete")
a = "  if s.status = 'Cancelled' then raise exception 'A cancelled service cannot be completed'; end if;\n"
assert a in complete0
complete = complete0.replace(a, a + """  -- A service with a checklist: every Mandatory item signed off or Not Applicable. What is left open and Optional is closed as not needed.
  select string_agg(x.label, ', ' order by x.sort_order) into v_open from business_setup_service_checkpoints x
   where x.service_id = s.id and x.requirement = 'Mandatory' and x.status <> 'Not Applicable' and x.verified_at is null;
  if v_open is not null then raise exception 'These items still need to be done and signed off: %', v_open; end if;
""")
a = "lic jsonb; v_expiry date; v_issue date; v_start_override boolean; v_no_output boolean;"
assert a in complete
complete = complete.replace(a, a + " v_open text;")
# Closing the Optional items comes at the very end, once every other check has passed.
i = complete.rindex("end $$;")
complete = complete[:i] + """  update business_setup_service_checkpoints set status = 'Not Applicable', reason = 'Not needed', updated_at = now()
   where service_id = s.id and requirement = 'Optional' and status <> 'Completed' and status <> 'Not Applicable';
""" + complete[i:]

s19 = rd(M + "019_intake.sql")
case_list0 = fn(s19, "business_setup_case_list")
a = "'docs', business_setup_case_docs(c.id),"
assert a in case_list0
case_list = case_list0.replace(a, a + """
      'services', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'status', s.status, 'progress', business_setup_service_progress(s.id), 'next_due', (select min(x.due_date) from business_setup_service_checkpoints x where x.service_id = s.id and x.status not in ('Completed', 'Not Applicable'))) order by s.created_at), '[]'::jsonb)
                     from business_setup_services s where s.quote_id in (select q.id from hub_documents q where q.case_id = c.id and q.doc_type = 'quote')),
      'quote_total', (select q.total_amount from hub_documents q where q.case_id = c.id and q.doc_type = 'quote' and q.status = 'accepted' limit 1),
      'net_paid', business_setup_case_net_paid(c.id),
      'invoices', (select count(*) from business_setup_invoices i where i.case_id = c.id),
      'claims_pending', (select count(*) from business_setup_payment_claims cl where cl.case_id = c.id and cl.status = 'Pending'),""")

view0 = fn(rd(M + "018_portal.sql"), "business_setup_portal_view")
a = "'services', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'action', s.action, 'status', s.status,"
assert a in view0
view = view0.replace(a, a + """ 'progress', business_setup_service_progress(s.id),
             'items', (select coalesce(jsonb_agg(jsonb_build_object('label', x.label, 'status', x.status) order by x.sort_order), '[]'::jsonb) from business_setup_service_checkpoints x where x.service_id = s.id),""")

sql = r"""-- =====================================================================
-- Business Setup Base - service checklists    022
-- =====================================================================
-- Spec 2026-11-05 service work. Lists are templates: accepting a quote copies a list onto each service, so later edits leave running services unchanged.
-- Staff work items in any order. A Mandatory item needs a manager's sign-off, and completing the service needs each one signed off or Not Applicable.
-- Progress is worked out, never typed: Completed over all items except Not Applicable. Every item change goes to business_setup_service_history.
-- The seed comes from docs/2026-11-05-business-setup-service-checklists.md through scripts/build_checkpoints.py. It adds rows, and changes no existing row.
-- Existing services get no checklist and keep their simple statuses. It redefines functions from 006, 017, 018 and 019: run this file again whenever those are re-run.
-- Run after 019. Re-runnable. Undo with rollback/022_rollback.sql.
-- =====================================================================

-- The seed holds non-ASCII text (an en dash). Read this file as UTF-8 whatever the client's code page, or a re-run seeds a second copy.
set client_encoding = 'UTF8';

create table if not exists public.business_setup_checkpoint_sets (
  id uuid primary key default gen_random_uuid(),
  department text not null default 'Business Setup',
  category text not null,
  name text not null,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (department, name)
);
create table if not exists public.business_setup_checkpoint_steps (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.business_setup_checkpoint_sets(id) on delete cascade,
  sort_order int not null,
  label text not null,
  stage text,
  requirement text not null default 'Mandatory' check (requirement in ('Mandatory', 'Optional'))
);
create index if not exists business_setup_checkpoint_steps_set_idx on public.business_setup_checkpoint_steps (set_id, sort_order);
alter table public.business_setup_fee_items add column if not exists checkpoint_set_id uuid references public.business_setup_checkpoint_sets(id);

create table if not exists public.business_setup_service_checkpoints (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.business_setup_services(id),
  sort_order int not null,
  label text not null,
  stage text,
  requirement text not null check (requirement in ('Mandatory', 'Optional')),
  status text not null default 'Not Started' check (status in ('Not Started', 'In Progress', 'Pending Client', 'Pending Authority', 'On Hold', 'Completed', 'Not Applicable', 'Reopened')),
  reason text,
  assigned_to uuid references public.profiles(id),
  due_date date,
  started_at timestamptz,
  completed_at timestamptz,
  completed_by uuid,
  verified_at timestamptz,
  verified_by uuid,
  updated_at timestamptz not null default now(),
  unique (service_id, sort_order)
);

-- The service's people and dates. owner_id (already on the table) is the assigned employee.
alter table public.business_setup_services add column if not exists reviewer_id uuid references public.profiles(id);
alter table public.business_setup_services add column if not exists priority text not null default 'Normal';
alter table public.business_setup_services drop constraint if exists business_setup_services_priority_check;
alter table public.business_setup_services add constraint business_setup_services_priority_check check (priority in ('Low', 'Normal', 'High', 'Urgent'));
alter table public.business_setup_services add column if not exists authority text;
alter table public.business_setup_services add column if not exists expected_completion date;
-- An attachment is an ordinary document of the client, linked to its item.
alter table public.business_setup_documents add column if not exists checkpoint_id uuid references public.business_setup_service_checkpoints(id);

alter table public.business_setup_checkpoint_sets enable row level security;
alter table public.business_setup_checkpoint_steps enable row level security;
alter table public.business_setup_service_checkpoints enable row level security;
revoke all on public.business_setup_checkpoint_sets, public.business_setup_checkpoint_steps, public.business_setup_service_checkpoints from public, anon, authenticated;

-- ── The seed ─────────────────────────────────────────────────────────
-- A list already there is left alone, so an edit survives a re-run.
do $do$
declare r jsonb; st jsonb; v_set uuid; n int;
begin
  for r in select value from jsonb_array_elements($seed$__SEED__$seed$::jsonb) loop
    if exists (select 1 from public.business_setup_checkpoint_sets where department = 'Business Setup' and name = r ->> 'n') then continue; end if;
    insert into public.business_setup_checkpoint_sets (category, name) values (r ->> 'c', r ->> 'n') returning id into v_set;
    n := 0;
    for st in select value from jsonb_array_elements(r -> 's') loop
      n := n + 1;
      insert into public.business_setup_checkpoint_steps (set_id, sort_order, label, requirement) values (v_set, n, st ->> 'l', st ->> 'r');
    end loop;
    insert into public.business_setup_fee_items (grp, name, default_amount, active, is_service, vat_rate, checkpoint_set_id)
    values (r ->> 'c', r ->> 'n', null, true, true, 5, v_set)
    on conflict (grp, name) do update set checkpoint_set_id = excluded.checkpoint_set_id where public.business_setup_fee_items.checkpoint_set_id is null;
  end loop;
end $do$;

-- ── Internal ─────────────────────────────────────────────────────────
create or replace function public.business_setup_checkpoints_copy(p_service uuid, p_fee uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into business_setup_service_checkpoints (service_id, sort_order, label, stage, requirement)
  select p_service, st.sort_order, st.label, st.stage, st.requirement
    from business_setup_fee_items f join business_setup_checkpoint_sets cs on cs.id = f.checkpoint_set_id and cs.active
    join business_setup_checkpoint_steps st on st.set_id = cs.id
   where f.id = p_fee
  on conflict (service_id, sort_order) do nothing
$$;

-- Null when the service has no checklist, or nothing on it applies but is cancelled: screens then show its status alone.
create or replace function public.business_setup_service_progress(p_service uuid) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select case when count(*) = 0 then null else coalesce(floor(100.0 * count(*) filter (where status = 'Completed') / nullif(count(*) filter (where status <> 'Not Applicable'), 0))::int, 0) end
    from business_setup_service_checkpoints where service_id = p_service
$$;

-- Who may work a service: its assigned employee, an item's assignee, the case owner, or a manager.
create or replace function public.business_setup_service_can_work(p_service uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select business_setup_can('setup.cases.approve')
      or exists (select 1 from business_setup_services s where s.id = p_service and s.owner_id = auth.uid())
      or exists (select 1 from business_setup_service_checkpoints x where x.service_id = p_service and x.assigned_to = auth.uid())
      or exists (select 1 from business_setup_services s join hub_documents q on q.id = s.quote_id join business_setup_cases c on c.id = q.case_id where s.id = p_service and c.owner_id = auth.uid())
$$;

-- The checks every item change shares. The service row is locked first, then the item.
create or replace function public.business_setup_checkpoint_open(p_id uuid) returns public.business_setup_service_checkpoints
language plpgsql security definer set search_path = public, pg_temp as $$
declare x business_setup_service_checkpoints; s business_setup_services;
begin
  select * into x from business_setup_service_checkpoints where id = p_id;
  if x.id is null then raise exception 'That item was not found'; end if;
  select * into s from business_setup_services where id = x.service_id for update;
  if not business_setup_service_can_work(s.id) then raise exception 'Only the people working on this service or a manager can change it'; end if;
  if s.status = 'Cancelled' then raise exception 'This service was cancelled, so its items cannot change'; end if;
  if s.status = 'Completed' then raise exception 'This service is confirmed. Ask a manager to reopen it first'; end if;
  if s.locked then raise exception 'This service is with Accounts, so its items cannot change'; end if;
  select * into x from business_setup_service_checkpoints where id = p_id for update;
  return x;
end $$;

revoke all on function public.business_setup_checkpoints_copy(uuid, uuid), public.business_setup_service_progress(uuid), public.business_setup_service_can_work(uuid), public.business_setup_checkpoint_open(uuid) from public, anon, authenticated;

-- ── Working an item ──────────────────────────────────────────────────
create or replace function public.business_setup_checkpoint_set(p_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare x business_setup_service_checkpoints; s business_setup_services; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  x := business_setup_checkpoint_open(p_id);
  if p_status is null or p_status not in ('Not Started', 'In Progress', 'Pending Client', 'Pending Authority', 'On Hold', 'Completed', 'Not Applicable', 'Reopened') then raise exception 'Choose a status'; end if;
  if p_status = x.status then return; end if;
  if p_status = 'Reopened' then
    if x.status <> 'Completed' then raise exception 'Only a completed item can be reopened'; end if;
    if v_note is null then raise exception 'Say why you are reopening this item'; end if;
  elsif x.verified_at is not null then raise exception 'This item has been signed off. Reopen it first';
  end if;
  if p_status = 'Not Applicable' and v_note is null then raise exception 'Give a reason why this item does not apply'; end if;
  update business_setup_service_checkpoints set
      status = p_status,
      reason = case when p_status in ('Not Applicable', 'Reopened') then v_note else reason end,
      started_at = case when p_status not in ('Not Started', 'Not Applicable') then coalesce(started_at, now()) else started_at end,
      completed_at = case when p_status = 'Completed' then now() end,
      completed_by = case when p_status = 'Completed' then auth.uid() end,
      verified_at = null, verified_by = null, updated_at = now()
   where id = p_id;
  insert into business_setup_service_history (service_id, from_status, to_status, note) values (x.service_id, x.status, p_status, x.label || coalesce(': ' || v_note, ''));
  -- The first work on an item starts the service.
  select * into s from business_setup_services where id = x.service_id;
  if s.status = 'Not started' and p_status not in ('Not Started', 'Not Applicable') then
    update business_setup_services set status = 'In progress', started_at = coalesce(started_at, now()) where id = s.id;
    insert into business_setup_service_history (service_id, from_status, to_status, note) values (s.id, 'Not started', 'In progress', 'First work on its checklist');
  end if;
end $$;

create or replace function public.business_setup_checkpoint_assign(p_id uuid, p_user uuid, p_due date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare x business_setup_service_checkpoints;
begin
  x := business_setup_checkpoint_open(p_id);
  if p_user is not null and not exists (select 1 from profiles where id = p_user) then raise exception 'That person was not found'; end if;
  update business_setup_service_checkpoints set assigned_to = p_user, due_date = p_due, updated_at = now() where id = p_id;
  insert into business_setup_service_history (service_id, from_status, to_status, note) values (x.service_id, x.status, x.status, x.label || ': assigned to ' || coalesce(business_setup_person_name(p_user), 'nobody') || coalesce(', due ' || p_due::text, ''));
end $$;

-- A manager signs off a completed Mandatory item.
create or replace function public.business_setup_checkpoint_verify(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare x business_setup_service_checkpoints;
begin
  perform business_setup_require('setup.cases.approve');
  x := business_setup_checkpoint_open(p_id);
  if x.requirement <> 'Mandatory' then raise exception 'Only a Mandatory item needs a sign-off'; end if;
  if x.status <> 'Completed' then raise exception 'This item is not completed, so it cannot be signed off'; end if;
  if x.verified_at is not null then return; end if;
  update business_setup_service_checkpoints set verified_at = now(), verified_by = auth.uid(), updated_at = now() where id = p_id;
  insert into business_setup_service_history (service_id, from_status, to_status, note) values (x.service_id, x.status, x.status, x.label || ': signed off');
end $$;

create or replace function public.business_setup_service_verify_all(p_service uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; n int := 0;
begin
  perform business_setup_require('setup.cases.approve');
  for r in select id from business_setup_service_checkpoints where service_id = p_service and requirement = 'Mandatory' and status = 'Completed' and verified_at is null order by sort_order loop
    perform business_setup_checkpoint_verify(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- A manager reopens a confirmed service with a note. The case returns to Pipeline.
create or replace function public.business_setup_service_reopen(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s business_setup_services; v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_case uuid; v_stage text;
begin
  perform business_setup_require('setup.cases.approve');
  if v_note is null then raise exception 'Say why you are reopening this service'; end if;
  select * into s from business_setup_services where id = p_id for update;
  if s.id is null then raise exception 'Service not found'; end if;
  if s.status <> 'Completed' then raise exception 'Only a confirmed service can be reopened'; end if;
  select q.case_id into v_case from hub_documents q where q.id = s.quote_id;
  select stage into v_stage from business_setup_cases where id = v_case for update;
  if v_stage = 'With Accounts' or s.locked then raise exception 'This service is with Accounts, so it cannot be reopened'; end if;
  if v_stage = 'Completed' then raise exception 'This case is closed, so its services cannot be reopened'; end if;
  update business_setup_services set status = 'In progress', completed_at = null where id = p_id;
  insert into business_setup_service_history (service_id, from_status, to_status, note) values (p_id, 'Completed', 'In progress', 'Reopened: ' || v_note);
  if v_stage = 'Completion' then perform business_setup_case_set_stage(v_case, 'Pipeline', 'Service reopened: ' || v_note); end if;
end $$;

create or replace function public.business_setup_service_details_save(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s business_setup_services; v_priority text := coalesce(nullif(p ->> 'priority', ''), 'Normal');
begin
  select * into s from business_setup_services where id = p_id for update;
  if s.id is null then raise exception 'Service not found'; end if;
  if not business_setup_service_can_work(p_id) then raise exception 'Only the people working on this service or a manager can change it'; end if;
  if v_priority not in ('Low', 'Normal', 'High', 'Urgent') then raise exception 'Choose a priority'; end if;
  update business_setup_services set owner_id = nullif(p ->> 'owner_id', '')::uuid, reviewer_id = nullif(p ->> 'reviewer_id', '')::uuid, priority = v_priority,
         authority = nullif(btrim(coalesce(p ->> 'authority', '')), ''), expected_completion = nullif(p ->> 'expected_completion', '')::date where id = p_id;
  perform business_setup_audit('business_setup_services', p_id::text, 'service_details_save', null, p);
end $$;

-- Links an uploaded document of the client to an item.
create or replace function public.business_setup_checkpoint_file_link(p_id uuid, p_document uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare x business_setup_service_checkpoints;
begin
  x := business_setup_checkpoint_open(p_id);
  update business_setup_documents d set checkpoint_id = p_id from business_setup_services s where s.id = x.service_id and d.id = p_document and d.client_id = s.client_id;
  if not found then raise exception 'That document was not found for this client'; end if;
  insert into business_setup_service_history (service_id, from_status, to_status, note) values (x.service_id, x.status, x.status, x.label || ': file attached');
end $$;

-- ── Reading ──────────────────────────────────────────────────────────
create or replace function public.business_setup_service_checklist(p_service uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s business_setup_services;
begin
  perform business_setup_require('setup.access');
  select * into s from business_setup_services where id = p_service;
  if s.id is null then raise exception 'Service not found'; end if;
  return jsonb_build_object('service', to_jsonb(s) || jsonb_build_object('owner_name', business_setup_person_name(s.owner_id), 'reviewer_name', business_setup_person_name(s.reviewer_id)),
    'progress', business_setup_service_progress(p_service),
    'can_work', business_setup_service_can_work(p_service),
    'can_verify', business_setup_can('setup.cases.approve'),
    'outputs', (select count(*) from business_setup_documents d where d.service_id = p_service and d.is_output),
    'pending_approval', (select count(*) from business_setup_service_checkpoints x where x.service_id = p_service and x.requirement = 'Mandatory' and x.status = 'Completed' and x.verified_at is null),
    'next_action', (select x.label from business_setup_service_checkpoints x where x.service_id = p_service and x.status not in ('Completed', 'Not Applicable') order by x.requirement = 'Optional', x.sort_order limit 1),
    'items', (select coalesce(jsonb_agg(to_jsonb(x) || jsonb_build_object('assignee_name', business_setup_person_name(x.assigned_to), 'verified_by_name', business_setup_person_name(x.verified_by),
                 'pending_approval', x.requirement = 'Mandatory' and x.status = 'Completed' and x.verified_at is null,
                 'overdue', x.due_date is not null and x.due_date < (now() at time zone 'Asia/Dubai')::date and x.status not in ('Completed', 'Not Applicable'),
                 'files', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'file_name', d.file_name, 'storage_path', d.storage_path)), '[]'::jsonb) from business_setup_documents d where d.checkpoint_id = x.id)) order by x.sort_order), '[]'::jsonb)
                from business_setup_service_checkpoints x where x.service_id = p_service));
end $$;

-- The lists, for Services & Fees.
create or replace function public.business_setup_checkpoint_lists() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform business_setup_require('setup.access');
  return (select coalesce(jsonb_agg(jsonb_build_object('id', cs.id, 'department', cs.department, 'category', cs.category, 'name', cs.name, 'active', cs.active,
      'steps', (select coalesce(jsonb_agg(jsonb_build_object('label', st.label, 'stage', st.stage, 'requirement', st.requirement) order by st.sort_order), '[]'::jsonb) from business_setup_checkpoint_steps st where st.set_id = cs.id)) order by cs.category, cs.name), '[]'::jsonb)
    from business_setup_checkpoint_sets cs);
end $$;

-- Saves a list and its steps. Running services keep their own copy.
create or replace function public.business_setup_checkpoint_list_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_name text := nullif(btrim(coalesce(p ->> 'name', '')), ''); v_cat text := nullif(btrim(coalesce(p ->> 'category', '')), ''); v_dep text := coalesce(nullif(btrim(coalesce(p ->> 'department', '')), ''), 'Business Setup');
        st jsonb; n int := 0;
begin
  perform business_setup_require('setup.fees.manage');
  if v_name is null or v_cat is null then raise exception 'Enter the service name and category'; end if;
  if jsonb_typeof(p -> 'steps') is distinct from 'array' or jsonb_array_length(p -> 'steps') = 0 then raise exception 'A list needs at least one step'; end if;
  for st in select value from jsonb_array_elements(p -> 'steps') loop
    if nullif(btrim(coalesce(st ->> 'label', '')), '') is null then raise exception 'Every step needs a label'; end if;
    if coalesce(st ->> 'requirement', 'Mandatory') not in ('Mandatory', 'Optional') then raise exception 'A step is Mandatory or Optional'; end if;
  end loop;
  if v_id is null then
    insert into business_setup_checkpoint_sets (department, category, name, active, updated_by) values (v_dep, v_cat, v_name, coalesce((p ->> 'active')::boolean, true), auth.uid()) returning id into v_id;
  else
    update business_setup_checkpoint_sets set department = v_dep, category = v_cat, name = v_name, active = coalesce((p ->> 'active')::boolean, active), updated_at = now(), updated_by = auth.uid() where id = v_id;
    if not found then raise exception 'That list was not found'; end if;
    delete from business_setup_checkpoint_steps where set_id = v_id;
  end if;
  for st in select value from jsonb_array_elements(p -> 'steps') loop
    n := n + 1;
    insert into business_setup_checkpoint_steps (set_id, sort_order, label, stage, requirement) values (v_id, n, btrim(st ->> 'label'), nullif(btrim(coalesce(st ->> 'stage', '')), ''), coalesce(st ->> 'requirement', 'Mandatory'));
  end loop;
  perform business_setup_audit('business_setup_checkpoint_sets', v_id::text, 'checkpoint_list_save', null, jsonb_build_object('name', v_name, 'steps', n));
  return v_id;
end $$;

revoke all on function public.business_setup_checkpoint_set(uuid, text, text), public.business_setup_checkpoint_assign(uuid, uuid, date), public.business_setup_checkpoint_verify(uuid), public.business_setup_service_verify_all(uuid),
  public.business_setup_service_reopen(uuid, text), public.business_setup_service_details_save(uuid, jsonb), public.business_setup_checkpoint_file_link(uuid, uuid), public.business_setup_service_checklist(uuid),
  public.business_setup_checkpoint_lists(), public.business_setup_checkpoint_list_save(jsonb) from public, anon;
grant execute on function public.business_setup_checkpoint_set(uuid, text, text), public.business_setup_checkpoint_assign(uuid, uuid, date), public.business_setup_checkpoint_verify(uuid), public.business_setup_service_verify_all(uuid),
  public.business_setup_service_reopen(uuid, text), public.business_setup_service_details_save(uuid, jsonb), public.business_setup_checkpoint_file_link(uuid, uuid), public.business_setup_service_checklist(uuid),
  public.business_setup_checkpoint_lists(), public.business_setup_checkpoint_list_save(jsonb) to authenticated;

-- ── As in 017, and the list is copied onto each new service ──
__ACCEPT__

-- ── As in 006, and a checklist must be finished first ──
__COMPLETE__

-- ── As in 019, plus each service's progress and the money, for Pipeline and Completion ──
__CASE_LIST__

-- ── As in 018, plus each service's items and progress. Labels and statuses only ──
__VIEW__
"""
sql = sql.replace("__SEED__", seed).replace("__ACCEPT__", accept).replace("__COMPLETE__", complete).replace("__CASE_LIST__", case_list).replace("__VIEW__", view)
open(M + "022_checkpoints.sql", 'w', encoding='utf-8', newline='\n').write(sql)

drops = """drop function if exists public.business_setup_checkpoint_list_save(jsonb);
drop function if exists public.business_setup_checkpoint_lists();
drop function if exists public.business_setup_service_checklist(uuid);
drop function if exists public.business_setup_checkpoint_file_link(uuid, uuid);
drop function if exists public.business_setup_service_details_save(uuid, jsonb);
drop function if exists public.business_setup_service_reopen(uuid, text);
drop function if exists public.business_setup_service_verify_all(uuid);
drop function if exists public.business_setup_checkpoint_verify(uuid);
drop function if exists public.business_setup_checkpoint_assign(uuid, uuid, date);
drop function if exists public.business_setup_checkpoint_set(uuid, text, text);
drop function if exists public.business_setup_checkpoint_open(uuid);
drop function if exists public.business_setup_service_can_work(uuid);
drop function if exists public.business_setup_service_progress(uuid);
drop function if exists public.business_setup_checkpoints_copy(uuid, uuid);
alter table public.business_setup_documents drop column if exists checkpoint_id;
alter table public.business_setup_services drop constraint if exists business_setup_services_priority_check;
alter table public.business_setup_services drop column if exists expected_completion;
alter table public.business_setup_services drop column if exists authority;
alter table public.business_setup_services drop column if exists priority;
alter table public.business_setup_services drop column if exists reviewer_id;
drop table if exists public.business_setup_service_checkpoints;
do $$ begin if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'business_setup_fee_items' and column_name = 'checkpoint_set_id') then execute 'update public.business_setup_fee_items set active = false where checkpoint_set_id is not null'; end if; end $$;
alter table public.business_setup_fee_items drop column if exists checkpoint_set_id;
drop table if exists public.business_setup_checkpoint_steps;
drop table if exists public.business_setup_checkpoint_sets;
"""
restored = accept0 + "\n\n" + complete0 + "\n\n" + case_list0 + "\n\n" + view0 + "\n\n"
open(base + "rollback/022_rollback.sql", 'w', encoding='utf-8', newline='\n').write(
"""-- ROLLBACK of Business Setup Base migration 022 (service checklists). Then revert the site and redeploy the earlier client-portal function if it changed.
--
-- WARNING: this DELETES every service's checklist items and their sign-offs, and the lists. History rows stay. The 45 fee items stay, marked inactive, because quotes may name them.

begin;

""" + restored + drops + "\ncommit;\n")

for f in ["rollback/013_019_rollback.sql", "rollback/015_018_rollback.sql"]:
    p = base + f
    s = open(p, encoding='utf-8', newline='').read()
    e = '\r\n' if '\r\n' in s else '\n'
    if "business_setup_checkpoint_list_save" in s: continue
    i = re.search(r"^begin;\s*$", s, re.M)
    assert i, f
    s = s[:i.end()] + e + "-- 022 (service checklists) goes first: see rollback/022_rollback.sql for what is lost." + e + (restored + drops).replace('\n', e) + s[i.end():]
    open(p, 'w', encoding='utf-8', newline='').write(s)
print("ok")
