-- Apply after email_signatures.sql.
-- Signatures are shared across the organization: every signed-in CRM user can see
-- and use every signature in the reply composers (Business Development, CEO Inbox).
-- Only the person who created a signature can change or delete it, and each person's
-- "select automatically" default applies only to themselves.
begin;

drop policy if exists email_signatures_own on public.email_signatures;

drop policy if exists email_signatures_read_all on public.email_signatures;
create policy email_signatures_read_all on public.email_signatures for select to authenticated
  using (true);

drop policy if exists email_signatures_insert_own on public.email_signatures;
create policy email_signatures_insert_own on public.email_signatures for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists email_signatures_update_own on public.email_signatures;
create policy email_signatures_update_own on public.email_signatures for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists email_signatures_delete_own on public.email_signatures;
create policy email_signatures_delete_own on public.email_signatures for delete to authenticated
  using (user_id = auth.uid());

commit;
