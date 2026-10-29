# BD UI ↔ BD backend mapping (read-only review, 29/10/2026)

**Update (same day):** the recommended route was approved and carried out:
- `003_bd_ui_api.sql` holds the functions;
- the UI data layer now calls them;
- the old UI schema is retired.

Nothing is applied to Supabase yet. The text below is the original review. It maps the BD UI as it exists today to the Database Module design: [BD_API_CONTRACT.md](BD_API_CONTRACT.md) and `migrations/bd/001_bd_schema.sql`.

## Where the UI is

`Business Development Module/` is **empty**. The BD UI was built inside the Main Module (the live CRM). It is uncommitted work in progress from another session:

| File | Role |
|---|---|
| `Main Module/src/components/BusinessDevelopment.jsx` (852 lines), `.css` | The screens and forms |
| `Main Module/src/businessDevelopmentData.js` | Data layer. Calls Supabase directly: table selects plus `rpc(...)` |
| `Main Module/db/business_development.sql` (887 lines) | **Its own BD schema**: 8 tables, RLS, SECURITY DEFINER functions. Not applied |
| `Main Module/src/App.jsx`, `Sidebar.jsx` | A "Business Development" page added to the CRM sidebar |

## The conflict: two BD schemas with the same table names

`Main Module/db/business_development.sql` (the "UI schema") and the Database Module draft (the "spec schema") both create `bd_leads`, `bd_lead_services`, `bd_lead_stage_history` and `bd_user_roles`, **with different columns**. They are mutually exclusive: whichever runs first makes the other fail or half-apply, because `create table if not exists` silently keeps the wrong shape.

| Area | UI schema | Spec schema (Database Module) |
|---|---|---|
| Lead reference | `lead_id` `BD-2026-000001` | `lead_number` `LD-2026-000001` |
| Prospect / contact | `name`, `contact_name`, `mobile` | `prospect_name`, `company_name`, `primary_contact_name`, `mobile_country_code` + `mobile_number` |
| Source / campaign | free text `source`, `campaign_name` | `source_id` → `bd_lead_sources`, `campaign_id` → `bd_campaigns` |
| Stage | text (12 names, e.g. "Proposal / Quotation Preparation") | `stage_id` → `bd_pipeline_stages` (configurable, weights) |
| Status | `active / won / lost / disqualified / on_hold` | `Open / Won / Lost / Disqualified / On Hold` |
| Owners | `acquired_by`, `current_owner`, `closed_by` | `acquired_by_user_id` (immutable), `assigned_to_user_id`, `assigned_team_id`, `closing_user_id` |
| Services | `service_name` text (12 UI options, e.g. "E-Invoicing Services") | `service_id` → `bd_service_catalog` (the 27 Client Module services) |
| Discussions | `bd_lead_activities` | `bd_discussions` |
| Follow-ups | `bd_lead_followups`; stores `due_today` / `overdue` | `bd_followups` (due and overdue computed) + `bd_followup_history` |
| Stage history | `stage, entered_at, exited_at` | `from/to stage + status, duration_seconds` (append-only) |
| Audit | `bd_lead_audit_log` (per lead) | `bd_audit_logs` (any entity, append-only) |
| Handover | `bd_onboarding_handoffs` (unique per lead, never reopenable) | `bd_onboarding_handovers` (one active, idempotency key, completion links `CL…` client) |
| Roles | 8 roles: super_admin, bd_manager, team_leader, sales_executive, marketing_executive, onboarding_executive, management, read_only | 5 roles: BD Executive, BD Manager, Onboarding, Viewer, Admin |
| Not in the UI schema | – | sources, campaigns, stages and lost-reasons masters; service catalog; quotations and items; assignment history; follow-up history; reopen; Mark Won idempotency; immutable `case_opened_at` |
| Not in the spec schema | `duplicate_exception`, hold reason and review date, `confirmation_contact`, `agreement_reference`, `onboarding_queue`, `services_discussed[]` | – |

**Architecture also differs.** The UI talks to Supabase directly (RLS, plus RPC functions for create, won, lost, discussion and follow-up). That matches how the rest of the CRM works. The Database Module contract assumed a separate FastAPI service. For a page hosted on GitHub Pages, the Supabase-RPC route is the one that works without running a server.

## Screen-by-screen mapping

| UI screen / form | UI calls today | Spec table(s) | Contract op | Gap to close when wiring |
|---|---|---|---|---|
| Dashboard (8 metric tiles, pipeline, sources, recent) | `select bd_leads + children` (500 rows, metrics computed in the browser) | leads, services, followups, stages | #18 Dashboard | Metrics are computed client-side from at most 500 rows. They should use a `bd_dashboard()` RPC with the spec §20 definitions. "Weighted Pipeline" needs stage probabilities (D3). |
| Deal Pipeline (stage columns, stage dropdown) | `update bd_leads set stage` | `bd_leads.stage_id` + `bd_lead_stage_history` | #6 Update stage | Needs a `bd_change_stage(lead, stage_code, reason)` RPC, so that the history and its duration are written in one transaction. |
| Lead List (search, source filter) | the same select, filtered in the browser | `bd_leads` | #2 List | Server-side search and paging once there are more than 500 leads. |
| Create Lead form | `rpc bd_create_lead(lead, activity, followup)` | leads + discussions + followups + stage history | #1 Create | Map: `name → prospect_name / company_name`, `source → source_id`, `campaign_name → campaign_id` (or keep the text in `source_detail`), `duplicate_exception → confirm_not_duplicate`. The duplicate check should also cover the Client Master. |
| Lead workspace: Overview | lead row | `bd_leads` | #3 Get | – |
| Services & Budgets / Service form | `insert/update bd_lead_services` directly | `bd_lead_services` → `bd_service_catalog` | #7, #8 | Service names must come from the catalog. 7 UI names have no Client Module equivalent (see D10). |
| Discussion History / Activity form | `rpc bd_log_activity` | `bd_discussions` (+ follow-up) | #9 | Channel values differ ("Phone Call" vs "Call", "Face-to-Face Meeting" vs "Meeting"); map them in the RPC. |
| Follow-ups / Follow-up form / Complete form | `rpc bd_create_followup`, `bd_complete_followup` | `bd_followups` + `bd_followup_history` | #10, #11 | No reschedule or cancel in the UI yet (#11b). |
| Follow-up Center, Lead Calendar | the same select | `bd_followups` | #12 | – |
| Won form | `rpc bd_mark_lead_won(lead, handover)` | leads + handovers | #13 | Add the idempotency key and the `closing_user_id`. Handover completion (#17, linking `CL…`) has no UI yet. |
| Lost form | `rpc bd_mark_lead_lost(lead, reason, notes)` | leads (+ services Rejected) | #14 | Reason names → `bd_lost_reasons` codes. Reopen (#15) has no UI. |
| Campaigns & Sources | static lists | `bd_lead_sources`, `bd_campaigns` | #20 Masters | Campaign records have no UI. |
| Proposals & Quotations | placeholder screen | `bd_quotations`, items | Create quotation | Not built in the UI. |
| Reports & Analytics | computed in the browser | as the Dashboard | #18 | as the Dashboard |
| Settings & Master Data | static lists | masters | #20 | Read-only today. |

## Recommended way to link them

1. Keep the UI's architecture: Supabase, RLS and RPC functions.
2. Make **one** BD migration in `Database Module/migrations/bd`. It would contain the spec schema (complete, as tested) plus an RPC/RLS layer ported from `Main Module/db/business_development.sql`, renamed to the spec tables. **Retire** `Main Module/db/business_development.sql`, so the two can never both be run.
3. Change `businessDevelopmentData.js` only, so that it maps the UI's field names to the spec columns. The JSX barely changes.
4. Add the RPCs the UI still lacks: change stage, dashboard, reopen, complete handover, masters.
5. Test locally on a throwaway Postgres with an `auth` stand-in. Then apply to the CRM Supabase project once the project is confirmed (D2).
