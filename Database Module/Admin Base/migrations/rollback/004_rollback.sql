-- Stops logins, page opens and clicks being recorded. Entries already made are kept, so the wider action list stays.
do $$ begin perform cron.unschedule('audit-trail-purge'); end $$;
drop trigger if exists audit_trail_session on auth.sessions;
drop function if exists public.audit_trail_session();
drop function if exists public.audit_events(jsonb);
drop function if exists public.audit_trail_purge_old();
