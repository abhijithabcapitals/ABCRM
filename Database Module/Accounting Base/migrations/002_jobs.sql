-- =====================================================================
-- Accounting Base - jobs, file batches and invoice record          002
-- =====================================================================
-- Run after 001. One job is one service for one period. Files are recorded by name only.
-- Reads and writes need accounts.review; every write goes through a function below, no table grants a write.
-- Audit trail triggers are attached by the live audit-trail-attach job, so none are added here.
-- Idempotent: safe to re-run. Undo with rollback/002_rollback.sql.
-- =====================================================================

-- ── Dubai date ───────────────────────────────────────────────────────
-- Every "today" check uses this, so a late evening in UTC is already tomorrow in Dubai.
create or replace function public.accounting_dubai_date(p_at timestamptz default now()) returns date
language sql immutable set search_path = pg_catalog, pg_temp as $$ select (p_at at time zone 'Asia/Dubai')::date $$;

-- ── Tables ───────────────────────────────────────────────────────────
create sequence if not exists public.accounting_job_seq;

create table if not exists public.accounting_jobs (
  id uuid primary key default gen_random_uuid(),
  job_number text not null unique default ('JOB-' || lpad(nextval('public.accounting_job_seq')::text, 6, '0')),
  client_id text references public.client_master(client_id),
  client_name text not null,
  service_name text not null,                 -- text, so a later catalogue change does not alter old jobs
  service_department text,
  period_label text,
  due_date date,
  is_new_client boolean not null default false,
  assignee_ids uuid[] not null default '{}',
  legacy_assignees text,                      -- old names with no CRM user
  work_status text not null default 'To Do' check (work_status in ('To Do','In Progress','Pending','Completed','Client Cancelled')),
  remarks text,
  completed_at timestamptz,
  completed_by uuid,
  fee_amount numeric(18,2) check (fee_amount >= 0),
  payment_tracked boolean not null default true,   -- false only on old jobs with no fee
  quote_id uuid references public.hub_documents(id),
  letter_id uuid references public.hub_documents(id),
  invoice_number text,
  invoice_date date,
  invoice_amount numeric(18,2) check (invoice_amount > 0),
  invoiced_by uuid,
  invoiced_at timestamptz,
  next_follow_up_on date,
  legacy_key text unique,
  legacy_raw jsonb,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default clock_timestamp()   -- the version stamp a stale save is checked against
);
create index if not exists accounting_jobs_client_idx on public.accounting_jobs (client_id);
create index if not exists accounting_jobs_status_idx on public.accounting_jobs (work_status);

create table if not exists public.accounting_job_batches (   -- not append-only: the saved tick changes
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.accounting_jobs(id),
  received_on date not null,
  receipt_mode text not null check (receipt_mode in ('Email','WhatsApp','Hand delivery','Courier','Shared link','Other')),
  mode_note text,
  saved_to_folder boolean not null default false,
  saved_by uuid,
  saved_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists accounting_batches_job_idx on public.accounting_job_batches (job_id);

create table if not exists public.accounting_job_files (     -- names only, no file content
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.accounting_job_batches(id),
  file_name text not null,
  notes text,
  unique (batch_id, file_name)
);

create table if not exists public.accounting_job_events (    -- append-only
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.accounting_jobs(id),
  event text not null,
  from_value text,
  to_value text,
  remarks text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists accounting_events_job_idx on public.accounting_job_events (job_id, created_at);
drop trigger if exists accounting_events_immutable on public.accounting_job_events;
create trigger accounting_events_immutable before update or delete on public.accounting_job_events for each row execute function public.banking_append_only();

-- ── Access ───────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['accounting_jobs','accounting_job_batches','accounting_job_files','accounting_job_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.banking_can(''accounts.review''))', t || '_read', t);
  end loop;
end $$;
revoke all on sequence public.accounting_job_seq from anon, authenticated;

-- ── Helper (not callable from the API) ───────────────────────────────
create or replace function public.accounting_job_event(p_job uuid, p_event text, p_from text, p_to text, p_remarks text) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into accounting_job_events (job_id, event, from_value, to_value, remarks) values (p_job, p_event, p_from, p_to, p_remarks)
$$;

-- ── Jobs ─────────────────────────────────────────────────────────────
-- No id creates a job. An id with expected_updated_at edits it. The fee can be set here only when creating.
create or replace function public.accounting_job_save(p jsonb) returns public.accounting_jobs
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j accounting_jobs;
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_client text := nullif(trim(p ->> 'client_name'), '');
  v_service text := nullif(trim(p ->> 'service_name'), '');
  v_fee numeric := nullif(p ->> 'fee_amount', '')::numeric;
  v_client_id text := nullif(trim(p ->> 'client_id'), '');
  v_assignees uuid[];
begin
  perform banking_require('accounts.review');
  if v_client is null then raise exception 'Enter the client name'; end if;
  if v_service is null then raise exception 'Choose the service'; end if;
  if p ? 'assignee_ids' then
    select coalesce(array_agg(x::uuid), '{}') into v_assignees from jsonb_array_elements_text(p -> 'assignee_ids') x;
  end if;
  if v_id is null then
    if v_fee < 0 then raise exception 'The fee cannot be negative'; end if;
    if v_client_id is not null and not exists (select 1 from client_master where client_id = v_client_id) then raise exception 'That client does not exist in the client master'; end if;
    insert into accounting_jobs (client_id, client_name, service_name, service_department, period_label, due_date, is_new_client, assignee_ids, fee_amount)
    values (v_client_id, v_client, v_service, nullif(trim(p ->> 'service_department'), ''), nullif(trim(p ->> 'period_label'), ''),
            nullif(p ->> 'due_date', '')::date, coalesce((p ->> 'is_new_client')::boolean, false), coalesce(v_assignees, '{}'), v_fee)
    returning * into j;
    perform accounting_job_event(j.id, 'Created', null, j.work_status, null);
    return j;
  end if;
  select * into j from accounting_jobs where id = v_id for update;
  if j.id is null then raise exception 'Job not found'; end if;
  if nullif(p ->> 'expected_updated_at', '')::timestamptz is distinct from j.updated_at then
    raise exception 'This job was changed by someone else. Please reload and try again';
  end if;
  if v_fee is not null and v_fee is distinct from j.fee_amount then raise exception 'Change the fee with the fee action, not by editing the job'; end if;
  update accounting_jobs set client_name = v_client, service_name = v_service,
         service_department = nullif(trim(p ->> 'service_department'), ''), period_label = nullif(trim(p ->> 'period_label'), ''),
         due_date = nullif(p ->> 'due_date', '')::date, is_new_client = coalesce((p ->> 'is_new_client')::boolean, is_new_client),
         assignee_ids = coalesce(v_assignees, assignee_ids), updated_at = clock_timestamp()
   where id = v_id returning * into j;
  perform accounting_job_event(j.id, 'Edited', null, null, null);
  return j;
end $$;

create or replace function public.accounting_job_set_status(p_job uuid, p_status text, p_remarks text, p_expected timestamptz) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare j accounting_jobs; v_rem text := nullif(trim(p_remarks), '');
begin
  perform banking_require('accounts.review');
  select * into j from accounting_jobs where id = p_job for update;
  if j.id is null then raise exception 'Job not found'; end if;
  if p_expected is distinct from j.updated_at then raise exception 'This job was changed by someone else. Please reload and try again'; end if;
  if p_status is null or p_status not in ('To Do','In Progress','Pending','Completed','Client Cancelled') then raise exception 'Unknown work status'; end if;
  if p_status in ('Pending','Client Cancelled') and v_rem is null then raise exception '% needs remarks saying why', p_status; end if;
  if j.work_status = 'Completed' and p_status <> 'Completed' and j.invoice_number is not null then
    raise exception 'This job has an invoice recorded. Clear the invoice, giving a reason, before reopening it';
  end if;
  if p_status = j.work_status and v_rem is not distinct from j.remarks then return; end if;
  update accounting_jobs set work_status = p_status, remarks = v_rem,
         -- Stamped only on the move into Completed: an old Done job gaining a remark keeps the stamps it has.
         completed_at = case when p_status <> 'Completed' then null when j.work_status <> 'Completed' then coalesce(j.completed_at, clock_timestamp()) else j.completed_at end,
         completed_by = case when p_status <> 'Completed' then null when j.work_status <> 'Completed' then coalesce(j.completed_by, auth.uid()) else j.completed_by end,
         updated_at = clock_timestamp()
   where id = p_job;
  perform accounting_job_event(p_job, 'Status changed', j.work_status, p_status, v_rem);
end $$;

create or replace function public.accounting_job_set_fee(p_job uuid, p_amount numeric) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare j accounting_jobs;
begin
  perform banking_require('accounts.review');
  if p_amount is null then raise exception 'Enter the fee'; end if;
  if p_amount < 0 then raise exception 'The fee cannot be negative'; end if;
  select * into j from accounting_jobs where id = p_job for update;
  if j.id is null then raise exception 'Job not found'; end if;
  update accounting_jobs set fee_amount = p_amount, payment_tracked = true, updated_at = clock_timestamp() where id = p_job;
  perform accounting_job_event(p_job, 'Fee changed', j.fee_amount::text, p_amount::text, null);
end $$;

-- A quote sets the fee from its total when asked, and always when the job has no fee yet. A total of 0 counts as no total.
create or replace function public.accounting_job_link_document(p_job uuid, p_kind text, p_doc uuid, p_use_quote_total boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare j accounting_jobs; d hub_documents; v_fee numeric;
begin
  perform banking_require('accounts.review');
  if p_kind is null or p_kind not in ('quote','letter') then raise exception 'The document must be a quote or a letter'; end if;
  select * into j from accounting_jobs where id = p_job for update;
  if j.id is null then raise exception 'Job not found'; end if;
  select * into d from hub_documents where id = p_doc;
  if d.id is null then raise exception 'Document not found'; end if;
  if d.doc_type <> p_kind then raise exception 'This document is not a %', p_kind; end if;
  if p_kind = 'letter' then
    update accounting_jobs set letter_id = p_doc, updated_at = clock_timestamp() where id = p_job;
    perform accounting_job_event(p_job, 'Letter linked', j.letter_id::text, p_doc::text, null);
    return;
  end if;
  v_fee := case when coalesce(p_use_quote_total, false) or j.fee_amount is null then coalesce(nullif(d.total_amount, 0), j.fee_amount) else j.fee_amount end;
  update accounting_jobs set quote_id = p_doc, fee_amount = v_fee, payment_tracked = payment_tracked or v_fee is not null, updated_at = clock_timestamp() where id = p_job;
  perform accounting_job_event(p_job, 'Quote linked', j.quote_id::text, p_doc::text, null);
  if v_fee is distinct from j.fee_amount then perform accounting_job_event(p_job, 'Fee changed', j.fee_amount::text, v_fee::text, 'From the quote total'); end if;
end $$;

create or replace function public.accounting_job_link_client(p_job uuid, p_client text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare j accounting_jobs;
begin
  perform banking_require('accounts.review');
  select * into j from accounting_jobs where id = p_job for update;
  if j.id is null then raise exception 'Job not found'; end if;
  if not exists (select 1 from client_master where client_id = p_client) then raise exception 'That client does not exist in the client master'; end if;
  update accounting_jobs set client_id = p_client, updated_at = clock_timestamp() where id = p_job;
  perform accounting_job_event(p_job, 'Client linked', j.client_id, p_client, null);
end $$;

-- ── File batches ─────────────────────────────────────────────────────
-- p: job_id, received_on, receipt_mode, mode_note, notes, files (array of names). Repeated names are stored once.
create or replace function public.accounting_batch_add(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job uuid := nullif(p ->> 'job_id', '')::uuid; v_on date := nullif(p ->> 'received_on', '')::date;
        v_mode text := p ->> 'receipt_mode'; v_note text := nullif(trim(p ->> 'mode_note'), ''); v_files text[]; v_batch uuid;
begin
  perform banking_require('accounts.review');
  if not exists (select 1 from accounting_jobs where id = v_job) then raise exception 'Job not found'; end if;
  if v_on is null then raise exception 'Enter the date received'; end if;
  if v_on > accounting_dubai_date() then raise exception 'The date received cannot be in the future'; end if;
  if v_mode is null or v_mode not in ('Email','WhatsApp','Hand delivery','Courier','Shared link','Other') then raise exception 'Unknown mode of receipt'; end if;
  if v_mode = 'Other' and v_note is null then raise exception 'Other needs a note saying how the files arrived'; end if;
  if jsonb_typeof(p -> 'files') = 'array' then
    select array_agg(n order by first_at) into v_files
      from (select trim(x) n, min(ord) first_at from jsonb_array_elements_text(p -> 'files') with ordinality a(x, ord) where trim(x) <> '' group by trim(x)) s;
  end if;
  if v_files is null then raise exception 'Add at least one file name'; end if;
  insert into accounting_job_batches (job_id, received_on, receipt_mode, mode_note, notes)
  values (v_job, v_on, v_mode, v_note, nullif(trim(p ->> 'notes'), '')) returning id into v_batch;
  insert into accounting_job_files (batch_id, file_name) select v_batch, unnest(v_files);
  return v_batch;
end $$;

create or replace function public.accounting_batch_set_saved(p_batch uuid, p_saved boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform banking_require('accounts.review');
  update accounting_job_batches set saved_to_folder = coalesce(p_saved, false),
         saved_by = case when p_saved then auth.uid() end, saved_at = case when p_saved then clock_timestamp() end
   where id = p_batch;
  if not found then raise exception 'Batch not found'; end if;
end $$;

-- ── Invoice ──────────────────────────────────────────────────────────
-- The Zoho invoice is typed in by hand. Only a Completed job takes one.
create or replace function public.accounting_invoice_set(p_job uuid, p_number text, p_date date, p_amount numeric) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare j accounting_jobs; v_no text := nullif(trim(p_number), '');
begin
  perform banking_require('accounts.review');
  select * into j from accounting_jobs where id = p_job for update;
  if j.id is null then raise exception 'Job not found'; end if;
  if j.work_status <> 'Completed' then raise exception 'Only a Completed job can be invoiced'; end if;
  if v_no is null then raise exception 'Enter the invoice number'; end if;
  if p_date is null then raise exception 'Enter the invoice date'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'The invoice amount must be above zero'; end if;
  update accounting_jobs set invoice_number = v_no, invoice_date = p_date, invoice_amount = p_amount,
         invoiced_by = auth.uid(), invoiced_at = clock_timestamp(), payment_tracked = true, updated_at = clock_timestamp()
   where id = p_job;
  perform accounting_job_event(p_job, 'Invoice recorded', j.invoice_number, v_no, p_amount::text);
end $$;

create or replace function public.accounting_invoice_clear(p_job uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare j accounting_jobs; v_reason text := nullif(trim(p_reason), ''); v_untrack boolean;
begin
  perform banking_require('accounts.review');
  if v_reason is null then raise exception 'Give a reason for clearing the invoice'; end if;
  select * into j from accounting_jobs where id = p_job for update;
  if j.id is null then raise exception 'Job not found'; end if;
  if j.invoice_number is null then raise exception 'This job has no invoice recorded'; end if;
  -- Recording the invoice started tracking an old finished job, so clearing it stops that again, unless it has payment
  -- history, reversals included. The import stores the export row in legacy_raw; its Status is 'Done' for finished work,
  -- and legacy_load.py strips whitespace before comparing. accounting_payments comes from 003: plpgsql reads it only when this runs.
  v_untrack := j.fee_amount is null and regexp_replace(j.legacy_raw ->> 'Status', '[\s\u00a0]', '', 'g') = 'Done'
               and not exists (select 1 from accounting_payments where job_id = j.id);
  update accounting_jobs set invoice_number = null, invoice_date = null, invoice_amount = null, invoiced_by = null, invoiced_at = null,
         payment_tracked = case when v_untrack then false else payment_tracked end,
         updated_at = clock_timestamp()
   where id = p_job;
  perform accounting_job_event(p_job, 'Invoice cleared', j.invoice_number, null, v_reason);
end $$;

-- ── Who may run what ─────────────────────────────────────────────────
revoke all on function public.accounting_job_event(uuid, text, text, text, text) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['accounting_dubai_date(timestamptz)','accounting_job_save(jsonb)','accounting_job_set_status(uuid,text,text,timestamptz)',
      'accounting_job_set_fee(uuid,numeric)','accounting_job_link_document(uuid,text,uuid,boolean)','accounting_job_link_client(uuid,text)',
      'accounting_batch_add(jsonb)','accounting_batch_set_saved(uuid,boolean)','accounting_invoice_set(uuid,text,date,numeric)','accounting_invoice_clear(uuid,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
