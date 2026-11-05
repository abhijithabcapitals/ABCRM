-- =====================================================================
-- HR Base - lets staff open stored files again                     017
-- =====================================================================
-- 014's hr_docs_expense_read read public.hr_requests directly, and signed-in users have no rights on that table.
-- Postgres checks that when it plans the query, so every signed-in read of storage.objects failed, in every bucket:
-- "permission denied for table hr_requests". The check moves into a function that can read the table.
-- Who may see an expense receipt does not change. Run after 014. Idempotent.
-- To undo: recreate the policy as in 014, then drop this function. That brings the failure back.
-- =====================================================================
create or replace function public.hr_is_reimbursement_file(p_name text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from hr_requests q where q.storage_path = p_name and q.kind = 'reimbursement')
$$;
revoke all on function public.hr_is_reimbursement_file(text) from public, anon;
grant execute on function public.hr_is_reimbursement_file(text) to authenticated;

do $do$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage schema not present: skipped';
    return;
  end if;
  drop policy if exists hr_docs_expense_read on storage.objects;
  create policy hr_docs_expense_read on storage.objects for select to authenticated
    using (bucket_id = 'hr-documents' and (public.hr_is_finance() or public.hr_salaries_allowed())
      and public.hr_is_reimbursement_file(name));
end $do$;
