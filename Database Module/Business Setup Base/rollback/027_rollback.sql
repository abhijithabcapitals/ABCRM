-- Undoes migrations/027_other_referrers.sql. business_setup_case_set_referrer and business_setup_referrers go back to 019 (texts copied unchanged,
-- with their grants). The third-party referrer names are deleted: a case credited to one shows no referrer afterwards. Staff referrers are kept.
begin;
drop function if exists public.business_setup_case_set_referrer_other(uuid, text, text);
drop function if exists public.business_setup_other_referrer_list();

create or replace function public.business_setup_case_set_referrer(p_case uuid, p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c business_setup_cases; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not client_portal_is_admin() then raise exception 'Admins only.'; end if;
  if v_reason is null then raise exception 'Enter a reason'; end if;
  select * into c from business_setup_cases where id = p_case for update;
  if c.id is null then raise exception 'Case not found'; end if;
  if p_user is not null and not exists (select 1 from profiles where id = p_user) then raise exception 'That person was not found'; end if;
  update business_setup_cases set referred_by = p_user where id = p_case;
  perform business_setup_audit('business_setup_cases', p_case::text, 'case_referrer_change', jsonb_build_object('referred_by', c.referred_by), jsonb_build_object('referred_by', p_user, 'reason', v_reason));
end $$;

create or replace function public.business_setup_referrers() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  return (select coalesce(jsonb_object_agg(t.client_id, t.names), '{}'::jsonb) from (
    select c.client_id, jsonb_agg(distinct business_setup_person_name(c.referred_by)) as names
      from business_setup_cases c where c.client_id is not null and c.referred_by is not null group by c.client_id) t);
end $$;
revoke all on function public.business_setup_case_set_referrer(uuid, uuid, text), public.business_setup_referrers() from public, anon;
grant execute on function public.business_setup_case_set_referrer(uuid, uuid, text), public.business_setup_referrers() to authenticated;

alter table public.business_setup_cases drop constraint if exists business_setup_cases_one_referrer;
alter table public.business_setup_cases drop column if exists referred_by_other;
drop table if exists public.business_setup_other_referrers;
commit;
