-- =====================================================================
-- Remove the retired BD UI schema (Main Module/db/business_development.sql)
-- =====================================================================
-- Needed once, on the Supabase project pnnakrhfzyxudjaghoxx: that schema was
-- applied there on 29/10/2026 (migration "business_development") and its
-- tables share names with 001_bd_schema.sql but not columns.
--
-- Safe only while the BD tables are empty: the first statement aborts the
-- whole script if any lead, service, activity, follow-up, history, audit or
-- handover row exists. bd_user_roles rows are recreated by 003 (CRM admins ->
-- super_admin, everyone else -> sales_executive).
-- Run before 001. Touches only public.bd_* objects and the two bd_ triggers
-- on public.profiles.
-- =====================================================================

do $$
declare n bigint := 0; t text;
begin
  foreach t in array array['bd_leads', 'bd_lead_services', 'bd_lead_activities', 'bd_lead_followups',
                           'bd_lead_stage_history', 'bd_lead_audit_log', 'bd_onboarding_handoffs']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into strict n;
      if n > 0 then
        raise exception 'public.% has % row(s); not dropping the retired BD schema. Migrate the data first.', t, n;
      end if;
    end if;
  end loop;
end $$;

drop trigger if exists bd_profiles_role_sync_insert on public.profiles;
drop trigger if exists bd_profiles_role_sync_update on public.profiles;

drop function if exists public.bd_create_lead(jsonb, jsonb, jsonb);
drop function if exists public.bd_mark_lead_won(uuid, jsonb);
drop function if exists public.bd_mark_lead_lost(uuid, text, text);
drop function if exists public.bd_log_activity(jsonb);
drop function if exists public.bd_create_followup(jsonb);
drop function if exists public.bd_complete_followup(uuid, jsonb);

drop table if exists public.bd_onboarding_handoffs, public.bd_lead_audit_log, public.bd_lead_stage_history,
                     public.bd_lead_followups, public.bd_lead_activities, public.bd_lead_services,
                     public.bd_leads, public.bd_user_roles;

drop function if exists public.bd_sync_user_role();
drop function if exists public.bd_assign_lead_id();
drop function if exists public.bd_record_lead_changes();
drop function if exists public.bd_record_lead_creation();
drop function if exists public.bd_validate_lead_transition();
drop function if exists public.bd_audit_service_change();
drop function if exists public.bd_can_view_lead(uuid);
drop function if exists public.bd_can_edit_lead(uuid);
drop function if exists public.bd_current_role(uuid);

drop sequence if exists public.bd_lead_number_seq;   -- recreated by 001 (no leads were ever numbered)
