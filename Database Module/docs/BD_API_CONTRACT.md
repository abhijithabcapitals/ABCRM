# BD backend: API contract (draft v1)

This is the contract the BD Module UI will be linked to. It follows the Client Module's conventions:
- FastAPI on `127.0.0.1` (proposed port **8793**), local access only;
- JSON bodies, `Cache-Control: no-store`, and `embedOrigins`-style CORS for the CRM pages.

Not built yet.

## Conventions

| Item | Rule |
|---|---|
| Base path | `/api/bd/v1` |
| Auth | `Authorization: Bearer <Supabase access token>`. The API resolves the user to `profiles.id` and their `bd_user_roles.bd_role`. Permissions are checked server-side on every call. |
| IDs | UUIDs in paths. Human references (`lead_number`, …) are returned alongside them. |
| Time | Input in ISO 8601 with an offset. Output in UTC (`2026-10-29T07:00:00Z`) plus `*_local` in Asia/Dubai for display. "Today" and "Overdue" use Asia/Dubai. |
| Money | Each amount is returned as `{ "amount": "1500.00", "currency": "AED" }` (the amount is a string, never a float). Totals are grouped by currency. |
| Lists | `?page=1&page_size=25` (max 100), `?sort=-created_at`, `?q=` free-text search. Response: `{ "items": [...], "page": 1, "page_size": 25, "total": 312 }` |
| Writes | `Idempotency-Key` header **required** on Mark Won, Submit Handover and Complete Onboarding; optional elsewhere. A replay returns the first result with `200` and `"replayed": true`. |
| Concurrency | `If-Match: <updated_at>` on updates. A stale value returns `409 stale_record`. |
| Errors | `{ "error": { "code": "validation_failed", "message": "...", "fields": { "discussion_summary": "Too generic" } } }`. The codes: `400 validation_failed` · `401 unauthenticated` · `403 forbidden` · `404 not_found` · `409 duplicate_suspected / invalid_transition / stale_record / already_converted` · `422 rule_violation` · `500 internal` |
| Audit | Every write adds one `bd_audit_logs` row in the same transaction. `request_reference` is the `X-Request-ID` header, generated if it's missing. |

## Roles

| Capability | BD Executive | BD Manager | Onboarding | Viewer | Admin |
|---|---|---|---|---|---|
| Create lead, log discussion, follow-ups | own leads | all | – | – | all |
| View leads | own and team's | all | won leads | all (no commercials unless flagged) | all |
| Assign / reassign | – | ✓ | – | – | ✓ |
| Service budgets and fees, quotations | own leads | ✓ | read | per `can_view_commercials` | ✓ |
| Mark Won / Lost | own leads | ✓ | – | – | ✓ |
| Reopen | – | ✓ (reason required) | – | – | ✓ |
| Accept / complete handover | – | read | ✓ | – | ✓ |
| Masters (sources, stages, campaigns, reasons, catalog) | read | ✓ | read | read | ✓ |
| Export | – | ✓ | – | – | ✓ |

## Endpoints (spec §18)

| # | Operation | Method and path | Body / query (main fields) | Result and rules |
|---|---|---|---|---|
| 1 | Create lead | `POST /leads` | `lead_type, prospect_name, company_name?, primary_contact_name?, mobile_country_code?, mobile_number?, email?, source_code, source_detail?, campaign_id?, referrer_name?, acquired_by_user_id, assigned_to_user_id, assigned_team_id?, priority?, initial_service_interest?, initial_discussion_summary, confirm_not_duplicate?` | `201` lead. Checks the source rules (campaign / referrer) and the summary. The **duplicate check** runs on normalized mobile, email, trade licence, VAT TRN and company name, across open leads **and** the Client Master. A match returns `409 duplicate_suspected` with the matches, unless `confirm_not_duplicate: true` (which is audited). Creates the first stage-history row (`NEW_LEAD`). |
| 2 | List leads | `GET /leads` | `status, stage_code, assigned_to, acquired_by, team_id, source_code, campaign_id, priority, created_from/to, next_followup_before, overdue=true, q` | Paged. Scoped to what the user may see. |
| 3 | Get lead | `GET /leads/{id}` | `?include=services,discussions,followups,stage_history,assignment_history,quotations,handover` | Lead plus the requested parts. Commercials are omitted without permission. |
| 4 | Update lead | `PATCH /leads/{id}` | contact, company and tax fields, `priority`, `hold_until` | It cannot change `status`, `stage_id`, owners, `case_opened_at`, `acquired_by_user_id`, `lead_number` or the conversion fields; those have their own endpoints. |
| 5 | Assign lead | `POST /leads/{id}/assign` | `new_owner_user_id, new_team_id?, reason` | Writes the lead and `bd_lead_assignment_history` in one transaction. Open follow-ups move to the new owner only if `move_open_followups: true`. |
| 6 | Update stage | `POST /leads/{id}/stage` | `to_stage_code, reason?` | Checks the target stage's `required_fields`. `WON_PENDING_ONBOARDING` and `ONBOARDING_COMPLETED` are refused here (`409 invalid_transition`); use 13/16. Writes the stage, the timestamps (`qualified_at`, `proposal_sent_at`) and the history row with `duration_in_previous_stage_seconds`, all in one transaction. |
| 7 | Add service | `POST /leads/{id}/services` | `service_code, scope_description?, quantity?, billing_frequency?, currency_code (default AED), client_budget_amount?, estimated_fee_amount?, expected_start_date?, expected_close_date?` | `201`. The same service can't be open twice on one lead. |
| 8 | Update service budget | `PATCH /leads/{id}/services/{sid}` | `service_status, client_budget_amount, estimated_fee_amount, proposed_fee_amount, final_agreed_fee_amount, discount_amount, billing_frequency, rejection_reason` | `Accepted` needs the final fee and billing frequency (it sets `accepted_at`); `Rejected` sets `rejected_at`. Previous values are kept in the audit log. |
| 9 | Log discussion | `POST /leads/{id}/discussions` | `occurred_at, channel, direction, contact_person?, outcome, requirement_summary, discussion_summary, client_interest_level?, objections?, agreed_next_action?, next_followup_at? \| no_followup_reason, lead_service_id?, external_reference?, attachment_reference?` | Rejects empty or placeholder summaries ("ok", "called", "followed up", repeated text…). Sets `first_contact_at` (first contact-type outcome) and `last_activity_at`. When `next_followup_at` is given, it **creates the follow-up** too, in the same transaction. The API never claims a message was delivered. |
| 10 | Create follow-up | `POST /leads/{id}/followups` | `followup_type, scheduled_at, objective, assigned_to_user_id?, reminder_at?, discussion_id?` | Recomputes `bd_leads.next_followup_at`, the earliest open follow-up. |
| 11 | Complete follow-up | `POST /followups/{fid}/complete` | `outcome, completion_summary, next_action?, next_followup_at?` | Status `Completed`, plus a history row. It creates the next follow-up when one is given, then recomputes the lead's next follow-up and `last_activity_at`. |
| 11b | Reschedule / cancel | `POST /followups/{fid}/reschedule` · `/cancel` | `new_scheduled_at, reason` · `reason` | The original time is kept in `bd_followup_history`. |
| 12 | List follow-ups | `GET /followups` | `assigned_to, team_id, status, due=today\|overdue\|upcoming, from, to, lead_id` | "Due today" and "overdue" are computed in Asia/Dubai, not stored. |
| 13 | Mark won | `POST /leads/{id}/won` (**Idempotency-Key**) | `closing_user_id, won_at?, accepted_service_ids[], handover_notes?, assigned_onboarding_user_id?` | **One transaction:** (1) the lead must be Open or On Hold; (2) at least one accepted service with a final fee and billing frequency; (3) set `status=Won`, `won_at`, `closing_user_id` and stage `WON_PENDING_ONBOARDING`, plus history; (4) get or create the handover. The key and the partial unique index make retries safe, and a repeat returns the same handover. **No client is created here.** |
| 14 | Mark lost | `POST /leads/{id}/lost` | `lost_reason_code, lost_notes?, affected_service_ids[]` | Notes are required when the reason says so. Affected services become `Rejected`. Open follow-ups are cancelled, with history. Stage, ownership and activity history are kept. |
| 15 | Reopen lead | `POST /leads/{id}/reopen` | `reason, to_stage_code` | BD Manager or Admin only. `status=Open`, `lost_*` and `won_*` are cleared on the lead but kept in history and audit, and an active handover is cancelled. `case_opened_at` is unchanged. |
| 16 | Submit handover | `POST /handovers/{hid}/submit` (**Idempotency-Key**) | `handover_notes, missing_items[]` | Sets `handed_over_at` and lead `onboarding_status=Pending`. Builds `source_snapshot`: the lead, accepted services and fees, contacts, and the Client Module prefill. |
| 16b | Accept / block handover | `POST /handovers/{hid}/accept` · `/block` | `assigned_onboarding_user_id` · `reason` | Onboarding role. |
| 17 | Complete onboarding | `POST /handovers/{hid}/complete` (**Idempotency-Key**) | `client_id` (`CL000001`) | The API checks `client_id` exists via the Client Module `GET /api/clients/{id}`, and that the client is not already linked to a different lead (`409 already_converted`). It sets the handover to `Completed`, the lead's `converted_client_id`, `onboarding_status=Completed` and stage `ONBOARDING_COMPLETED`. The client itself is created only in the Client Module onboarding flow, using the prefill. |
| 18 | Dashboard metrics | `GET /dashboard` | `from, to, basis=period\|cohort, team_id?, user_id?, source_code?, campaign_id?` | The definitions are below. Money is grouped by currency. |
| 19 | Export | `GET /export/leads.xlsx` · `.csv` | the same filters as List | BD Manager or Admin. Commercial columns only with permission. Audited (`Export`). |
| 20 | Masters | `GET /masters` · `PUT /masters/{type}/{code}` | the types are `sources, stages, lost_reasons, campaigns, services` | Admin and BD Manager write. Codes are stable; only names, order and active flags change. |
| 21 | Client Module prefill | `GET /handovers/{hid}/client-prefill` | – | Returns a Client Module `record` keyed by its column names. The mapping is in `BD_Field_Mapping.xlsx`, sheet "Client Master Prefill". Values are flagged `(Provided – Verification Required)` where the BD data is unverified. |

## Dashboard definitions (spec §20)

Every metric is labelled `period` (events dated inside `from`–`to`) or `cohort` (leads created inside `from`–`to`, followed to today).

| Metric | Definition | Basis |
|---|---|---|
| Total Leads | non-archived leads in scope | snapshot |
| New Leads | `case_opened_at` in period | period |
| Contacted Leads | leads with ≥1 discussion whose outcome is a contact outcome, in period | period |
| Qualified Leads | `qualified_at` in period | period |
| Open Pipeline Value | sum of `coalesce(proposed, estimated, client_budget)` for services not Accepted or Rejected, on Open leads, **per currency** | snapshot |
| Weighted Pipeline | Open Pipeline Value × the stage's `default_probability`. "Not configured" while probabilities are empty | snapshot |
| Won Value | sum of `final_agreed_fee_amount` of Accepted services on leads with `won_at` in period, per currency. Annualized: Monthly ×12, Quarterly ×4, Annual ×1, One-time ×1, shown separately | period |
| Lost Leads | `lost_at` in period | period |
| Conversion Rate | cohort: won ÷ leads created in the cohort. Closed-basis: won ÷ (won + lost) closed in period. Both are labelled | cohort / period |
| Average First Contact Time | mean(`first_contact_at − case_opened_at`) for leads created in period | cohort |
| Follow-up Compliance | completed on or before `scheduled_at` + 24h ÷ follow-ups due in period (cancelled ones excluded) | period |
| Stage Ageing | now − the latest stage entry (`bd_lead_pipeline_v.stage_age`) | snapshot |
| Onboarding Turnaround | mean(`completed_at − handed_over_at`) for handovers completed in period | period |
