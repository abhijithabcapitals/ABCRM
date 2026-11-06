-- Removes Phase 3. Safe to run twice. Runs before rollback/015_018_rollback.sql.
do $$ begin
  if to_regclass('public.business_setup_services') is not null then drop trigger if exists alert_bs_service_events on public.business_setup_services; end if;
  if to_regclass('public.business_setup_service_checkpoints') is not null then drop trigger if exists alert_bs_item_events on public.business_setup_service_checkpoints; end if;
  if to_regclass('public.alerts') is not null then
    if to_regclass('public.notifications') is not null then
      delete from public.notifications where type = 'alert_centre' and (link_scope->>'alert_id')::uuid in (select id from public.alerts where rule_code in
        ('checkpoint_due', 'checkpoint_client', 'checkpoint_authority', 'checkpoint_stale', 'service_expected', 'service_delayed', 'renewal_not_started', 'closure_pending',
         'service_assigned', 'service_completed', 'milestone_reached'));
    end if;
    delete from public.alerts where rule_code in ('checkpoint_due', 'checkpoint_client', 'checkpoint_authority', 'checkpoint_stale', 'service_expected', 'service_delayed',
      'renewal_not_started', 'closure_pending', 'service_assigned', 'service_completed', 'milestone_reached');
  end if;
  if to_regclass('public.alert_rules') is not null then
    delete from public.alert_rules where code in ('checkpoint_due', 'checkpoint_client', 'checkpoint_authority', 'checkpoint_stale', 'service_expected', 'service_delayed',
      'renewal_not_started', 'closure_pending', 'service_assigned', 'service_completed', 'milestone_reached');
  end if;
  if to_regclass('public.alert_settings') is not null then delete from public.alert_settings where key in ('stale_item_days', 'delayed_margin_pct'); end if;
end $$;
drop function if exists public.alert_bs_item_events();
drop function if exists public.alert_bs_service_events();
drop function if exists public.alert_notice(text, text, text, text, uuid, uuid);
drop function if exists public.alert_rule_closure_pending();
drop function if exists public.alert_rule_renewal_not_started();
drop function if exists public.alert_rule_service_delayed();
drop function if exists public.alert_rule_service_expected();
drop function if exists public.alert_rule_checkpoint_stale();
drop function if exists public.alert_rule_checkpoint_authority();
drop function if exists public.alert_rule_checkpoint_client();
drop function if exists public.alert_rule_checkpoint_due();
drop function if exists public.alert_bs_item_candidates(text, text[], boolean);
drop function if exists public.alert_bs_open_service();
drop function if exists public.alert_bs_open_item();
drop table if exists public.alert_special_items;
