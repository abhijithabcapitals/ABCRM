-- Document Base 002: od_copy plan builder. Client matching, duplicate rules, target paths, approval, report.
-- Idempotent (create or replace). Needs 001. Spec: Document Intelligence Module/docs/2026-11-06-onedrive-copy-design.md
-- ("Stages: Plan", "Target path rules"). Writes only to od_copy tables; nothing here talks to OneDrive.
-- Functions that read tables (folder_for, employee_label, build_plan, approve): security definer, empty search_path.
-- The pure text helpers (normalize_name, legal_form, cap_segment, clean_segment, fit_path) read no tables, so they are
-- plain immutable functions: a SET clause costs a settings save/restore on every call (about 2x slower over 170,000
-- files). All execute for service_role only. Views: security_invoker, so the od_copy Row Level Security (admins and
-- CEO read) applies to whoever reads them.
-- Rollback: drop view od_copy.report, od_copy.item_map; drop function od_copy.build_plan(), od_copy.approve(text,text,text),
-- od_copy.fit_path(text[],int), od_copy.folder_for(text), od_copy.employee_label(text), od_copy.clean_segment(text),
-- od_copy.cap_segment(text,int), od_copy.legal_form(text), od_copy.normalize_name(text),
-- od_copy.claim(text,int,int), od_copy.rollback_candidates(text,text,text,int); drop index od_copy.plan_claim_idx;
-- alter table od_copy.plan drop column hash_checked.
begin;

-- Company name for matching: lowercase, & -> and, punctuation -> space, legal-form and filler words removed.
create or replace function od_copy.normalize_name(p text) returns text
language sql immutable parallel safe as $$
  select btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(replace(lower(coalesce(p, '')), '&', ' and '), '[^a-z0-9]+', ' ', 'g'),
        '\ml l c\M', ' ', 'g'),
      '\m(llc|fzco|fze|fzc|fz|dmcc|dwc|spc|soc|ltd|limited|co|company|est|establishment|branch|trading|general|the|and|service|services)\M',
      ' ', 'g'),
    ' +', ' ', 'g'))
$$;

-- The legal-form words of a name, sorted and space-separated ('' when none), so FZCO and LLC can be told apart.
create or replace function od_copy.legal_form(p text) returns text
language sql immutable parallel safe as $$
  select coalesce(string_agg(distinct w, ' ' order by w), '')
  from (
    select case m[1] when 'limited' then 'ltd' when 'establishment' then 'est' else m[1] end as w
    from regexp_matches(
      regexp_replace(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', ' ', 'g'), '\ml l c\M', 'llc', 'g'),
      '\m(llc|fzco|fze|fzc|fz|dmcc|dwc|spc|soc|ltd|limited|est|establishment|branch)\M', 'g') as m
  ) x
$$;

-- Shorten a name to n characters, keeping a short extension (.pdf, .xlsx) and dropping trailing dots and spaces.
create or replace function od_copy.cap_segment(p text, n int) returns text
language plpgsql immutable parallel safe as $$
declare
  ext text;
  r text;
begin
  if p is null or length(p) <= n then return p; end if;
  ext := substring(p from '(\.[A-Za-z0-9]{1,10})$');
  if ext is not null and length(p) > length(ext) and length(ext) < n then
    r := rtrim(left(left(p, length(p) - length(ext)), n - length(ext)), '. ') || ext;
  else
    r := rtrim(left(p, n), '. ');
  end if;
  return case when r = '' then '_' else r end;
end $$;

-- One valid OneDrive name: " * : < > ? / \ | and control characters -> '-', no leading spaces, no trailing dots or
-- spaces, reserved names (CON, PRN, AUX, NUL, COM0-9, LPT0-9, .lock, desktop.ini, ~$...) prefixed with '_', '_vti_' broken up
-- (prefixing alone would leave it inside the name), at most 120 characters keeping the extension. Empty -> '_'.
create or replace function od_copy.clean_segment(p text) returns text
language plpgsql immutable parallel safe as $$
declare
  r text;
begin
  r := regexp_replace(translate(coalesce(p, ''), '"*:<>?/\|', '---------'), '[\x01-\x1f\x7f]', '-', 'g');
  r := ltrim(rtrim(r, '. '), ' ');
  if r = '' then return '_'; end if;
  r := replace(r, '_vti_', '_vti-');
  if upper(split_part(r, '.', 1)) ~ '^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$' or lower(r) in ('.lock', 'desktop.ini')
     or r like '~$%' then
    r := '_' || r;
  end if;
  return od_copy.cap_segment(r, 120);
end $$;

-- Target path from its segments: each cleaned, joined with '/'. The full OneDrive path 'CRM AB CAPITAL/<target>' must
-- stay under 400 characters, so the target gets at most 384. The first p_protected segments (department, client
-- folder, FOLDER, service, unmatched area, person folder ...) are never shortened. Too long: the original sub-path
-- folders between the protected prefix and the last two segments go to 20 characters; still too long, every
-- unprotected folder goes to 8; still too long, the file name is shortened, keeping its extension.
drop function if exists od_copy.fit_path(text[]);
create or replace function od_copy.fit_path(p text[], p_protected int default 0) returns text
language plpgsql immutable parallel safe as $$
declare
  max_len constant int := 399 - length('CRM AB CAPITAL/');
  s text[];
  n int;
  k int;
  r text;
begin
  select array_agg(od_copy.clean_segment(x) order by o) into s from unnest(p) with ordinality as u(x, o);
  r := array_to_string(s, '/');
  if length(r) <= max_len then return r; end if;
  n := cardinality(s);
  k := least(greatest(coalesce(p_protected, 0), 0), n - 1);
  for i in k + 1 .. n - 2 loop s[i] := od_copy.cap_segment(s[i], 20); end loop;
  r := array_to_string(s, '/');
  if length(r) <= max_len then return r; end if;
  for i in k + 1 .. n - 1 loop s[i] := od_copy.cap_segment(s[i], 8); end loop;
  r := array_to_string(s, '/');
  if length(r) <= max_len then return r; end if;
  s[n] := od_copy.cap_segment(s[n], greatest(max_len - (length(r) - length(s[n])), 16));
  return array_to_string(s, '/');
end $$;

-- FOLDER for the first sub-folder under an old client folder: first folder_rules match by priority, else OTHERS.
create or replace function od_copy.folder_for(p text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select r.folder from od_copy.folder_rules r
    where case when r.is_regex then p ~* r.pattern else strpos(lower(p), lower(r.pattern)) > 0 end
    order by r.priority, r.pattern limit 1), 'OTHERS')
$$;

-- '<Full Name> - <Code>' for an old employee folder: full name (case-insensitive) when exactly one employee has it,
-- else the first word when exactly one employee's first word matches and the folder is that one word, or every other
-- word of the folder is also in that employee's name (so 'Zed Other' never lands under 'Zed Testperson'), else null.
create or replace function od_copy.employee_label(p text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  n int;
  r text;
  w text[];
  en text;
begin
  if p is null or btrim(p) = '' then return null; end if;
  select count(*), min(btrim(e.full_name) || ' - ' || e.employee_code) into n, r
  from public.hr_employees e where lower(btrim(e.full_name)) = lower(btrim(p));
  if n = 1 then return r; elsif n > 1 then return null; end if;
  w := regexp_split_to_array(lower(btrim(p)), '\s+');
  select count(*), min(btrim(e.full_name) || ' - ' || e.employee_code), min(lower(btrim(e.full_name))) into n, r, en
  from public.hr_employees e where (regexp_split_to_array(lower(btrim(e.full_name)), '\s+'))[1] = w[1];
  if n <> 1 then return null; end if;
  if cardinality(w) = 1 or w[2:] <@ regexp_split_to_array(en, '\s+') then return r; end if;
  return null;
end $$;

-- One row per old file: its area (longest matching area_rules prefix; root files -> '(root files)'; unknown top
-- folders -> archive), the path segments below the area, and the old client or employee folder.
create or replace view od_copy.item_map with (security_invoker = true) as
select s.item_id, s.parent_path, s.name, s.size, s.quickxor_hash, s.modified_at, x.path,
  coalesce(a.area, x.top) as area,
  coalesce(a.kind, 'archive') as kind,
  coalesce(a.department, '08 Archive') as department,
  a.service,
  coalesce(a.target_prefix, '08 Archive/From old OneDrive/' || x.top) as target_prefix,
  (a.area is null) as unknown_area,
  y.segs,
  case when coalesce(a.kind, 'archive') in ('client', 'employees') and cardinality(y.segs) > c.ci then y.segs[c.ci] end as client_folder,
  case when c.ci = 2 and cardinality(y.segs) > 1 then y.segs[1] end as task,
  case when cardinality(y.segs) > c.ci + 1 then y.segs[c.ci + 1] end as first_sub,
  y.segs[(c.ci + 1):] as sub_segs
from od_copy.source_items s
cross join lateral (select btrim(coalesce(s.parent_path, ''), '/') as pp) q
cross join lateral (select case when q.pp = '' then s.name else q.pp || '/' || s.name end as path,
                           case when q.pp = '' then '(root files)' else split_part(q.pp, '/', 1) end as top,
                           q.pp = '' as is_root) x
left join lateral (
  select r.area, r.kind, r.department, r.service, r.target_prefix from od_copy.area_rules r
  where (x.is_root and r.area = '(root files)')
     or (not x.is_root and lower(left(x.path, length(r.area) + 1)) = lower(r.area) || '/')
  order by length(r.area) desc limit 1) a on true
cross join lateral (select case when x.is_root then array[s.name]
                                else string_to_array(substr(x.path, length(coalesce(a.area, x.top)) + 2), '/') end as segs) y
-- Corporate Tax is '3. Corporate Tax/<task>/<client>/...': the client folder is the second segment below the area.
cross join lateral (select case when a.area = '3. Corporate Tax' then 2 else 1 end as ci) c
where not s.is_folder;

-- Rebuild client_matches (keeping approved, rejected and manual rows) and every plan row still 'planned' or
-- 'skipped_duplicate'. Rows past planning (approved, copying, copied, verified, failed, rolled_back) are never changed.
create or replace function od_copy.build_plan() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  result jsonb;
begin
  -- The file map is read once per run (the view does a prefix lookup per file).
  drop table if exists pg_temp.od_items;
  create temp table od_items on commit drop as select * from od_copy.item_map;

  delete from od_copy.client_matches where not (coalesce(status, '') in ('approved', 'rejected') or coalesce(method, '') = 'manual');

  with f as (
    select d.area, d.folder_name, od_copy.normalize_name(d.folder_name) as nf, od_copy.legal_form(d.folder_name) as lf
    from (select distinct i.area, i.client_folder as folder_name from pg_temp.od_items i
          where i.kind = 'client' and i.client_folder is not null) d),
  c as (
    select cm.client_id, od_copy.normalize_name(cm.legal_name) as nc, od_copy.legal_form(cm.legal_name) as lc
    from public.client_master cm where cm.legal_name is not null),
  ex as (
    select f.area, f.folder_name, count(*) as n, min(c.client_id) as one_id,
      bool_or(f.lf <> '' and c.lc <> '' and f.lf <> c.lc) as conflict
    from f join c on c.nc = f.nf where f.nf <> '' group by f.area, f.folder_name),
  cl as (
    select f.area, f.folder_name, count(*) as n, min(c.client_id) as one_id
    from f join c on c.nc <> f.nf and least(length(f.nf), length(c.nc)) >= 6
      and (strpos(c.nc, f.nf) > 0 or strpos(f.nf, c.nc) > 0)
    group by f.area, f.folder_name)
  insert into od_copy.client_matches (area, folder_name, client_id, method, status, confidence)
  select f.area, f.folder_name,
    case when ex.n = 1 then ex.one_id when ex.n is null and cl.n = 1 then cl.one_id end,
    case when ex.n > 0 then 'exact' when cl.n > 0 then 'close' else 'none' end,
    case when ex.n = 1 and not ex.conflict then 'auto' when ex.n > 0 or cl.n > 0 then 'review' else 'unmatched' end,
    case when ex.n = 1 and not ex.conflict then 1.0 when ex.n > 0 then 0.5 when cl.n > 0 then 0.7 else 0 end
  from f
  left join ex on ex.area = f.area and ex.folder_name = f.folder_name
  left join cl on cl.area = f.area and cl.folder_name = f.folder_name
  on conflict (area, folder_name) do nothing;

  -- FOLDER and employee labels are looked up once per distinct name, not once per file.
  with fo as (
    select d.first_sub, od_copy.folder_for(d.first_sub) as folder
    from (select distinct i.first_sub from pg_temp.od_items i where i.kind = 'client' and i.first_sub is not null) d),
  el as (
    select d.client_folder, od_copy.employee_label(d.client_folder) as label
    from (select distinct i.client_folder from pg_temp.od_items i where i.kind = 'employees' and i.client_folder is not null) d),
  m as (
    select i.*, cm.client_id as mclient, cl.legal_name, coalesce(fo.folder, 'OTHERS') as folder,
      (i.kind = 'client' and cm.status in ('auto', 'approved') and cm.client_id is not null and cl.legal_name is not null) as matched,
      (i.kind = 'fixed' and i.area = '1. AB Capital Documents' and cardinality(i.segs) > 1 and i.segs[1] ilike '%employ%') as employment_list
    from pg_temp.od_items i
    left join od_copy.client_matches cm on i.kind = 'client' and cm.area = i.area and cm.folder_name = i.client_folder
    left join public.client_master cl on cl.client_id = cm.client_id
    left join fo on i.kind = 'client' and fo.first_sub = i.first_sub),
  t as (
    select m.item_id, m.path, m.parent_path, m.size, m.quickxor_hash, m.modified_at, m.matched,
      case when m.matched then m.mclient end as client_id,
      case when m.employment_list then 'HR' else m.department end as department,
      case
        when m.kind = 'client' and m.matched then
          array[m.department, m.legal_name || ' - ' || m.mclient, m.folder]
          || string_to_array(m.service || coalesce('/' || m.task, ''), '/') || m.sub_segs
        when m.kind = 'client' then array[m.department, '00 Unmatched - to link'] || string_to_array(m.area, '/') || m.segs
        when m.employment_list then array['HR', '00 Policies', 'Employment list'] || m.segs
        when m.kind = 'employees' then case
          when m.client_folder is null then array[m.department, '00 Unmatched'] || m.segs
          when lower(btrim(m.client_folder)) = 'ex employees' then array[m.department, '00 EX EMPLOYEES'] || m.sub_segs
          when e.label is not null then array[m.department, e.label, 'OTHERS'] || m.sub_segs
          else array[m.department, '00 Unmatched'] || m.segs end
        else string_to_array(m.target_prefix, '/') || m.segs
      end as parts,
      -- Leading segments fit_path must never shorten: the CRM structure and the old client or person folder.
      case
        when m.kind = 'client' and m.matched then 3 + cardinality(string_to_array(m.service || coalesce('/' || m.task, ''), '/'))
        when m.kind = 'client' then 2 + cardinality(string_to_array(m.area, '/'))
          + least(case when m.area = '3. Corporate Tax' then 2 else 1 end, cardinality(m.segs) - 1)
        when m.employment_list then 4
        when m.kind = 'employees' then case
          when m.client_folder is null or lower(btrim(m.client_folder)) = 'ex employees' then 2
          else 3 end
        else cardinality(string_to_array(m.target_prefix, '/'))
      end as protected
    from m
    left join el e on m.kind = 'employees' and e.client_folder = m.client_folder),
  k as (
    -- Duplicates: same size and quickXorHash. Kept: a copy already past planning, then one in a matched client
    -- folder, then the newest, then the shortest folder path, then item id.
    select t.*,
      case when t.quickxor_hash is not null and t.size > 0 then
        first_value(t.item_id) over (
          partition by t.size, t.quickxor_hash
          order by coalesce(p.status, '') in ('approved', 'copying', 'copied', 'verified', 'failed') desc,
                   t.matched desc, t.modified_at desc nulls last, length(t.parent_path), t.item_id)
      end as keeper
    from t left join od_copy.plan p on p.source_item_id = t.item_id)
  insert into od_copy.plan as p (source_item_id, source_path, target_path, department, client_id, status, duplicate_of, updated_at)
  select k.item_id, k.path, od_copy.fit_path(k.parts, k.protected), k.department, k.client_id,
    case when k.keeper is null or k.keeper = k.item_id then 'planned' else 'skipped_duplicate' end,
    case when k.keeper <> k.item_id then k.keeper end,
    now()
  from k
  on conflict (source_item_id) do update set
    source_path = excluded.source_path, target_path = excluded.target_path, department = excluded.department,
    client_id = excluded.client_id, status = excluded.status, duplicate_of = excluded.duplicate_of, updated_at = now()
  where (p.status is null or p.status in ('planned', 'skipped_duplicate'))
    and (p.source_path, p.target_path, p.department, p.client_id, p.status, p.duplicate_of)
        is distinct from (excluded.source_path, excluded.target_path, excluded.department, excluded.client_id, excluded.status, excluded.duplicate_of);

  select jsonb_build_object(
    'files', (select count(*) from od_copy.source_items s where not s.is_folder),
    'to_copy', count(*) filter (where p.status <> 'skipped_duplicate'),
    'duplicates', count(*) filter (where p.status = 'skipped_duplicate'),
    'bytes_to_copy', coalesce(sum(s.size) filter (where p.status <> 'skipped_duplicate'), 0),
    'matched_folders', (select count(*) from od_copy.client_matches cm where cm.status in ('auto', 'approved')),
    'review_folders', (select count(*) from od_copy.client_matches cm where cm.status = 'review'),
    'unmatched_folders', (select count(*) from od_copy.client_matches cm where cm.status in ('unmatched', 'rejected')))
  into result
  from od_copy.plan p join od_copy.source_items s on s.item_id = p.source_item_id;

  insert into od_copy.operations (action, result, detail) values ('build_plan', 'ok', result);
  return result;
end $$;

-- planned -> approved. 'all': matched client rows and every non-client area. 'client': only p_client_id (the pilot).
-- 'unmatched': client-area rows without a matched client (they go to '00 Unmatched - to link'). p_area narrows any scope.
create or replace function od_copy.approve(p_scope text default 'all', p_area text default null, p_client_id text default null)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  if p_scope is null or p_scope not in ('all', 'client', 'unmatched') then
    raise exception 'approve: scope must be all, client or unmatched, not %', coalesce(p_scope, 'null');
  end if;
  if p_scope = 'client' and p_client_id is null then
    raise exception 'approve: scope client needs p_client_id';
  end if;
  update od_copy.plan p set status = 'approved', updated_at = now()
  from od_copy.item_map i
  where i.item_id = p.source_item_id
    and p.status = 'planned'
    and (p_area is null or i.area = p_area)
    and case p_scope
          when 'all' then i.kind <> 'client' or p.client_id is not null
          when 'client' then p.client_id = p_client_id
          else i.kind = 'client' and p.client_id is null
        end;
  get diagnostics n = row_count;
  insert into od_copy.operations (action, result, detail)
  values ('approve', 'ok', jsonb_build_object('scope', p_scope, 'area', p_area, 'client_id', p_client_id, 'rows', n));
  return n;
end $$;

-- hash_checked: false when a copy was verified by size alone (the source file had no quickXorHash), true when size
-- and hash were both compared. Null until verified.
alter table od_copy.plan add column if not exists hash_checked boolean;

-- Work queue for the copy Edge Function (Task 4). Two concurrent calls never return the same row: candidates are
-- locked with "for update skip locked" and changed in the same statement.
-- 'approved': at most p_limit rows minus those already 'copying' (so the in-flight cap holds across overlapping runs)
-- become 'copying' with no monitor URL yet. A row that failed before waits p_lease_seconds after its last change
-- (retry back-off). 'copying': rows untouched for p_lease_seconds (longer than one 120 s run) are leased to the caller
-- by touching updated_at. Returns the plan columns plus the source file's size and quickXorHash (for verification).
create index if not exists plan_claim_idx on od_copy.plan (status, attempts, source_item_id);

create or replace function od_copy.claim(p_status text, p_limit int, p_lease_seconds int default 150)
returns table (source_item_id text, source_path text, target_path text, department text, client_id text, status text,
  dest_item_id text, monitor_url text, attempts int, error text, size bigint, quickxor_hash text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  n bigint := greatest(coalesce(p_limit, 0), 0);
  lease interval := make_interval(secs => greatest(coalesce(p_lease_seconds, 150), 0));
begin
  if p_status = 'approved' then
    n := greatest(0, n - (select count(*) from od_copy.plan x where x.status = 'copying'));
    return query
    with c as (
      select p.source_item_id as id from od_copy.plan p
      where p.status = 'approved' and (p.attempts = 0 or p.updated_at < now() - lease)
      order by p.attempts, p.source_item_id
      limit n
      for update skip locked)
    update od_copy.plan p set status = 'copying', monitor_url = null, updated_at = now()
    from c, od_copy.source_items s
    where p.source_item_id = c.id and s.item_id = p.source_item_id
    returning p.source_item_id, p.source_path, p.target_path, p.department, p.client_id, p.status,
      p.dest_item_id, p.monitor_url, p.attempts, p.error, s.size, s.quickxor_hash;
  elsif p_status = 'copying' then
    return query
    with c as (
      select p.source_item_id as id from od_copy.plan p
      where p.status = 'copying' and p.updated_at < now() - lease
      order by p.updated_at, p.source_item_id
      limit n
      for update skip locked)
    update od_copy.plan p set updated_at = now()
    from c, od_copy.source_items s
    where p.source_item_id = c.id and s.item_id = p.source_item_id
    returning p.source_item_id, p.source_path, p.target_path, p.department, p.client_id, p.status,
      p.dest_item_id, p.monitor_url, p.attempts, p.error, s.size, s.quickxor_hash;
  else
    raise exception 'od_copy.claim: status must be approved or copying, not %', p_status;
  end if;
end $$;

-- Rollback input: this job's own verified copies (status 'verified' with the dest_item_id it recorded), in a scope.
-- p_area as in item_map (longest area rule; '(root files)' = files directly in the old root); p_client_id; both null
-- = every copy. Paged by source_item_id after p_after. Read-only: the Edge Function re-checks each item before recycling.
create or replace function od_copy.rollback_candidates(p_area text default null, p_client_id text default null,
  p_after text default null, p_limit int default 50)
returns table (source_item_id text, source_path text, target_path text, department text, client_id text, status text,
  dest_item_id text, monitor_url text, attempts int, error text, size bigint, quickxor_hash text)
language sql stable security definer set search_path = '' as $$
  select p.source_item_id, p.source_path, p.target_path, p.department, p.client_id, p.status,
    p.dest_item_id, p.monitor_url, p.attempts, p.error, s.size, s.quickxor_hash
  from od_copy.plan p
  join od_copy.source_items s on s.item_id = p.source_item_id
  where p.status = 'verified' and p.dest_item_id is not null
    and (p_client_id is null or p.client_id = p_client_id)
    and (p_area is null or case
      when p_area = '(root files)' then strpos(coalesce(p.source_path, ''), '/') = 0
      else lower(left(p.source_path, length(p_area) + 1)) = lower(p_area) || '/'
        and not exists (select 1 from od_copy.area_rules r where length(r.area) > length(p_area)
                        and lower(left(p.source_path, length(r.area) + 1)) = lower(r.area) || '/')
    end)
    and (p_after is null or p.source_item_id > p_after)
  order by p.source_item_id
  limit greatest(coalesce(p_limit, 50), 0)
$$;

-- One row per old area for the CRM screen.
create or replace view od_copy.report with (security_invoker = true) as
select i.area,
  count(*) as files,
  round(coalesce(sum(i.size), 0) / 1073741824.0, 3) as gb,
  count(*) filter (where p.status = 'skipped_duplicate') as duplicates,
  count(*) filter (where p.status = 'planned') as planned,
  count(*) filter (where p.status = 'approved') as approved,
  count(*) filter (where p.status = 'verified') as verified,
  count(*) filter (where p.status = 'failed') as failed,
  count(*) filter (where p.status = 'verified' and p.hash_checked is false) as verified_size_only
from od_copy.item_map i
left join od_copy.plan p on p.source_item_id = i.item_id
group by i.area;

do $$ declare f text; begin
  foreach f in array array['od_copy.normalize_name(text)', 'od_copy.legal_form(text)', 'od_copy.cap_segment(text,int)',
    'od_copy.clean_segment(text)', 'od_copy.fit_path(text[],int)', 'od_copy.folder_for(text)', 'od_copy.employee_label(text)',
    'od_copy.build_plan()', 'od_copy.approve(text,text,text)', 'od_copy.claim(text,int,int)',
    'od_copy.rollback_candidates(text,text,text,int)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
revoke all on od_copy.item_map, od_copy.report from public, anon;
grant select on od_copy.item_map, od_copy.report to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
