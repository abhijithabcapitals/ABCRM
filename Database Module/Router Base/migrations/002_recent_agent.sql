-- Router Base: router_context also says which agent wrote each recent reply, so Bruno can give an agent only its own
-- replies. Without this, one agent's text would reach every other agent. Run after 001_router.sql. Idempotent.

create or replace function public.router_context(p_profile uuid)
returns jsonb language sql stable security definer set search_path = public, router, pg_temp as $$
  with m as (select (date_trunc('month', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai') as start_at),
  cr as (
    select greatest(c.monthly_credit_usd - coalesce((select sum(u.cost_usd) from public.agent_usage u, m
      where u.profile_id = p_profile and u.created_at >= m.start_at), 0), 0) as credit_left
    from public.agent_user_credit c where c.profile_id = p_profile),
  ag as (
    select a.id, a.name, a.role, a.sort_order,
      case when a.monthly_budget_usd is null then null
        else a.monthly_budget_usd - coalesce((select sum(u.cost_usd) from public.agent_usage u, m
          where u.agent_id = a.id and u.created_at >= m.start_at), 0) end as budget_left
    from public.agents a
    join public.agent_user_access x on x.agent_id = a.id and x.profile_id = p_profile
    where a.enabled)
  select jsonb_build_object(
    'agent_name', coalesce((select s.agent_name from router.settings s where s.profile_id = p_profile), 'Bruno'),
    'ceo_thread_id', (select s.ceo_thread_id from router.settings s where s.profile_id = p_profile),
    'credit_left', coalesce((select credit_left from cr), 0),
    'agents', case when coalesce((select credit_left from cr), 0) > 0 then coalesce((
      select jsonb_agg(jsonb_build_object('id', ag.id, 'name', ag.name, 'role', ag.role, 'budget_left', ag.budget_left) order by ag.sort_order, ag.id)
      from ag where ag.budget_left is null or ag.budget_left > 0), '[]'::jsonb) else '[]'::jsonb end,
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('role', r.role, 'content', r.content, 'agent_id', r.agent_id) order by r.id)
      from (select m2.id, m2.role, m2.content, m2.agent_id from router.messages m2
            where m2.profile_id = p_profile and not (m2.role = 'assistant' and m2.agent_id is null)
            order by m2.id desc limit 6) r), '[]'::jsonb));
$$;

revoke all on function public.router_context(uuid) from public, anon, authenticated;
grant execute on function public.router_context(uuid) to service_role;
