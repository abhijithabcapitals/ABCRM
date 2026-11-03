-- =====================================================================
-- Accounting Base - old CRM import                                   004
-- =====================================================================
-- Run after 002. scripts/legacy_load.py writes rows into accounting_legacy_rows (state staged or held);
-- accounting_legacy_apply() turns the staged ones into jobs. Held rows are never applied.
-- The apply function is for the Supabase CLI only: execute is revoked from public, anon and authenticated,
-- and it checks no role, because auth.uid() is null there. Imported jobs keep created_by null.
-- Idempotent: safe to re-run. Undo with rollback/004_rollback.sql.
-- =====================================================================

create table if not exists public.accounting_legacy_rows (
  id uuid primary key default gen_random_uuid(),
  row_no int not null,                       -- the row's position in the export file
  legacy_key text not null,                  -- hash of name, type and created date, see legacy_load.py
  raw jsonb not null,                        -- the whole export row
  mapped jsonb not null,                     -- what the importer made of it
  state text not null default 'staged' check (state in ('staged','held','committed')),
  reason text,
  job_id uuid references public.accounting_jobs(id),
  created_at timestamptz not null default now(),
  unique (legacy_key, row_no)
);
create index if not exists accounting_legacy_rows_state_idx on public.accounting_legacy_rows (state);

alter table public.accounting_legacy_rows enable row level security;
revoke all on public.accounting_legacy_rows from anon, authenticated;
grant select on public.accounting_legacy_rows to authenticated;
drop policy if exists accounting_legacy_rows_read on public.accounting_legacy_rows;
create policy accounting_legacy_rows_read on public.accounting_legacy_rows for select to authenticated using (public.banking_can('accounts.review'));

-- ── Apply ────────────────────────────────────────────────────────────
-- Staged rows in file order. A row whose key already has a job is marked committed with reason 'already there' and the job is left alone.
-- Assignees: a name matching exactly one profile (ignoring case and outer spaces) goes to assignee_ids, anything else stays as text.
-- Client: linked only when exactly one client_master legal_name matches, ignoring case and outer spaces.
-- Returns committed, already_there, held, linked_clients and unmatched_assignees (names left as text).
create or replace function public.accounting_legacy_apply() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r accounting_legacy_rows; m jsonb; v_job uuid; v_existing uuid;
  v_committed int := 0; v_there int := 0; v_linked int := 0;
  v_unmatched text[] := '{}';
  v_ids uuid[]; v_text text[]; v_name text; v_look text; v_profile uuid[]; v_client text[]; v_client_name text;
begin
  for r in select * from accounting_legacy_rows where state = 'staged' order by row_no, id for update loop
    select id into v_existing from accounting_jobs where legacy_key = r.legacy_key;
    if v_existing is not null then
      update accounting_legacy_rows set state = 'committed', reason = 'already there', job_id = v_existing where id = r.id;
      v_there := v_there + 1;
      continue;
    end if;
    m := r.mapped;

    v_ids := '{}'; v_text := '{}';
    for v_name in select nullif(trim(x), '') from jsonb_array_elements_text(coalesce(m -> 'assignees', '[]'::jsonb)) x loop
      continue when v_name is null;
      v_look := lower(case when lower(v_name) = 'geo ab capital' then 'GEO' else v_name end);   -- the one known alias
      select array_agg(id) into v_profile from profiles where lower(trim(full_name)) = v_look;
      if cardinality(v_profile) = 1 then
        if not v_profile[1] = any(v_ids) then v_ids := v_ids || v_profile[1]; end if;
      else
        if not v_name = any(v_text) then v_text := v_text || v_name; end if;
        if not v_name = any(v_unmatched) then v_unmatched := v_unmatched || v_name; end if;
      end if;
    end loop;

    v_client_name := nullif(trim(m ->> 'client_name'), '');
    select array_agg(client_id) into v_client from client_master where lower(trim(legal_name)) = lower(v_client_name);

    insert into accounting_jobs (client_id, client_name, service_name, service_department, due_date, assignee_ids, legacy_assignees,
                                 work_status, remarks, completed_at, payment_tracked, legacy_key, legacy_raw, created_at, created_by)
    values (case when cardinality(v_client) = 1 then v_client[1] end, v_client_name, m ->> 'service_name', nullif(m ->> 'service_department', ''),
            nullif(m ->> 'due_date', '')::date, v_ids, nullif(array_to_string(v_text, ', '), ''),
            coalesce(nullif(m ->> 'work_status', ''), 'To Do'), nullif(m ->> 'remarks', ''),
            (nullif(m ->> 'completed_at', '')::date)::timestamp at time zone 'Asia/Dubai',
            coalesce((m ->> 'payment_tracked')::boolean, true), r.legacy_key, r.raw,
            coalesce((nullif(m ->> 'created_at', '')::date)::timestamp at time zone 'Asia/Dubai', now()), null)
    returning id into v_job;
    insert into accounting_job_events (job_id, event, from_value, to_value, remarks, created_by)
    select id, 'Imported', null, work_status, 'Old CRM import', null from accounting_jobs where id = v_job;

    update accounting_legacy_rows set state = 'committed', reason = null, job_id = v_job where id = r.id;
    v_committed := v_committed + 1;
    if cardinality(v_client) = 1 then v_linked := v_linked + 1; end if;
  end loop;
  return jsonb_build_object('committed', v_committed, 'already_there', v_there,
    'held', (select count(*) from accounting_legacy_rows where state = 'held'),
    'linked_clients', v_linked, 'unmatched_assignees', to_jsonb(v_unmatched));
end $$;
revoke all on function public.accounting_legacy_apply() from public, anon, authenticated;
