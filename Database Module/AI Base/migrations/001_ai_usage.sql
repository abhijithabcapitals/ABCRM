-- =====================================================================
-- AI Base - what each OpenRouter call used and cost                001
-- =====================================================================
-- One row per model call, written by the Edge Functions with the service role. Holds counts only, never prompts
-- or replies. Read: admins. Idempotent.
-- =====================================================================
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  function_name text not null,
  model text,
  prompt_tokens integer,
  completion_tokens integer,
  reasoning_tokens integer,
  cached_tokens integer,
  cost_usd numeric(12, 6)
);
create index if not exists ai_usage_at_idx on public.ai_usage (at desc);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from public, anon, authenticated;
grant select on public.ai_usage to authenticated;
drop policy if exists ai_usage_read on public.ai_usage;
create policy ai_usage_read on public.ai_usage for select to authenticated using (banking_can('settings.manage'));
grant insert on public.ai_usage to service_role;
