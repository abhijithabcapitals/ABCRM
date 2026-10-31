-- =====================================================================
-- Banking Base - lead pipeline                                     009
-- =====================================================================
-- A lead enters the pipeline when an employee picks it up. It is Converted only when closed: bank
-- selected and a payment received. Excel history stays Converted. Idempotent: safe to re-run.
-- =====================================================================
alter table public.banking_leads add column if not exists picked_up_by uuid references public.profiles(id);
alter table public.banking_leads add column if not exists picked_up_at timestamptz;
create index if not exists banking_leads_picked_idx on public.banking_leads (picked_up_at);

-- Leads already worked on count as picked up.
update public.banking_leads l set picked_up_by = coalesce(l.assigned_to, l.created_by), picked_up_at = coalesce(l.updated_at, l.created_at)
 where l.picked_up_at is null and (l.assigned_to is not null or l.client_id is not null);

-- Leads marked Converted only because a case was opened return to the pipeline.
update public.banking_leads l set status = 'Potential Client', converted_at = null
 where l.status = 'Converted' and not exists (
   select 1 from public.banking_cases c join public.banking_bank_recommendations r on r.case_id = c.id and r.is_selected
    where c.lead_id = l.id and (c.is_historical or (select coalesce(sum(p.signed_amount), 0) from public.banking_payments p where p.case_id = c.id) > 0));

create or replace function public.banking_lead_pick_up(p_lead uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare l banking_leads;
begin
  perform banking_require('leads.manage');
  -- The lock means two people pressing at once cannot both get the lead.
  select * into l from banking_leads where id = p_lead for update;
  if l.id is null then raise exception 'Lead not found'; end if;
  if l.picked_up_at is not null then
    raise exception 'Already picked up by %', coalesce((select full_name from profiles where id = l.picked_up_by), 'another employee');
  end if;
  update banking_leads set picked_up_by = auth.uid(), picked_up_at = now(), assigned_to = auth.uid(),
         status = case when status = 'New' then 'Contacted' else status end
   where id = p_lead;
end $$;

revoke all on function public.banking_lead_pick_up(uuid) from public, anon;
grant execute on function public.banking_lead_pick_up(uuid) to authenticated;
