-- Removes the Regulatory Updates Centre. Safe to run twice. Runs before rollback/006_009_rollback.sql.
drop trigger if exists regulatory_track_completion on public.alerts;
do $$ begin
  if to_regclass('public.alerts') is not null then
    if to_regclass('public.notifications') is not null then
      delete from public.notifications where type = 'alert_centre'
        and (link_scope->>'alert_id')::uuid in (select id from public.alerts where rule_code like 'regulatory\_%');
    end if;
    delete from public.alerts where rule_code like 'regulatory\_%';
    alter table public.alerts drop column if exists regulatory_update_id;
  end if;
  if to_regclass('public.alert_rules') is not null then
    delete from public.alert_rules where code like 'regulatory\_%';
  end if;
end $$;
drop function if exists public.regulatory_detail(uuid);
drop function if exists public.regulatory_list(text, int, int);
drop function if exists public.regulatory_track_completion();
drop function if exists public.regulatory_create_tasks(uuid);
drop function if exists public.regulatory_verify(uuid);
drop function if exists public.regulatory_decide_client(uuid, text, text);
drop function if exists public.regulatory_propose_list(uuid);
drop function if exists public.regulatory_start_review(uuid);
drop function if exists public.regulatory_update_intake(jsonb);
drop function if exists public.regulatory_update_save(jsonb);
drop function if exists public.regulatory_insert(jsonb, text);
drop function if exists public.regulatory_require_manage();
drop function if exists public.regulatory_can_manage();
drop table if exists public.regulatory_update_clients;
drop table if exists public.regulatory_updates;
drop sequence if exists public.regulatory_number_seq;
