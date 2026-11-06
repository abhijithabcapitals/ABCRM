-- =====================================================================
-- Notification Base - Changes Made                                    019
-- =====================================================================
-- Every change to a client's key registration and ownership data lands in changes_made_log, with who made it
-- and when. The Notification Centre shows it as the CHANGES MADE card.
-- Watched:
--   Client Master (client_master_history): Company Registration Number, Trade License Number, License Issuing
--     Authority, License Issue Date, License Expiry Date, Establishment Date, Shareholders, UBO.
--   Business Setup KYC: licence number and expiry; each partner's name, share, nationality, shareholder flag,
--     passport number and expiry, Emirates ID; partners added and removed.
--   Banking KYC: licence number, authority, issue and expiry dates; each shareholder as above.
-- Passport numbers and Emirates IDs are stored masked (last 4 characters only), never in full.
-- Read: Notification Centre admin or manager, or anyone with the Accounting or Clients tab.
-- Re-runnable. Triggers attach only to tables that exist. Rollback: rollback/019_rollback.sql.
-- =====================================================================

create table if not exists public.changes_made_log (
  id bigint generated always as identity primary key,
  client_id text not null,
  client_name text,
  source text not null,            -- Client Master, Business Setup KYC, Banking KYC
  person text,                     -- the shareholder or partner the change is about, if any
  field text not null,
  old_value text,
  new_value text,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index if not exists changes_made_log_time_idx on public.changes_made_log (changed_at desc);
create index if not exists changes_made_log_client_idx on public.changes_made_log (client_id, changed_at desc);

create table if not exists public.changes_made_seen (
  user_id uuid primary key,
  seen_at timestamptz not null default now()
);

alter table public.changes_made_log enable row level security;
alter table public.changes_made_seen enable row level security;
revoke all on public.changes_made_log, public.changes_made_seen from public, anon, authenticated;

create or replace function public.changes_made_locked() returns trigger language plpgsql set search_path = pg_catalog as $$
begin raise exception 'The client change log cannot be changed'; end $$;
drop trigger if exists changes_made_log_lock on public.changes_made_log;
create trigger changes_made_log_lock before update or delete on public.changes_made_log
  for each row execute function public.changes_made_locked();
drop trigger if exists changes_made_log_no_truncate on public.changes_made_log;
create trigger changes_made_log_no_truncate before truncate on public.changes_made_log
  for each statement execute function public.changes_made_locked();

-- Column name to the label staff see.
create or replace function public.changes_made_label(k text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case k
    when 'licence_number' then 'Trade License Number'
    when 'license_number' then 'Trade License Number'
    when 'licence_expiry' then 'License Expiry Date'
    when 'license_expiry_date' then 'License Expiry Date'
    when 'license_issue_date' then 'License Issue Date'
    when 'issuing_authority' then 'License Issuing Authority'
    when 'full_name' then 'Name'
    when 'share_percent' then 'Ownership %'
    when 'ownership_percent' then 'Ownership %'
    when 'nationality' then 'Nationality'
    when 'is_shareholder' then 'Shareholder'
    when 'shareholder_type' then 'Shareholder Type'
    when 'passport_number' then 'Passport Number'
    when 'passport_expiry' then 'Passport Expiry'
    when 'emirates_id' then 'Emirates ID'
    else k end $$;

-- Passport numbers and Emirates IDs keep their last 4 characters only.
create or replace function public.changes_made_show(k text, v text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case
    when v is null or btrim(v) = '' then null
    when k in ('passport_number', 'emirates_id') then
      case when length(btrim(v)) > 4 then '****' || right(btrim(v), 4) else '****' end
    else left(v, 2000) end $$;

-- The Client ID a KYC row belongs to.
create or replace function public.changes_made_client(p_table text, r jsonb) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v text;
begin
  if p_table = 'business_setup_kyc_profiles' then
    v := r ->> 'client_id';
  elsif p_table = 'business_setup_kyc_partners' then
    select k.client_id into v from business_setup_kyc_profiles k where k.id = (r ->> 'kyc_id')::uuid;
  elsif p_table = 'banking_kyc_profiles' then
    select c.client_master_id into v from banking_clients c where c.id = (r ->> 'client_id')::uuid;
  elsif p_table = 'banking_kyc_shareholders' then
    select c.client_master_id into v from banking_kyc_profiles k join banking_clients c on c.id = k.client_id where k.id = (r ->> 'kyc_profile_id')::uuid;
  end if;
  return nullif(btrim(v), '');
end $$;

create or replace function public.changes_made_write(p_client text, p_source text, p_person text, p_field text, p_old text, p_new text,
  p_by uuid default null, p_at timestamptz default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into changes_made_log (client_id, client_name, source, person, field, old_value, new_value, changed_by, changed_at)
  values (p_client, (select legal_name from client_master where client_id = p_client), p_source, p_person, p_field, p_old, p_new,
          coalesce(p_by, auth.uid()), coalesce(p_at, now()));
end $$;

-- KYC tables. tg_argv[0] is the source label, the rest are the watched columns. Rows with full_name are people:
-- adding, removing (delete or deleted_at set) and restoring them is logged as one line.
create or replace function public.changes_made_trg() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  v_client text := changes_made_client(tg_table_name, coalesce(n, o));
  v_person text := nullif(btrim(coalesce(n ->> 'full_name', o ->> 'full_name', '')), '');
  is_person boolean := r ? 'full_name';
  k text;
  i int;
begin
  if v_client is null then return null; end if;
  if is_person and tg_op = 'INSERT' then
    if n ->> 'deleted_at' is null then
      perform changes_made_write(v_client, tg_argv[0], v_person, 'Shareholder / Partner added', null, v_person);
    end if;
    return null;
  end if;
  if is_person and (tg_op = 'DELETE' or (o ->> 'deleted_at' is null and n ->> 'deleted_at' is not null)) then
    if tg_op = 'DELETE' and o ->> 'deleted_at' is not null then return null; end if;
    perform changes_made_write(v_client, tg_argv[0], v_person, 'Shareholder / Partner removed', v_person, null);
    return null;
  end if;
  if is_person and tg_op = 'UPDATE' and o ->> 'deleted_at' is not null and n ->> 'deleted_at' is null then
    perform changes_made_write(v_client, tg_argv[0], v_person, 'Shareholder / Partner restored', null, v_person);
    return null;
  end if;
  if tg_op = 'DELETE' then return null; end if;
  for i in 1 .. tg_nargs - 1 loop
    k := tg_argv[i];
    if (case when tg_op = 'INSERT' then null else o ->> k end) is distinct from (n ->> k) then
      perform changes_made_write(v_client, tg_argv[0], case when is_person then v_person end, changes_made_label(k),
        changes_made_show(k, case when tg_op = 'INSERT' then null else o ->> k end), changes_made_show(k, n ->> k));
    end if;
  end loop;
  return null;
end $$;

-- Client Master: copy the watched fields from its own history, keeping who and when.
create or replace function public.changes_made_master_trg() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.field = any (array['Company Registration Number', 'Trade License Number', 'License Issuing Authority', 'License Issue Date',
                            'License Expiry Date', 'Establishment Date', 'Shareholders', 'UBO'])
     and new.old_value is distinct from new.new_value then
    perform changes_made_write(new.client_id, 'Client Master', null, new.field, left(new.old_value, 2000), left(new.new_value, 2000),
                                new.changed_by, new.changed_at);
  end if;
  return null;
end $$;

do $$
begin
  if to_regclass('public.client_master_history') is not null then
    drop trigger if exists changes_made_master on public.client_master_history;
    create trigger changes_made_master after insert on public.client_master_history
      for each row execute function public.changes_made_master_trg();
  end if;
  if to_regclass('public.business_setup_kyc_profiles') is not null then
    drop trigger if exists changes_made_kyc on public.business_setup_kyc_profiles;
    create trigger changes_made_kyc after insert or update on public.business_setup_kyc_profiles
      for each row execute function public.changes_made_trg('Business Setup KYC', 'licence_number', 'licence_expiry');
  end if;
  if to_regclass('public.business_setup_kyc_partners') is not null then
    drop trigger if exists changes_made_partner on public.business_setup_kyc_partners;
    create trigger changes_made_partner after insert or update or delete on public.business_setup_kyc_partners
      for each row execute function public.changes_made_trg('Business Setup KYC', 'full_name', 'share_percent', 'nationality',
        'is_shareholder', 'passport_number', 'passport_expiry', 'emirates_id');
  end if;
  if to_regclass('public.banking_kyc_profiles') is not null then
    drop trigger if exists changes_made_kyc on public.banking_kyc_profiles;
    create trigger changes_made_kyc after insert or update on public.banking_kyc_profiles
      for each row execute function public.changes_made_trg('Banking KYC', 'license_number', 'issuing_authority', 'license_issue_date', 'license_expiry_date');
  end if;
  if to_regclass('public.banking_kyc_shareholders') is not null then
    drop trigger if exists changes_made_partner on public.banking_kyc_shareholders;
    create trigger changes_made_partner after insert or update or delete on public.banking_kyc_shareholders
      for each row execute function public.changes_made_trg('Banking KYC', 'full_name', 'ownership_percent', 'nationality',
        'shareholder_type', 'passport_number', 'passport_expiry', 'emirates_id');
  end if;
end $$;

-- ── Browser functions ────────────────────────────────────────────────
create or replace function public.changes_made_can_read() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and (alert_is_admin() or alert_is_manager() or my_tabs() && array['accounts', 'clients']) $$;

-- The card and its list. new_count is what changed since the caller last opened the list.
create or replace function public.changes_made_list(p_days int default 30, p_limit int default 200) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_seen timestamptz;
  v_from timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365));
begin
  if not changes_made_can_read() then return jsonb_build_object('allowed', false); end if;
  select seen_at into v_seen from changes_made_seen where user_id = auth.uid();
  return jsonb_build_object(
    'allowed', true,
    'seen_at', v_seen,
    'total', (select count(*) from changes_made_log where changed_at >= v_from),
    'new_count', (select count(*) from changes_made_log where changed_at >= v_from and (v_seen is null or changed_at > v_seen)),
    'items', (select coalesce(jsonb_agg(x order by x.changed_at desc, x.id desc), '[]'::jsonb) from (
      select l.id, l.client_id, l.client_name, l.source, l.person, l.field, l.old_value, l.new_value, l.changed_at,
             coalesce(p.full_name, p.email, case when l.changed_by is null then 'System' else 'Unknown user' end) as changed_by_name,
             (v_seen is null or l.changed_at > v_seen) as is_new
        from changes_made_log l left join profiles p on p.id = l.changed_by
       where l.changed_at >= v_from
       order by l.changed_at desc, l.id desc
       limit least(greatest(coalesce(p_limit, 200), 1), 500)) x));
end $$;

create or replace function public.changes_made_mark_seen() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not changes_made_can_read() then raise exception 'You do not have permission to view client changes.'; end if;
  insert into changes_made_seen (user_id, seen_at) values (auth.uid(), now())
  on conflict (user_id) do update set seen_at = excluded.seen_at;
end $$;

revoke execute on function
  public.changes_made_locked(), public.changes_made_label(text), public.changes_made_show(text, text),
  public.changes_made_client(text, jsonb), public.changes_made_write(text, text, text, text, text, text, uuid, timestamptz),
  public.changes_made_trg(), public.changes_made_master_trg(),
  public.changes_made_can_read(), public.changes_made_list(int, int), public.changes_made_mark_seen()
  from public, anon, authenticated;
grant execute on function public.changes_made_can_read(), public.changes_made_list(int, int), public.changes_made_mark_seen() to authenticated;
