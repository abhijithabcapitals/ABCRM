# Client Base

The CRM's one list of converted clients, across Business Banking, Business Setup and Accounting. It lives in the CRM Supabase project; this folder holds what defines it.

| Path | Purpose |
|---|---|
| `migrations/001_client_base_list.sql` | `client_base_list()`: every converted client with their business lines and key details |

It reads each business line's own records instead of copying them, so the list cannot go out of step. Only Business Banking feeds it today. When Business Setup or Accounting has clients, add them to the `lines` part of the function.

The onboarding interview's Client Master stays in the Client Module (`Client Module/data/client-master.csv`, on the office PC). A client links to it by `client_master_id`.
