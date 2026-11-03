-- =====================================================================
-- Banking Base - old CRM Pending deals in the lead pipeline        017
-- =====================================================================
-- The import marked every lead Converted. A deal still Pending on the old CRM board is open work, so its
-- lead returns to In Pipeline, and becomes Converted on a real payment like any other lead. Old values are
-- kept in banking_lead_pipeline_017_backup (rollback/017_rollback.sql). Safe to re-run: a lead that has a
-- payment since, or was marked Lost, is left alone.
-- =====================================================================
create table if not exists public.banking_lead_pipeline_017_backup (
  lead_id uuid primary key, status text, converted_at timestamptz, picked_up_by uuid, picked_up_at timestamptz, updated_at timestamptz, updated_by uuid,
  saved_at timestamptz not null default now()
);
alter table public.banking_lead_pipeline_017_backup enable row level security;
revoke all on public.banking_lead_pipeline_017_backup from anon, authenticated;

insert into public.banking_lead_pipeline_017_backup (lead_id, status, converted_at, picked_up_by, picked_up_at, updated_at, updated_by)
select l.id, l.status, l.converted_at, l.picked_up_by, l.picked_up_at, l.updated_at, l.updated_by
  from public.banking_leads l join public.banking_cases c on c.lead_id = l.id
 where c.legacy_board_status = 'Pending' and l.status = 'Converted'
   and coalesce((select sum(p.signed_amount) from public.banking_payments p where p.case_id = c.id), 0) <= 0
on conflict (lead_id) do nothing;

update public.banking_leads l set status = 'Potential Client', converted_at = null, picked_up_at = coalesce(l.picked_up_at, now())
  from public.banking_cases c
 where c.lead_id = l.id and c.legacy_board_status = 'Pending' and l.status = 'Converted'
   and coalesce((select sum(p.signed_amount) from public.banking_payments p where p.case_id = c.id), 0) <= 0;

-- Imported history stays out of the lead rules, except a deal still Pending on the old board.
create or replace function public.banking_lead_sync(p_case uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c banking_cases; v_closed boolean;
begin
  select * into c from banking_cases where id = p_case;
  if c.lead_id is null or (c.is_historical and c.legacy_board_status is distinct from 'Pending') then return; end if;
  v_closed := exists (select 1 from banking_bank_recommendations where case_id = p_case and is_selected)
    and (select coalesce(sum(signed_amount), 0) from banking_payments where case_id = p_case) > 0;
  if v_closed then
    update banking_leads set status = 'Converted', converted_at = coalesce(converted_at, now()) where id = c.lead_id and status <> 'Converted';
  else
    update banking_leads set status = 'Potential Client', converted_at = null where id = c.lead_id and status = 'Converted';
  end if;
end $$;
