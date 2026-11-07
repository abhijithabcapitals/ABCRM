-- Undo Accounting Base 006. DELETES every client request and its sign-in link: links already sent stop working.
-- Redeploy the earlier client-portal function and site straight after, or Generate request and link sign-in fail.
drop function if exists public.accounting_client_request_login(text);
drop function if exists public.accounting_client_request_create(jsonb);
drop function if exists public.accounting_client_request_mailed(uuid, boolean, text);
drop function if exists public.accounting_client_request_end_link(uuid);
drop function if exists public.accounting_client_request_set_received(uuid, boolean, text);
drop function if exists public.accounting_client_request_activity(uuid);
drop function if exists public.client_portal_link_login(text);
drop function if exists public.client_portal_requests(uuid);
drop function if exists public.client_portal_request_shared(uuid, uuid);
drop table if exists public.accounting_client_requests;
