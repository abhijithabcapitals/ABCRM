-- Give prospects with saved or sent replies dedicated queue statuses.
begin;

alter table public.bd_platform_prospects
  drop constraint if exists bd_platform_prospects_status_check;

alter table public.bd_platform_prospects
  add constraint bd_platform_prospects_status_check
  check (status in ('new', 'drafted', 'replied', 'added', 'dismissed'));

commit;
