# Client Login Base

What a client sees in the client portal, and the admin list of clients with their access. It lives in the CRM Supabase project; this folder holds what defines it. The portal code is in `Client Login Module/`.

| Path | Purpose |
|---|---|
| `migrations/001_portal_views.sql` | `client_portal_me` (services, accounts, documents, filing record, requested changes), `client_portal_gallery_path`, `client_portal_admin_clients`, and the `client_portal_change_requests` table |
| `migrations/002_change_requests.sql` | `client_change_submit` (service role) and the staff functions `client_changes_list/assignees/take/assign/release/decide`; a client's edit reaches the record only when staff validate it |
| `tests/run-local.sh` | Builds a throwaway local database, runs the migrations twice, then each test in its own copy of it, and the concurrency script. Exits non-zero on any failed check, aborted test file or failed concurrency script. Nothing touches Supabase |

Run the tests: `bash "Database Module/Client Login Base/tests/run-local.sh"`. It reads the private Banking seed from `PRIVATE_ROOT` (default `/d/Abhijith Projects/CRM/Database Module`).

Rules the functions keep:

- Only the client-portal Edge Function (service role) can call the client functions. The admin list is for admins only.
- Clients never get risk fields, source of funds, turnover, remarks, who received a payment, payment notes, import ids, approvals, commission, staff names or storage paths.
- An IBAN is cut to its last four characters. No account number is returned.
- A case that was imported or is historical and has no payment rows returns no amounts at all, so the client never sees a fee as owed when the payment was simply never recorded here.
- Documents marked sensitive show as held by AB Capital and cannot be opened. Deleted documents never appear.

`client_portal_change_requests` holds a client's request to change one field. Only one request per field can be open. The functions that write to it are in migration 002. Staff with the Clients tab take, hand over, release, validate or reject a request; a value that changed in the CRM after the client asked needs an explicit force to overwrite.

Run after Banking Base and Client Base 001 to 003. Safe to run again.
