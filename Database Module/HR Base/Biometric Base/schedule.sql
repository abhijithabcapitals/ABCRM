-- Schedules hr-biometric-sync every 15 minutes. Run once on live, after migration 009 and after the Edge Function is deployed.
-- Not a numbered migration because it needs pg_cron, pg_net and Vault, which the local test database does not have. Idempotent.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'crm_cred:HR_BIOMETRIC_SYNC_SECRET') then
    perform vault.create_secret(gen_random_uuid()::text || gen_random_uuid()::text, 'crm_cred:HR_BIOMETRIC_SYNC_SECRET');
  end if;
end $$;

-- The Edge Function checks the scheduler's header here, so the value never leaves the database for the function.
create or replace function public.hr_biometric_secret_ok(p_secret text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'crm_cred:HR_BIOMETRIC_SYNC_SECRET' and decrypted_secret = p_secret)
$$;
revoke all on function public.hr_biometric_secret_ok(text) from public, anon, authenticated;
grant execute on function public.hr_biometric_secret_ok(text) to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'hr-biometric-sync';

select cron.schedule(
  'hr-biometric-sync',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://pnnakrhfzyxudjaghoxx.supabase.co/functions/v1/hr-biometric-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'crm_cred:HR_BIOMETRIC_SYNC_SECRET')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 90000
  );
  $$
);
