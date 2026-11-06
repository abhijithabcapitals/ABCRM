-- ROLLBACK of Client Login Base migration 005. Then redeploy the earlier client-portal function and revert the site.
--
-- WARNING: this DELETES every record of which client agreed to which terms, and every version of the text. Export both first if any client has agreed.

begin;

drop function if exists public.client_portal_terms_acceptances_for(uuid);
drop function if exists public.client_portal_terms_publish(uuid);
drop function if exists public.client_portal_terms_save_draft(jsonb);
drop function if exists public.client_portal_terms_list();
drop function if exists public.client_portal_terms_accept(uuid, uuid);
drop function if exists public.client_portal_terms_state(uuid);
drop table if exists public.client_portal_terms_acceptances;
drop table if exists public.client_portal_terms;
drop function if exists public.client_portal_terms_acceptance_guard();
drop function if exists public.client_portal_terms_guard();

commit;
