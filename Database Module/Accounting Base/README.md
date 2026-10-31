# Accounting Base

Database for the `Accounting Module`, in the CRM Supabase project. This folder holds what defines it.

| Path | Purpose |
|---|---|
| `migrations/001_banking_validation.sql` | `accounting_case_reviews` (every send, validation and revert, append-only), the ACCOUNTS role, and the handover functions |

Run it after `Banking Base/migrations/011`. Banking Base holds the case itself, including its status and the lock.
