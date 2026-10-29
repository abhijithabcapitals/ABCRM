-- LOCAL TEST ONLY. Never run on Supabase (it already has these).
-- Minimal stand-ins for Supabase's auth schema and API roles so 001-003 can be tested on plain PostgreSQL.
-- A test sets the signed-in user with:  set role authenticated; set request.jwt.claim.sub = '<profile uuid>';

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
