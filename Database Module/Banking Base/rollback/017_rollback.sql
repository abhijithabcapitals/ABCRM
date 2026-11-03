-- Undoes migration 017: restores the saved lead values and the earlier banking_lead_sync.
update public.banking_leads l set status = b.status, converted_at = b.converted_at, picked_up_by = b.picked_up_by, picked_up_at = b.picked_up_at
  from public.banking_lead_pipeline_017_backup b where b.lead_id = l.id;

create or replace function public.banking_lead_sync(p_case uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c banking_cases; v_closed boolean;
begin
  select * into c from banking_cases where id = p_case;
  if c.lead_id is null or c.is_historical then return; end if;
  v_closed := exists (select 1 from banking_bank_recommendations where case_id = p_case and is_selected)
    and (select coalesce(sum(signed_amount), 0) from banking_payments where case_id = p_case) > 0;
  if v_closed then
    update banking_leads set status = 'Converted', converted_at = coalesce(converted_at, now()) where id = c.lead_id and status <> 'Converted';
  else
    update banking_leads set status = 'Potential Client', converted_at = null where id = c.lead_id and status = 'Converted';
  end if;
end $$;
