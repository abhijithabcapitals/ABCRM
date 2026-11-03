# Client Login Base

What a client sees in the client portal, and the admin list of clients with their access. It lives in the CRM Supabase project; this folder holds what defines it. The portal code is in `Client Login Module/`.

| Path | Purpose |
|---|---|
| `migrations/001_portal_views.sql` | `client_portal_me` (services, accounts, documents, filing record, requested changes), `client_portal_gallery_path`, `client_portal_admin_clients`, and the `client_portal_change_requests` table |
| `migrations/002_change_requests.sql` | `client_change_submit` (service role) and the staff functions `client_changes_list/assignees/take/assign/release/decide`; a client's edit reaches the record only when staff validate it |
| `rollback/001_002_rollback.sql` | Undoes 001 and 002. **Deletes `client_portal_change_requests`, so clients' pending edits are lost.** Restores `client_portal_me` and `client_portal_admin_clients` from Client Base 003 |
| `tests/run-local.sh` | Builds a throwaway local database (with Admin Base 003, so the audit trail is exercised), runs the migrations twice, then each test in its own copy of it, and the concurrency script. Exits non-zero on any failed check, aborted test file or failed concurrency script. Nothing touches Supabase |

Run the tests: `bash "Database Module/Client Login Base/tests/run-local.sh"`. It reads the private Banking seed from `PRIVATE_ROOT` (default `/d/Abhijith Projects/CRM/Database Module`).

Rules the functions keep:

- Only the client-portal Edge Function (service role) can call the client functions. The admin list is for admins only.
- Clients never get risk fields, source of funds, turnover, remarks, who received a payment, payment notes, import ids, approvals, commission, staff names or storage paths.
- An IBAN is cut to its last four characters. No account number is returned.
- A case that was imported or is historical and has no payment rows returns no amounts at all, so the client never sees a fee as owed when the payment was simply never recorded here.
- Documents marked sensitive show as held by AB Capital and cannot be opened; their title and file name are never returned. Deleted documents never appear.
- A generated document stays hidden while its quotation is Draft or Approval Required or its letter is Draft or Cancelled.
- A licence number another banking client holds cannot be validated onto a client's record.
- An account that lost both client links still appears in the admin list, marked `unlinked`.

`client_portal_change_requests` holds a client's request to change one field. Only one request per field can be open. The functions that write to it are in migration 002. Staff with the Clients tab take, hand over, release, validate or reject a request; a value that changed in the CRM after the client asked needs an explicit force to overwrite.

Run after Banking Base and Client Base 001 to 003. Safe to run again.

## Rollback

`rollback/001_002_rollback.sql` drops the new functions and `client_portal_change_requests`, and puts `client_portal_me` and `client_portal_admin_clients` back exactly as Client Base 003 defines them, with 003's rights. `client_portal_documents` and the other 003 objects are untouched.

**Warning: dropping `client_portal_change_requests` deletes every change a client has asked for and not yet had validated, and the log of decided ones.** Export it first (`select * from public.client_portal_change_requests;`). Edits already applied to the client record stay. `tests/040_rollback.sh` runs the rollback on a database copy and checks that `client_portal_me` returns the old keys only, no new function remains and 003's functions still work.

## Deploy (Task 9 order)

Nothing here has been run against the live project. Do these in order:

1. Apply `migrations/001_portal_views.sql`.
2. Apply `migrations/002_change_requests.sql`.
3. Run `select public.audit_trail_attach_all();` so the new table goes straight into the audit trail.
4. Deploy the Edge Function, then
5. deploy the site.

The function source lives at `Client Login Module/supabase/client-portal/index.ts`, but the Supabase CLI wants `supabase/functions/client-portal/index.ts`. Copy it into a temporary working folder with that layout and deploy from there:

```bash
supabase functions deploy client-portal --no-verify-jwt --project-ref pnnakrhfzyxudjaghoxx --use-api
```

Deploy the function only after 001 and 002 are live (it calls the new functions), and the site only after the function.
