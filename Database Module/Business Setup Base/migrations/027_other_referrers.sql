-- =====================================================================
-- Business Setup Base - a referrer who is not on the staff              027
-- =====================================================================
-- A case can be credited to a third party, typed by name ("Other" in Change referrer). Each name typed is kept in
-- business_setup_other_referrers, so it is offered in the list next time. A case holds either a member of staff (referred_by)
-- or a third party's name (referred_by_other), never both. case_list needs no change: to_jsonb(c) already carries referred_by_other.
-- Runs after 019 and 022. Re-runnable. Undo with rollback/027_rollback.sql. Applied live on 2026-11-06 as business_setup_025_other_referrers (numbered 025 before main took 025).
-- =====================================================================

create table if not exists public.business_setup_other_referrers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
create unique index if not exists business_setup_other_referrers_name_idx on public.business_setup_other_referrers (lower(btrim(name)));
alter table public.business_setup_other_referrers enable row level security;
revoke all on public.business_setup_other_referrers from public, anon, authenticated;

alter table public.business_setup_cases add column if not exists referred_by_other text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'business_setup_cases_one_referrer') then
    alter table public.business_setup_cases add constraint business_setup_cases_one_referrer check (referred_by is null or referred_by_other is null);
  end if;
end $$;

-- The third-party names saved so far, for the Referred by list.
create or replace function public.business_setup_other_referrer_list() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform business_setup_require('setup.access');
  return (select coalesce(jsonb_agg(r.name order by lower(r.name)), '[]'::jsonb) from business_setup_other_referrers r);
end $$;

-- As business_setup_case_set_referrer (019), for a third party. Admins only, with a reason, logged. A new name is saved for next time;
-- a name already saved (in any case or spacing) is used as it was first saved, so the list holds each person once.
create or replace function public.business_setup_case_set_referrer_other(p_case uuid, p_name text, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c business_setup_cases; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_name text := nullif(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
begin
  if not client_portal_is_admin() then raise exception 'Admins only.'; end if;
  if v_reason is null then raise exception 'Enter a reason'; end if;
  if v_name is null or length(v_name) < 2 or length(v_name) > 120 then raise exception 'Enter the referrer''s name (2 to 120 characters)'; end if;
  select * into c from business_setup_cases where id = p_case for update;
  if c.id is null then raise exception 'Case not found'; end if;
  insert into business_setup_other_referrers (name) values (v_name) on conflict ((lower(btrim(name)))) do nothing;
  select r.name into v_name from business_setup_other_referrers r where lower(btrim(r.name)) = lower(v_name);
  update business_setup_cases set referred_by = null, referred_by_other = v_name where id = p_case;
  perform business_setup_audit('business_setup_cases', p_case::text, 'case_referrer_change',
    jsonb_build_object('referred_by', c.referred_by, 'referred_by_other', c.referred_by_other), jsonb_build_object('referred_by_other', v_name, 'reason', v_reason));
end $$;

-- As in 019, and choosing a member of staff (or no one) clears a third party's name.
create or replace function public.business_setup_case_set_referrer(p_case uuid, p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c business_setup_cases; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not client_portal_is_admin() then raise exception 'Admins only.'; end if;
  if v_reason is null then raise exception 'Enter a reason'; end if;
  select * into c from business_setup_cases where id = p_case for update;
  if c.id is null then raise exception 'Case not found'; end if;
  if p_user is not null and not exists (select 1 from profiles where id = p_user) then raise exception 'That person was not found'; end if;
  update business_setup_cases set referred_by = p_user, referred_by_other = null where id = p_case;
  perform business_setup_audit('business_setup_cases', p_case::text, 'case_referrer_change',
    jsonb_build_object('referred_by', c.referred_by, 'referred_by_other', c.referred_by_other), jsonb_build_object('referred_by', p_user, 'reason', v_reason));
end $$;

-- As in 019, and a third party's name is listed too.
create or replace function public.business_setup_referrers() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  return (select coalesce(jsonb_object_agg(t.client_id, t.names), '{}'::jsonb) from (
    select c.client_id, jsonb_agg(distinct case when c.referred_by is not null then business_setup_person_name(c.referred_by) else c.referred_by_other end) as names
      from business_setup_cases c where c.client_id is not null and (c.referred_by is not null or c.referred_by_other is not null) group by c.client_id) t);
end $$;

revoke all on function public.business_setup_other_referrer_list(), public.business_setup_case_set_referrer_other(uuid, text, text),
  public.business_setup_case_set_referrer(uuid, uuid, text), public.business_setup_referrers() from public, anon;
grant execute on function public.business_setup_other_referrer_list(), public.business_setup_case_set_referrer_other(uuid, text, text),
  public.business_setup_case_set_referrer(uuid, uuid, text), public.business_setup_referrers() to authenticated;
