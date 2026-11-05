-- Puts my_tabs() back as it was before 005 (the Template Hub Base 004 version). Safe to run twice.
create or replace function public.my_tabs() returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct t), '{}') from (
    select tab_key as t from member_tab_access where profile_id = auth.uid()
    union all
    select unnest(array['quotations', 'ardentax']) where hub_is_admin()
  ) x
$$;
