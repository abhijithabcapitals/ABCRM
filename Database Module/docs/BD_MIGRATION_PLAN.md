# BD backend: migration plan

**Status:** draft. Nothing has been applied to any CRM database. The scripts were tested only on a throwaway local PostgreSQL 17 cluster, which has since been stopped:
- `001_bd_schema.sql` and `002_bd_seed.sql` apply cleanly, and running them a second time changes nothing;
- 12 rule checks behave as specified (results below).

Spec: [BD_BACKEND_SPEC.md](BD_BACKEND_SPEC.md) · ER diagram: [BD_ER_DIAGRAM.md](BD_ER_DIAGRAM.md) · API: [BD_API_CONTRACT.md](BD_API_CONTRACT.md) · Field mapping: `SQL Data/BD_Field_Mapping.xlsx`

## 1. What already exists (inspected 29/10/2026)

| Entity the spec wants reused | What the CRM has | Decision |
|---|---|---|
| Users / employees | `public.profiles` (id = `auth.users.id`, `full_name`, `email`, `role` = `admin`/`member`) in the live CRM Supabase project (`Main Module/db/00_base_schema.sql`) | **Reuse.** Every user FK points to `profiles(id)`. A local database gets a stand-in `profiles` with the same columns. |
| Teams / reporting lines | None | **Create** `crm_teams` and `crm_team_members`. These are general CRM tables, not BD-only. |
| Roles and permissions | Only `profiles.role` (admin/member) | **Create** `bd_user_roles` (BD Executive, BD Manager, Onboarding, Viewer, Admin; plus a flag for viewing commercials). The CRM admin role stays the override. |
| Client Master | Client Module `data/client-master.csv`: one row per client, IDs `CL000001…` (text) | **Link, don't copy.** `converted_client_id` holds the Client ID, checked against the `CL` format. Clients are created only through the Client Module (`POST /api/save`). |
| Service catalog | None. Services exist only as the Client Module "Services Provided" options plus `config.json` `serviceFolders` | **Create** `bd_service_catalog`, seeded with the same 27 names and folders, so a won service maps 1:1 to the Client Master. |
| Quotations | `quotation_templates` (freezone .docx templates) and generated documents filed as CRM tasks. No quotation records | **Create** `bd_quotations` and `bd_quotation_items`. Each quotation keeps the template it was produced from (`quotation_template_id`). |
| Notifications | `public.notifications` (user_id, title, body, link_scope) | **Reuse** for due and overdue follow-up reminders, through the API. No new table. |
| Documents | Document Module pipeline and the DataBase folders | **Reuse.** Discussions store only `attachment_reference`, a secure file reference and never a public URL. |
| Currency / FX | Only `quotation_templates.usd_rate` | **Not created.** Every amount carries its own currency, and reports never add different currencies together. An FX table is added only if converted reporting is agreed. |
| Audit | `task_history`, `automation_runs` (task-specific) | **Create** `bd_audit_logs` (append-only). |
| Agent Module `bizdev` schema | `Agent Module/00_Shared_Standards` describes a **SQL Server** design (`bizdev` schema, `uniqueidentifier`, `datetime2`). It has never been deployed | **Not followed.** The spec's types (UUID, TIMESTAMPTZ, JSON) and the live CRM are PostgreSQL. See decision D1. |

## 2. Objects created

| Script | Creates |
|---|---|
| `001_bd_schema.sql` | **The 13 spec tables:** `bd_leads`, `bd_lead_sources`, `bd_campaigns`, `bd_pipeline_stages`, `bd_lead_services`, `bd_discussions`, `bd_followups`, `bd_lead_stage_history`, `bd_lead_assignment_history`, `bd_quotations`, `bd_onboarding_handovers`, `bd_lost_reasons`, `bd_audit_logs` |
| | **Spec-sanctioned extras:** `bd_quotation_items`, `bd_service_catalog`, `bd_followup_history` (keeps the original date of a rescheduled follow-up) |
| | **Supporting tables:** `crm_teams`, `crm_team_members`, `bd_user_roles`, and the `profiles` stand-in (local only) |
| | **Reference sequences:** `LD-YYYY-000001`, `QT-…`, `HO-…` |
| | **Guard triggers, the view `bd_lead_pipeline_v`** (stage ageing and progress) **and the spec §19 indexes** |
| `002_bd_seed.sql` | 16 lead sources, 12 pipeline stages, 9 lost reasons and 27 catalog services. Upserts by code. |

## 3. Rules enforced in the database (and tested)

| # | Rule | Mechanism | Test |
|---|---|---|---|
| 1 | `case_opened_at` never changes | trigger `bd_leads_guard` | rejected |
| 2 | `acquired_by_user_id` keeps the original attribution; reassignment changes only `assigned_to_user_id` | trigger. An admin correction needs `SET LOCAL bd.allow_attribution_change = 'on'` and is audited | change rejected, reassignment ok |
| 3 | Won needs `won_at` and the closing employee; Lost needs `lost_at` and a reason; On Hold needs `hold_until` | CHECK | rejected |
| 4 | A discussion needs a real summary and either a next follow-up or a reason for none | CHECK | rejected |
| 5 | Only one handover that isn't cancelled per lead; Mark Won retries carry an idempotency key | partial unique index + unique `idempotency_key` | second handover rejected |
| 6 | History and audit tables are append-only | trigger | delete rejected |
| 7 | A sent quotation is frozen; changes require a new version (`version_no`, `supersedes_quotation_id`) | trigger | edit rejected |
| 8 | Quotation total = subtotal − discount + tax; line total = qty × price − discount | CHECK | wrong total rejected |
| 9 | Client links use the `CL000001` format | CHECK | `12345` rejected |
| 10 | The same service can't be open twice on one lead | partial unique index | – |
| 11 | Money is `NUMERIC(18,2)` with an ISO currency; campaign money needs a currency | types + CHECK | – |
| 12 | No blanket unique constraint on mobile or email | normalized columns with plain indexes, used for duplicate warnings | – |

The API enforces the rest: stage `required_fields`, generic-placeholder detection, permissions, and source rules (`requires_campaign` / `requires_referrer`). These need the context of the request.

## 4. Decisions needed before applying (your call)

| # | Question | Recommendation |
|---|---|---|
| D1 | **Engine:** PostgreSQL, as in the spec and the live CRM, or SQL Server, as in the Agent Module standards? | **PostgreSQL.** |
| D2 | **Where it runs first.** Option (a): a new, separate local PostgreSQL cluster in `Database Module/SQL Data/pgdata`, on port 5433, database `crm`. It would reuse the portable PG17 binaries but **not** the accounting server on 5432. Option (b): straight into the CRM's Supabase project. | **(a)** for development, then deploy to Supabase when the BD UI is linked. Note: `Main Module/.env` currently points at `pnnakrhfzyxudjaghoxx`, the same Supabase project as the accounting `acct` schema, while `.env.live-backup` points at `kokyhqbsdftyyjirzzvs`. Confirm which project is the live CRM before any Supabase step. |
| D3 | Stage `progress_weight` is seeded evenly (8.33 … 100); `default_probability` is left empty. | Give the forecast probability per stage. Weighted pipeline shows "not configured" until you do. |
| D4 | Lead numbers look like `LD-2026-000001`. The sequence continues across years; it does not restart at 1 each year. | Keep, or choose another prefix or format. |
| D5 | Catalog default billing frequencies (e.g. VAT Return Filing = Quarterly) are placeholders. | Review them in `002_bd_seed.sql`. |
| D6 | Reporting basis for recurring revenue: monthly equivalent, annualized contract value, or booked. | Annualized contract value for Won Value, with monthly equivalent shown separately. Never mixed. |

## 5. Rollout steps (after D1–D6)

1. Create the local CRM cluster (D2a) and a `crm` database. Apply `001`, then `002`.
2. Build the BD API (`bdapi/`, FastAPI on `127.0.0.1:8793`, like the Client Module on 8792) to the contract.
3. Write the tests: unit tests per rule, plus one end-to-end run from lead to won to handover to onboarding complete against a temporary database.
4. Link the BD Module UI to the API.
5. Supabase deployment, separately approved:
   - run the same scripts in the live CRM project, skipping the `profiles` stand-in, which already exists there;
   - add the `quotation_template_id` FK to `public.quotation_templates`;
   - add RLS policies mirroring `bd_user_roles`.

## 6. Backup, rollback and recovery

- **Before every apply:** `pg_dump -Fc crm > SQL Data/backups/crm-YYYYMMDD-HHMM.dump`.
- **Rollback while there's no real data:** run `migrations/bd/900_bd_drop.sql`, which drops every `bd_*` object. It isn't written yet, because it's needed only once the scripts are applied. `crm_teams` and the stand-in `profiles` are left in place unless they're asked for too.
- **Rollback once real data exists:** restore the dump. Never drop history tables in place.
- **Forward changes:** add new numbered files (`003_…`). Applied files are never edited.
