-- Every signed-in user gets the Notification Centre tab (key mytasks). Decided by the user 2026-11-05.
-- My Notifications is for everyone (spec section 13), and most staff never held the old Hot Alerts tab.
-- Unticking this tab in Settings has no effect while this holds. Rollback: rollback/005_rollback.sql.
create or replace function public.my_tabs() returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct t), '{}') from (
    select tab_key as t from member_tab_access where profile_id = auth.uid()
    union all
    select unnest(array['quotations', 'ardentax']) where hub_is_admin()
    union all
    select 'mytasks' where auth.uid() is not null
  ) x
$$;
