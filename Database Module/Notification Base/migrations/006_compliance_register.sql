-- Notification Centre, Phase 2: compliance register and its expiry alerts.
-- Re-runnable. Rollback: rollback/006_009_rollback.sql (006 section).
-- Staff keep expiry dates here for items the CRM has no table for yet (establishment card, Ejari, Emirates ID, passport and so on).
-- A register `reference` (a passport or card number) is for the register screen only: no alert, bell, email or log may carry it.
-- No browser writes to the table: every write goes through a SECURITY DEFINER function that checks the caller.

-- ── Table ────────────────────────────────────────────────────────────
create table if not exists public.client_compliance_items (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.client_master (client_id),
  item_type text not null,
  person_name text,
  reference text,
  issue_date date,
  expiry_date date,
  next_review_date date,
  status text not null default 'Active' check (status in ('Active', 'Closed')),
  source text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
create index if not exists client_compliance_items_client_idx on public.client_compliance_items (client_id);
create index if not exists client_compliance_items_type_idx on public.client_compliance_items (item_type, status);
create index if not exists client_compliance_items_expiry_idx on public.client_compliance_items (expiry_date) where status = 'Active';

-- ── Who may use the register ─────────────────────────────────────────
-- A CRM admin, a tagged Manager, or a member holding the Clients tab. Read and write follow the same rule.
create or replace function public.client_compliance_can_read() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and (alert_is_admin() or alert_is_manager() or 'clients' = any (my_tabs()))
$$;

create or replace function public.client_compliance_can_write() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and (alert_is_admin() or alert_is_manager() or 'clients' = any (my_tabs()))
$$;

-- Internal. Later phases replace this list when they add types.
create or replace function public.client_compliance_item_types() returns text[]
language sql immutable security definer set search_path = public, pg_temp as $$
  select array['Establishment card', 'Immigration file', 'Ejari', 'Labour establishment', 'Office lease', 'Emirates ID', 'Passport',
               'Dependent visa', 'Work permit', 'UBO verification', 'AML risk assessment', 'KYC document', 'Corporate register review',
               'Regulatory filing', 'Compliance review', 'Tax residency certificate']
$$;

alter table public.client_compliance_items enable row level security;
revoke all on public.client_compliance_items from anon, authenticated;
drop policy if exists client_compliance_items_select on public.client_compliance_items;
create policy client_compliance_items_select on public.client_compliance_items for select to authenticated
  using (public.client_compliance_can_read());
grant select on public.client_compliance_items to authenticated;

-- ── Save ─────────────────────────────────────────────────────────────
-- Inserts, or updates when p.id is given. On update only the keys present in p change (a JSON null clears a field).
-- Closing goes through client_compliance_close so a reason is always kept.
create or replace function public.client_compliance_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_old public.client_compliance_items%rowtype;
  v_client text; v_type text; v_status text;
  v_issue date; v_exp date; v_rev date;
begin
  if not client_compliance_can_write() then raise exception 'You do not have permission to change the compliance register.'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'A register entry must be a JSON object.'; end if;

  begin
    v_id := nullif(btrim(p->>'id'), '')::uuid;
  exception when invalid_text_representation then
    raise exception 'The register id is not valid.';
  end;
  if v_id is not null then
    select * into v_old from client_compliance_items where id = v_id for update;
    if not found then raise exception 'That register entry does not exist.'; end if;
  end if;

  v_client := case when p ? 'client_id' then nullif(btrim(p->>'client_id'), '') else v_old.client_id end;
  v_type := case when p ? 'item_type' then nullif(btrim(p->>'item_type'), '') else v_old.item_type end;
  if v_client is null or not exists (select 1 from client_master where client_id = v_client) then raise exception 'Unknown client.'; end if;
  if v_type is null or not (v_type = any (client_compliance_item_types())) then raise exception 'Unknown item type.'; end if;

  begin
    v_issue := case when p ? 'issue_date' then nullif(btrim(p->>'issue_date'), '')::date else v_old.issue_date end;
    v_exp := case when p ? 'expiry_date' then nullif(btrim(p->>'expiry_date'), '')::date else v_old.expiry_date end;
    v_rev := case when p ? 'next_review_date' then nullif(btrim(p->>'next_review_date'), '')::date else v_old.next_review_date end;
  exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
    raise exception 'Dates must be real dates, written YYYY-MM-DD.';
  end;
  if v_issue is not null and v_exp is not null and v_exp < v_issue then raise exception 'The expiry date is before the issue date.'; end if;

  v_status := case when p ? 'status' then nullif(btrim(p->>'status'), '') else v_old.status end;
  v_status := coalesce(v_status, 'Active');
  if v_status not in ('Active', 'Closed') then raise exception 'Status must be Active or Closed.'; end if;
  if v_status = 'Closed' and v_old.status is distinct from 'Closed' then raise exception 'Use Close to close an entry: it needs a reason.'; end if;

  if v_id is null then
    insert into client_compliance_items (client_id, item_type, person_name, reference, issue_date, expiry_date, next_review_date, status, source, notes, created_by, updated_by)
    values (v_client, v_type, nullif(btrim(p->>'person_name'), ''), nullif(btrim(p->>'reference'), ''), v_issue, v_exp, v_rev, v_status,
            nullif(btrim(p->>'source'), ''), nullif(btrim(p->>'notes'), ''), auth.uid(), auth.uid())
    returning id into v_id;
  else
    update client_compliance_items set
      client_id = v_client, item_type = v_type,
      person_name = case when p ? 'person_name' then nullif(btrim(p->>'person_name'), '') else person_name end,
      reference = case when p ? 'reference' then nullif(btrim(p->>'reference'), '') else reference end,
      issue_date = v_issue, expiry_date = v_exp, next_review_date = v_rev, status = v_status,
      source = case when p ? 'source' then nullif(btrim(p->>'source'), '') else source end,
      notes = case when p ? 'notes' then nullif(btrim(p->>'notes'), '') else notes end,
      updated_at = now(), updated_by = auth.uid()
    where id = v_id;
  end if;
  return v_id;
end $$;

-- ── Close ────────────────────────────────────────────────────────────
-- The reason is appended to the notes, dated. The next scan closes any open alert for the entry.
create or replace function public.client_compliance_close(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_today date := (now() at time zone 'Asia/Dubai')::date;
begin
  if not client_compliance_can_write() then raise exception 'You do not have permission to change the compliance register.'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'A reason is required to close an entry.'; end if;
  update client_compliance_items
  set status = 'Closed',
      notes = case when notes is null then '' else notes || E'\n' end || 'Closed ' || v_today::text || ': ' || btrim(p_reason),
      updated_at = now(), updated_by = auth.uid()
  where id = p_id;
  if not found then raise exception 'That register entry does not exist.'; end if;
end $$;

-- ── List ─────────────────────────────────────────────────────────────
-- Status Active by default; All shows both. The limit is capped here, not in the browser.
create or replace function public.client_compliance_list(
  p_client text default null, p_type text default null, p_status text default 'Active', p_limit int default 100, p_offset int default 0)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_status text := nullif(btrim(p_status), '');
  v_rows jsonb; v_total bigint;
begin
  if not client_compliance_can_read() then raise exception 'You do not have permission to view the compliance register.'; end if;
  if v_status is not null and v_status not in ('Active', 'Closed', 'All') then raise exception 'Status must be Active, Closed or All.'; end if;

  with s as (
    select i.* from client_compliance_items i
    where (p_client is null or i.client_id = p_client)
      and (p_type is null or i.item_type = p_type)
      and (v_status is null or v_status = 'All' or i.status = v_status)
  ), pg as (
    select to_jsonb(i) || jsonb_build_object('client_name', cm.legal_name) as j, i.expiry_date, i.created_at, i.id
    from s i left join client_master cm on cm.client_id = i.client_id
    order by i.expiry_date nulls last, i.created_at, i.id
    limit v_limit offset v_offset
  )
  select coalesce((select jsonb_agg(j order by expiry_date nulls last, created_at, id) from pg), '[]'::jsonb), (select count(*) from s)
  into v_rows, v_total;
  return jsonb_build_object('rows', v_rows, 'total', v_total);
end $$;

-- ── Import ───────────────────────────────────────────────────────────
-- Each row is saved on its own: a bad row is reported by its 1-based position and the good rows still save.
-- A call over 500 rows saves nothing.
create or replace function public.client_compliance_import(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_saved int := 0; v_errors jsonb := '[]'::jsonb; v_n int; i int;
begin
  if not client_compliance_can_write() then raise exception 'You do not have permission to change the compliance register.'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Import rows must be a JSON array.'; end if;
  v_n := jsonb_array_length(p_rows);
  if v_n > 500 then raise exception 'An import takes at most 500 rows; nothing was saved.'; end if;
  for i in 0 .. v_n - 1 loop
    begin
      perform client_compliance_save(p_rows -> i);
      v_saved := v_saved + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_object('row', i + 1, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('saved', v_saved, 'errors', v_errors);
end $$;

-- ── Rules ────────────────────────────────────────────────────────────
-- Insert-only, so steps edited later survive a reapply.
insert into public.alert_rules (code, category, department, title_template, action_template, steps)
select w.code, w.category, 'Business Setup', 'Expiry: {subject}', 'Confirm the date, then start the renewal.',
  (case w.kind
    when 'E' then '[{"days":90,"priority":"Medium"},{"days":60,"priority":"Medium"},{"days":30,"priority":"High"},{"days":-1,"priority":"Critical"}]'
    else '[{"days":90,"priority":"Medium"},{"days":60,"priority":"Medium"},{"days":30,"priority":"High"},{"days":15,"priority":"High"},{"days":7,"priority":"High"},{"days":-1,"priority":"Critical"}]'
  end)::jsonb
from (values
  ('compliance_establishment_card', 'Ejari & Establishment Card', 'E'),
  ('compliance_ejari', 'Ejari & Establishment Card', 'E'),
  ('compliance_office_lease', 'Ejari & Establishment Card', 'E'),
  ('compliance_immigration_file', 'Ejari & Establishment Card', 'E'),
  ('compliance_labour_establishment', 'Ejari & Establishment Card', 'E'),
  ('compliance_emirates_id', 'Visa & Emirates ID', 'P'),
  ('compliance_passport', 'Visa & Emirates ID', 'P'),
  ('compliance_dependent_visa', 'Visa & Emirates ID', 'P'),
  ('compliance_work_permit', 'Visa & Emirates ID', 'P')
) as w(code, category, kind)
on conflict (code) do nothing;

-- ── Candidates ───────────────────────────────────────────────────────
-- Active entries of one type. A closed client (the licence rule's filter) raises nothing. A Closed entry is absent here,
-- so the scan resolves its open alert. A null expiry_date counts as missing data. The reference is never selected.
create or replace function public.alert_compliance_candidates(p_type text) returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select 'compliance:' || i.id || ':' || coalesce(i.expiry_date::text, ''), i.client_id,
         concat_ws(' - ', i.item_type, nullif(btrim(i.person_name), ''), m.legal_name),
         null::text, i.expiry_date, alert_owner(i.client_id, 'Business Setup'), null::uuid[],
         'client_compliance_items', i.id::text, null::uuid, null::text
  from client_compliance_items i
  left join client_master m on m.client_id = i.client_id
  left join business_setup_kyc_profiles k on k.client_id = i.client_id
  where i.item_type = p_type
    and i.status = 'Active'
    and coalesce(k.client_status, '') !~* 'liquidated|cancel|rejected'
$$;

-- alert_scan calls a rule by its code, so each type has a wrapper.
do $$
declare r record;
begin
  for r in select * from (values
    ('compliance_establishment_card', 'Establishment card'), ('compliance_ejari', 'Ejari'), ('compliance_office_lease', 'Office lease'),
    ('compliance_immigration_file', 'Immigration file'), ('compliance_labour_establishment', 'Labour establishment'),
    ('compliance_emirates_id', 'Emirates ID'), ('compliance_passport', 'Passport'), ('compliance_dependent_visa', 'Dependent visa'),
    ('compliance_work_permit', 'Work permit')) as x(code, item_type)
  loop
    execute format($f$create or replace function public.%I() returns setof public.alert_candidate
      language sql stable security definer set search_path = public, pg_temp as $b$select * from public.alert_compliance_candidates(%L)$b$ $f$,
      'alert_rule_' || r.code, r.item_type);
  end loop;
end $$;

-- ── Renewals tile and access flag ────────────────────────────────────
-- The three functions below are 004's, with the renewals filter widened and can_register added. Their grants carry over.

-- Same open rows as the list, so a tile and its list filter agree. mode lets the page say a zero in Preview is not an all clear.
create or replace function public.alert_tiles(p_scope text, p_department text default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_today date := (now() at time zone 'Asia/Dubai')::date; v_out jsonb;
begin
  select jsonb_build_object(
    'overdue',    count(*) filter (where a.due_date < v_today),
    'upcoming',   count(*) filter (where a.due_date between v_today and v_today + 7),
    'documents',  count(*) filter (where a.category = 'Client Documents'),
    'authority',  count(*) filter (where a.category = 'Government Applications'),
    'renewals',   count(*) filter (where (a.rule_code in ('licence_expiry', 'visa_expiry') or a.rule_code like 'compliance\_%') and a.current_step >= 0),
    'unassigned', count(*) filter (where a.assigned_to is null),
    'due_today',  count(*) filter (where a.due_date = v_today),
    'new_today',  count(*) filter (where (a.created_at at time zone 'Asia/Dubai')::date = v_today),
    'backlog',    count(*) filter (where a.backlog),
    'mode',       alert_mode())
  into v_out
  from alert_scope_rows(p_scope, p_department) a
  where a.status in ('Open', 'In progress');
  return v_out;
end $$;

-- ── Management summary ───────────────────────────────────────────────
-- performance: pending = open alerts assigned to the person; resolved = alerts the person closed as Resolved.
-- It is a count, not a judgement.
create or replace function public.alert_management_summary() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_today date := (now() at time zone 'Asia/Dubai')::date; v_out jsonb; v_perf jsonb; v_risk jsonb;
begin
  if not alert_is_admin() then raise exception 'You do not have permission to view the management summary.'; end if;
  select jsonb_build_object(
    'critical',           count(*) filter (where priority = 'Critical'),
    'today',              count(*) filter (where due_date = v_today),
    'client_pending',     count(*) filter (where category = 'Client Documents'),
    'government_pending', count(*) filter (where category = 'Government Applications'),
    'renewals',           count(*) filter (where (rule_code in ('licence_expiry', 'visa_expiry') or rule_code like 'compliance\_%') and current_step >= 0),
    'unassigned',         count(*) filter (where assigned_to is null),
    'delayed',            0)   -- Phase 3
  into v_out from alerts where status in ('Open', 'In progress');

  select coalesce(jsonb_agg(jsonb_build_object('user_id', q.uid, 'name', p.full_name, 'pending', q.pending, 'resolved', q.resolved)
                            order by q.pending desc, q.resolved desc, p.full_name, q.uid), '[]'::jsonb)
  into v_perf
  from (select uid, sum(pending)::int as pending, sum(resolved)::int as resolved from (
          select assigned_to as uid, 1 as pending, 0 as resolved from alerts where status in ('Open', 'In progress') and assigned_to is not null
          union all
          select resolved_by, 0, 1 from alerts where status = 'Resolved' and resolved_by is not null) u
        group by uid) q
  left join profiles p on p.id = q.uid;

  select coalesce(jsonb_agg(jsonb_build_object('client_id', c.client_id, 'client_name', cm.legal_name, 'critical', c.n)
                            order by c.n desc, c.client_id), '[]'::jsonb)
  into v_risk
  from (select client_id, count(*) as n from alerts
        where status in ('Open', 'In progress') and priority = 'Critical' and client_id is not null group by client_id) c
  left join client_master cm on cm.client_id = c.client_id;

  return v_out || jsonb_build_object('performance', v_perf, 'client_risk', v_risk);
end $$;

-- ── Access ───────────────────────────────────────────────────────────
create or replace function public.alert_my_access() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('is_admin', alert_is_admin(), 'is_manager', alert_is_manager(), 'mode', alert_mode(), 'can_register', client_compliance_can_read())
$$;


-- Browser grants, each function checking its caller inside. The internal helpers (rules, candidates, types) are not granted.
revoke execute on function
  public.client_compliance_can_read(), public.client_compliance_can_write(), public.client_compliance_item_types(),
  public.client_compliance_save(jsonb), public.client_compliance_close(uuid, text),
  public.client_compliance_list(text, text, text, int, int), public.client_compliance_import(jsonb),
  public.alert_compliance_candidates(text),
  public.alert_rule_compliance_establishment_card(), public.alert_rule_compliance_ejari(), public.alert_rule_compliance_office_lease(),
  public.alert_rule_compliance_immigration_file(), public.alert_rule_compliance_labour_establishment(), public.alert_rule_compliance_emirates_id(),
  public.alert_rule_compliance_passport(), public.alert_rule_compliance_dependent_visa(), public.alert_rule_compliance_work_permit()
  from public, anon, authenticated;
grant execute on function
  public.client_compliance_can_read(), public.client_compliance_can_write(), public.client_compliance_save(jsonb),
  public.client_compliance_close(uuid, text), public.client_compliance_list(text, text, text, int, int), public.client_compliance_import(jsonb)
  to authenticated;
