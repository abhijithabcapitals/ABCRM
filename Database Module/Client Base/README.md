# Client Base

The CRM's one list of converted clients, across Business Banking, Business Setup and Accounting. It lives in the CRM Supabase project; this folder holds what defines it.

| Path | Purpose |
|---|---|
| `migrations/001_client_base_list.sql` | `client_base_list()`: every converted client with their business lines and key details |

It reads each business line's own records instead of copying them, so the list cannot go out of step. Only Business Banking feeds it today. When Business Setup or Accounting has clients, add them to the `lines` part of the function.

`migrations/002_client_master.sql` holds the Client Master online: one row per client (`data` = the 134 columns of `Client Module/clientmodule/schema.json`), its append-only history, duplicate checks and the IDs (`CL000001`...), plus `client_lookup()`, which forms use to fill themselves when a client is chosen. Read: `kyc.view`. Write: `kyc.manage`, through `client_master_save` only. A banking client links to it by `client_master_id`.
