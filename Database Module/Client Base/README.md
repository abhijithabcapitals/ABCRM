# Client Base

The CRM's one list of converted clients, across Business Banking, Business Setup and Accounting. It lives in the CRM Supabase project; this folder holds what defines it.

| Path | Purpose |
|---|---|
| `migrations/001_client_base_list.sql` | `client_base_list()`: every converted client with their business lines and key details |

It reads each business line's own records instead of copying them, so the list cannot go out of step. Only Business Banking feeds it today. When Business Setup or Accounting has clients, add them to the `lines` part of the function.

`migrations/002_client_master.sql` holds the Client Master online: one row per client (`data` = the 134 columns of `Client Module/clientmodule/schema.json`), its append-only history, duplicate checks and the IDs (`CL000001`...), plus `client_lookup()`, which forms use to fill themselves when a client is chosen. Read: `kyc.view`. Write: `kyc.manage`, through `client_master_save` only. A banking client links to it by `client_master_id`.

`migrations/003_client_portal.sql` holds the Client Portal: client logins, sessions, uploaded documents and the Client Inputs review. See `Client Module/README.md`.

Two migrations share the number 005 and are already applied live, so they keep their names. Never re-run either one: each replaces `client_base_list()` with only its own line. `005_bookkeeping_line.sql` and `005_business_setup_line.sql` were each written on top of 004; `006_client_lines.sql` merges both and is the current definition. On a new project, run `004`, either `005` file, then `006`. Give new migrations a unique number and add new lines to `006` or a later file.
