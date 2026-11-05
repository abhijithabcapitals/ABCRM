-- CRM Agent on OpenRouter (migration 016). Stops at the first failure.
\set ON_ERROR_STOP on
do $$
begin
  if not exists (select 1 from public.agents where id = 'AGT-14-CRM' and name = 'CRM Agent' and provider = 'openrouter' and model = 'deepseek/deepseek-v4.1-flash' and runtime = 'gateway' and role like 'Answers questions from the CRM data%') then
    raise exception 'FAILED: agent not moved to OpenRouter';
  end if;
  raise notice 'ok agent uses OpenRouter and its settings';
end $$;
