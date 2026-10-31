-- =====================================================================
-- Banking Base - document numbering and generated files            006
-- =====================================================================
-- Numbers quotations and engagement letters from a format set in Settings, e.g. ABC/2026/10/BBQ001.
-- Records already issued keep their numbers. Idempotent: safe to re-run.
-- =====================================================================
create table if not exists public.banking_number_counters (
  kind text not null check (kind in ('quote','letter')),
  period text not null,                            -- 'all', '2026' or '2026-10', by the restart rule
  last_serial int not null default 0,
  primary key (kind, period)
);
alter table public.banking_number_counters enable row level security;
revoke all on public.banking_number_counters from anon, authenticated;

insert into public.banking_settings (key, value, description) values
  ('document_numbering', '{"quote":{"format":"ABC/{YYYY}/{MM}/BBQ{SERIAL}","digits":3,"restart":"never"},"letter":{"format":"ABC/{YYYY}/{MM}/BBE{SERIAL}","digits":3,"restart":"never"}}', 'Numbering of quotations and engagement letters. Change it on the Document Numbering page.')
on conflict (key) do nothing;

-- A revised letter keeps its number with a new version, the same as a revised quotation.
alter table public.banking_engagement_letters drop constraint if exists banking_engagement_letters_letter_number_key;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'banking_letters_number_version_uq') then
    alter table public.banking_engagement_letters add constraint banking_letters_number_version_uq unique (letter_number, version);
  end if;
end $$;

create table if not exists public.banking_generated_documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.banking_cases(id),
  kind text not null check (kind in ('quote','letter')),
  quotation_id uuid references public.banking_quotations(id),
  letter_id uuid references public.banking_engagement_letters(id),
  document_number text not null,
  file_name text not null,
  storage_path text not null,
  local_path text,                                 -- null until written to the folder on the office PC
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists banking_gen_docs_case_idx on public.banking_generated_documents (case_id);
alter table public.banking_generated_documents enable row level security;
revoke all on public.banking_generated_documents from anon, authenticated;
grant select, insert on public.banking_generated_documents to authenticated;
drop policy if exists banking_gen_docs_read on public.banking_generated_documents;
create policy banking_gen_docs_read on public.banking_generated_documents for select to authenticated using (public.banking_can('quotes.view') or public.banking_can('agreements.view'));
drop policy if exists banking_gen_docs_add on public.banking_generated_documents;
create policy banking_gen_docs_add on public.banking_generated_documents for insert to authenticated with check (public.banking_can('quotes.manage') or public.banking_can('agreements.manage'));

alter table public.banking_generated_documents add column if not exists document_serial int;

-- Reads the serial out of the number using the format, so the two can never disagree.
create or replace function public.banking_generated_serial() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare fmt text := banking_setting('document_numbering') -> new.kind ->> 'format';
begin
  new.document_serial := substring(new.document_number from '^' || replace(replace(replace(regexp_replace(fmt, '([.+*?()\[\]^$|\\])', '\\\1', 'g'), '{YYYY}', '[0-9]{4}'), '{MM}', '[0-9]{2}'), '{SERIAL}', '([0-9]+)') || '$')::int;
  return new;
end $$;
drop trigger if exists banking_generated_serial on public.banking_generated_documents;
create trigger banking_generated_serial before insert on public.banking_generated_documents for each row execute function public.banking_generated_serial();

create or replace function public.banking_number_period(p_restart text, p_on date) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case p_restart when 'month' then to_char(p_on, 'YYYY-MM') when 'year' then to_char(p_on, 'YYYY') else 'all' end
$$;

create or replace function public.banking_number_format(p_format text, p_digits int, p_serial int, p_on date) returns text
language sql immutable set search_path = public, pg_temp as $$
  select replace(replace(replace(p_format, '{YYYY}', to_char(p_on, 'YYYY')), '{MM}', to_char(p_on, 'MM')), '{SERIAL}',
         lpad(p_serial::text, greatest(p_digits, length(p_serial::text)), '0'))
$$;

create or replace function public.banking_number_taken(p_kind text, p_number text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case p_kind when 'quote' then exists (select 1 from banking_quotations where quotation_number = p_number)
                     else exists (select 1 from banking_engagement_letters where letter_number = p_number) end
$$;

-- Takes the next serial under a row lock, so two people can never get the same number.
create or replace function public.banking_next_number(p_kind text, p_on date default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cfg jsonb := banking_setting('document_numbering') -> p_kind;
  v_on date := coalesce(p_on, (now() at time zone 'Asia/Dubai')::date);
  v_period text := banking_number_period(cfg ->> 'restart', v_on);
  v_serial int; v_number text;
begin
  insert into banking_number_counters (kind, period) values (p_kind, v_period) on conflict do nothing;
  select last_serial into v_serial from banking_number_counters where kind = p_kind and period = v_period for update;
  loop
    v_serial := v_serial + 1;
    v_number := banking_number_format(cfg ->> 'format', (cfg ->> 'digits')::int, v_serial, v_on);
    exit when not banking_number_taken(p_kind, v_number);
  end loop;
  update banking_number_counters set last_serial = v_serial where kind = p_kind and period = v_period;
  return v_number;
end $$;

create or replace function public.banking_numbering_status() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_object_agg(k, jsonb_build_object('format', c ->> 'format', 'digits', (c ->> 'digits')::int, 'restart', c ->> 'restart', 'next_serial', n, 'preview', banking_number_format(c ->> 'format', (c ->> 'digits')::int, n, d)))
  from (select k, c, d, coalesce((select last_serial from banking_number_counters x where x.kind = k and x.period = banking_number_period(c ->> 'restart', d)), 0) + 1 as n
          from (values ('quote'), ('letter')) v(k)
          cross join lateral (select banking_setting('document_numbering') -> k as c, (now() at time zone 'Asia/Dubai')::date as d) y) t
  where banking_can('app.access')
$$;

create or replace function public.banking_numbering_save(p_kind text, p_format text, p_digits int, p_restart text, p_next int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_on date := (now() at time zone 'Asia/Dubai')::date; v_period text;
begin
  perform banking_require('settings.manage');
  if p_kind not in ('quote','letter') then raise exception 'Unknown document kind'; end if;
  if position('{SERIAL}' in coalesce(p_format, '')) = 0 then raise exception 'The format must contain {SERIAL}'; end if;
  if p_digits not between 1 and 8 then raise exception 'Digits must be between 1 and 8'; end if;
  if p_restart not in ('never','year','month') then raise exception 'Unknown restart rule'; end if;
  if p_next < 1 then raise exception 'The next number must be 1 or more'; end if;
  update banking_settings set value = jsonb_set(value, array[p_kind], jsonb_build_object('format', p_format, 'digits', p_digits, 'restart', p_restart)) where key = 'document_numbering';
  v_period := banking_number_period(p_restart, v_on);
  insert into banking_number_counters (kind, period, last_serial) values (p_kind, v_period, p_next - 1)
  on conflict (kind, period) do update set last_serial = excluded.last_serial;
  insert into banking_activity_logs (actor, entity_table, entity_id, action, new_data)
  values (auth.uid(), 'banking_number_counters', p_kind, 'UPDATE', jsonb_build_object('format', p_format, 'digits', p_digits, 'restart', p_restart, 'next', p_next));
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('banking_number_period','banking_number_format','banking_number_taken','banking_next_number','banking_numbering_status','banking_numbering_save') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname in ('banking_numbering_status','banking_numbering_save') then execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
