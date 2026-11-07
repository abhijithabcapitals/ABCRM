-- =====================================================================
-- Client Base - Client Master migration holding area                 009
-- =====================================================================
-- Every client already in the Client Master when this runs is parked as 'migration'. Staff check each one on
-- the Clients page > Migration tab and send it to the active Client Master. Clients created after this run
-- start 'active'. Only 'active' clients appear on the Client Master tab, in Tax Compliance and on the dashboard.
-- Write: kyc.manage, through client_master_set_status only. Run after 002. Idempotent.
-- Rollback: rollback/009_rollback.sql
-- =====================================================================
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'client_master' and column_name = 'status') then
    -- The default fills every existing row with 'migration'; new rows get 'active' from the default set below.
    alter table public.client_master add column status text not null default 'migration';
    alter table public.client_master add constraint client_master_status_check check (status in ('migration', 'active'));
  end if;
end $$;
alter table public.client_master alter column status set default 'active';
create index if not exists client_master_status_idx on public.client_master (status);

-- Moves clients between the Migration tab and the active Client Master. Returns how many changed.
create or replace function public.client_master_set_status(p_ids text[], p_status text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  if not banking_can('kyc.manage') then raise exception 'You do not have permission to change the Client Master'; end if;
  if p_status not in ('migration', 'active') then raise exception 'Unknown status %', p_status; end if;
  if coalesce(cardinality(p_ids), 0) = 0 then return jsonb_build_object('ok', true, 'changed', 0); end if;
  with moved as (
    update client_master set status = p_status, version = version + 1, updated_at = now(), updated_by = auth.uid()
     where client_id = any(p_ids) and status <> p_status
    returning client_id
  ), logged as (
    insert into client_master_history (client_id, action, field, old_value, new_value)
    select client_id, case when p_status = 'active' then 'Moved to active Client Master' else 'Moved back to Migration' end, 'status',
           case when p_status = 'active' then 'migration' else 'active' end, p_status
      from moved
    returning 1
  )
  select count(*) into n from logged;
  return jsonb_build_object('ok', true, 'changed', n);
end $$;

revoke all on function public.client_master_set_status(text[], text) from public, anon;
grant execute on function public.client_master_set_status(text[], text) to authenticated;
