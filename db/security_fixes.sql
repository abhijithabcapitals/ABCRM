-- =====================================================================
-- Security fixes for gaps found in the live database (2026-10-26 audit)
-- =====================================================================
-- NOT YET APPLIED anywhere. Review, test on a copy, then run in the
-- Supabase SQL editor. Idempotent. Each fix is chosen so the current app
-- keeps working (the app never does these things from the browser).
--
-- Check first — which app functions can be called WITHOUT logging in:
--   select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');
-- =====================================================================


-- ── 1. Members can make themselves admin ─────────────────────────────
-- "Update own profile" lets a user update ANY column of their own row,
-- including role → 'admin'. The app never updates profiles from the
-- browser (the admin-users edge function uses the service key), so own-row
-- updates are dropped and only admins may edit profiles.

drop policy if exists "Update own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Admins can update profiles" on public.profiles;
create policy "Admins can update profiles" on public.profiles for update to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));


-- ── 2. Members can grant themselves access to restricted spaces ──────
-- space_access / folder_access are writable by every signed-in user. Only
-- the admin Settings page writes them.

drop policy if exists "Allow authenticated users full access" on public.space_access;
drop policy if exists "space_access read" on public.space_access;
create policy "space_access read" on public.space_access for select to authenticated using (true);
drop policy if exists "space_access admin write" on public.space_access;
create policy "space_access admin write" on public.space_access for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "Allow authenticated users full access" on public.folder_access;
drop policy if exists "folder_access read" on public.folder_access;
create policy "folder_access read" on public.folder_access for select to authenticated using (true);
drop policy if exists "folder_access admin write" on public.folder_access;
create policy "folder_access admin write" on public.folder_access for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));


-- ── 3. Everyone can read every queued automation email ───────────────
-- automation_email_queue (subjects/bodies of emails to other people) and
-- automation_runs are readable by any member. The app never reads them;
-- the engine writes them via SECURITY DEFINER functions.

drop policy if exists "read automation_email_queue" on public.automation_email_queue;
drop policy if exists "admin read automation_email_queue" on public.automation_email_queue;
create policy "admin read automation_email_queue" on public.automation_email_queue for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "read automation_runs" on public.automation_runs;
drop policy if exists "admin read automation_runs" on public.automation_runs;
create policy "admin read automation_runs" on public.automation_runs for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));


-- ── 4. Logged-out visitors can call database functions ───────────────
-- Postgres lets everyone execute new functions by default, and the anon key
-- ships in the website bundle. Several SECURITY DEFINER functions bypass
-- RLS (e.g. reassign_assignee rewrites assignees, ceo_overview returns
-- company-wide numbers). Nothing in the app calls them before login, so
-- take execute away from anon and keep it for signed-in users and servers.

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;

-- Stop new functions defaulting to executable-by-anyone.
alter default privileges in schema public revoke execute on functions from public, anon;


-- ── 5. Members can call the automation engine's internals directly ───
-- The SECURITY DEFINER _abcap_* helpers (set_field, clone_to, run, …)
-- bypass RLS and were callable via /rest/v1/rpc by any signed-in user.
-- They are only ever invoked by triggers and other SECURITY DEFINER
-- functions, which don't need the caller to hold EXECUTE, so the app and
-- automations keep working. Verified on a copy: task history, automation
-- notifications and every app RPC still work as a signed-in user, and a
-- direct _abcap_set_field call is denied.

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like '\_abcap\_%' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;


-- ── NOT changed here (needs a decision) ──────────────────────────────
-- * Most tables carry an "Authenticated users full access" policy, which
--   overrides the admin-only policies next to it (policies are OR-ed). In
--   practice every member can create/edit/delete any task, space, folder,
--   field, status and wiki page. The app currently depends on that (members
--   create and edit tasks), so tightening it means deciding per table what
--   members may do, then changing app code to match.
-- * reassign_assignee, ceo_overview and run_date_based_automations have no
--   admin check inside, so any signed-in member can call them (the app
--   calls the first two, so they can't simply be revoked).
