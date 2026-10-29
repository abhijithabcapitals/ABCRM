# AB CAPITAL SERVICES CRM
# BUSINESS DEVELOPMENT MODULE — BACKEND REQUIREMENT SPECIFICATION

**Document purpose:** Database design, API integration, backend development, reporting, and quality assurance.

**Module:** Business Development (BD)

**System of record:** Existing CRM Client Master

**Primary objective:** Track a prospect from acquisition through sales closure and controlled client onboarding, preserving all communications, budgets, ownership changes, and conversion history.

---

## 1. Database Design Principles

1. Use the existing CRM database and authentication architecture wherever practical.
2. Use UUID primary keys, or the existing project's standard primary-key strategy.
3. Maintain separate internal database IDs and human-readable reference numbers.
4. Use foreign keys and appropriate indexes.
5. Store timestamps in UTC and render them in the configured application timezone, defaulting to Asia/Dubai.
6. Use decimal types for monetary amounts, never floating-point types.
7. Keep source attribution, employee attribution, current assignment, and closing responsibility separate.
8. Store repeated services, discussions, follow-ups, and stage transitions in separate tables.
9. Apply server-side validation, role-based authorization, audit logging, and transactional conversion.
10. Use soft deletion or archival where appropriate. Preserve historical records and legal or operational retention requirements.
11. Do not duplicate the full Client Master inside the BD module. Use a foreign key to the existing client record after conversion.
12. Do not store passwords, access tokens, or unnecessary sensitive KYC data in lead records.

## 2. Table 1 — bd_leads (Lead Master)

One record per prospect/opportunity.

| Field | Database type | Requirement |
|---|---|---|
| id | UUID | Primary key |
| lead_number | VARCHAR(30) | Unique, human-readable Lead ID |
| lead_type | ENUM / VARCHAR | Company / Individual |
| prospect_name | VARCHAR(255) | Required |
| company_name | VARCHAR(255) | Nullable for individuals |
| primary_contact_name | VARCHAR(255) | Nullable where not applicable |
| designation | VARCHAR(150) | Optional |
| mobile_country_code | VARCHAR(8) | Optional |
| mobile_number | VARCHAR(30) | Normalize for duplicate checks |
| whatsapp_number | VARCHAR(30) | Optional |
| email | VARCHAR(255) | Optional; normalize for duplicate checks |
| website | VARCHAR(255) | Optional |
| country | VARCHAR(100) | Optional |
| emirate | VARCHAR(100) | Optional |
| trade_licence_number | VARCHAR(100) | Optional |
| trade_licence_expiry_date | DATE | Optional |
| entity_type | VARCHAR(100) | Optional |
| vat_trn | VARCHAR(50) | Optional |
| corporate_tax_status | VARCHAR(50) | Optional |
| source_id | UUID | FK to bd_lead_sources |
| source_detail | VARCHAR(255) | Campaign, ad, referral, etc. |
| campaign_id | UUID | FK to bd_campaigns, nullable |
| referrer_name | VARCHAR(255) | Optional |
| external_source_reference | VARCHAR(255) | Optional external platform ID |
| acquired_by_user_id | UUID | FK to CRM users; original attribution |
| assigned_to_user_id | UUID | FK to CRM users; current owner |
| assigned_team_id | UUID | FK to CRM teams, if available |
| closing_user_id | UUID | FK to CRM users; nullable until assigned/closed |
| stage_id | UUID | FK to bd_pipeline_stages |
| status | VARCHAR(30) | Open / Won / Lost / Disqualified / On Hold |
| priority | VARCHAR(20) | Low / Normal / High / Urgent |
| initial_service_interest | TEXT or JSON | Optional quick-capture snapshot |
| initial_discussion_summary | TEXT | Required at lead creation under agreed policy |
| case_opened_at | TIMESTAMPTZ | Immutable initial creation timestamp |
| first_contact_at | TIMESTAMPTZ | First actual contact attempt |
| last_activity_at | TIMESTAMPTZ | Latest qualifying activity |
| next_followup_at | TIMESTAMPTZ | Derived from next scheduled follow-up |
| qualified_at | TIMESTAMPTZ | Nullable |
| proposal_sent_at | TIMESTAMPTZ | Nullable |
| won_at | TIMESTAMPTZ | Nullable |
| lost_at | TIMESTAMPTZ | Nullable |
| hold_until | TIMESTAMPTZ | Nullable |
| lost_reason_id | UUID | FK to bd_lost_reasons |
| lost_notes | TEXT | Required when applicable |
| converted_client_id | UUID | FK to existing Client Master; nullable |
| onboarding_status | VARCHAR(30) | Not Started / Pending / In Progress / Completed / Blocked |
| onboarding_handover_id | UUID | FK to onboarding handover record, nullable |
| created_by | UUID | FK to CRM users |
| created_at | TIMESTAMPTZ | Required |
| updated_by | UUID | FK to CRM users |
| updated_at | TIMESTAMPTZ | Required |
| archived_at | TIMESTAMPTZ | Nullable |

**Rules**

- `lead_number` must be unique.
- `case_opened_at` must not change when a lead is reassigned or reopened.
- `acquired_by_user_id` must retain the original attribution.
- Reassignment changes `assigned_to_user_id`, not the acquisition owner.
- `converted_client_id` must reference the actual existing client record.
- `last_activity_at` and `next_followup_at` should be maintained consistently by the backend.
- Keep a separate history for status and stage changes.

## 3. Table 2 — bd_lead_sources

Configurable lead source master.

| Field | Type | Requirement |
|---|---|---|
| id | UUID | Primary key |
| source_code | VARCHAR(50) | Unique stable code |
| source_name | VARCHAR(100) | Display name |
| source_category | VARCHAR(50) | Paid / Organic / Referral / Direct / Other |
| requires_campaign | BOOLEAN | Conditional campaign requirement |
| requires_referrer | BOOLEAN | Conditional referral requirement |
| is_active | BOOLEAN | Enables/disables source |
| sort_order | INTEGER | Display order |
| created_at | TIMESTAMPTZ | Audit timestamp |
| updated_at | TIMESTAMPTZ | Audit timestamp |

Initial source records: COLD_CALL, WHATSAPP, META_ADS, GOOGLE_ADS, INSTAGRAM, DIRECT, CAMPAIGN, THIRD_PARTY, EMPLOYEE_REFERRAL, CLIENT_REFERRAL, WEBSITE, LINKEDIN, EMAIL, NETWORKING, WALK_IN, OTHER

Maintain the original source separately from subsequent contact channels. A lead originating from Meta Ads remains attributed to Meta Ads even if all later discussions happen over WhatsApp.

## 4. Table 3 — bd_campaigns

Marketing campaign attribution.

| Field | Type | Requirement |
|---|---|---|
| id | UUID | Primary key |
| campaign_code | VARCHAR(50) | Unique reference |
| campaign_name | VARCHAR(255) | Required |
| channel | VARCHAR(50) | Meta / Google / Instagram / Other |
| external_campaign_id | VARCHAR(255) | Optional platform ID |
| campaign_owner_user_id | UUID | FK to CRM users |
| start_date | DATE | Optional |
| end_date | DATE | Optional |
| budget_amount | DECIMAL(18,2) | Optional |
| currency_code | CHAR(3) | Required when budget entered |
| actual_spend | DECIMAL(18,2) | Optional |
| campaign_status | VARCHAR(30) | Planned / Active / Paused / Completed |
| utm_source | VARCHAR(255) | Optional |
| utm_medium | VARCHAR(255) | Optional |
| utm_campaign | VARCHAR(255) | Optional |
| created_at | TIMESTAMPTZ | Required |
| updated_at | TIMESTAMPTZ | Required |

Do not calculate campaign ROI unless actual campaign costs and an agreed revenue attribution model are available.

## 5. Table 4 — bd_pipeline_stages

Configurable pipeline definitions.

| Field | Type | Requirement |
|---|---|---|
| id | UUID | Primary key |
| stage_code | VARCHAR(50) | Unique stable code |
| stage_name | VARCHAR(100) | Display name |
| stage_order | INTEGER | Sequence |
| progress_weight | DECIMAL(5,2) | Optional operational progress weight |
| default_probability | DECIMAL(5,2) | Optional forecast probability |
| is_terminal | BOOLEAN | Indicates terminal stage |
| is_active | BOOLEAN | Configuration status |
| required_fields | JSON | Configurable transition requirements |
| created_at | TIMESTAMPTZ | Required |
| updated_at | TIMESTAMPTZ | Required |

Initial stages: NEW_LEAD, CONTACT_PENDING, FIRST_CONTACT_ATTEMPTED, CONTACT_ESTABLISHED, REQUIREMENT_IDENTIFIED, QUALIFIED, PROPOSAL_PREPARATION, PROPOSAL_SENT, NEGOTIATION, VERBAL_CONFIRMATION, WON_PENDING_ONBOARDING, ONBOARDING_COMPLETED

Lost, Disqualified, and On Hold should be represented as overall lead statuses or clearly defined exceptional workflow states, not incorrectly counted as normal forward stages.

Store actual stage history separately. Progress percentages must derive from configured stage weights, not user-entered percentages.

## 6. Table 5 — bd_lead_services

One record per service opportunity attached to a lead.

| Field | Type | Requirement |
|---|---|---|
| id | UUID | Primary key |
| lead_id | UUID | FK to bd_leads |
| service_id | UUID | FK to service master |
| service_status | VARCHAR(30) | Identifying / Interested / Quoted / Negotiating / Accepted / Rejected / On Hold |
| scope_description | TEXT | Service-specific requirements |
| quantity | DECIMAL(12,2) | Optional |
| billing_frequency | VARCHAR(30) | One-time / Monthly / Quarterly / Annual / Other |
| currency_code | CHAR(3) | ISO currency code |
| client_budget_amount | DECIMAL(18,2) | Nullable |
| estimated_fee_amount | DECIMAL(18,2) | Nullable |
| proposed_fee_amount | DECIMAL(18,2) | Nullable |
| final_agreed_fee_amount | DECIMAL(18,2) | Nullable |
| discount_amount | DECIMAL(18,2) | Nullable |
| quotation_id | UUID | FK to quotation, nullable |
| expected_start_date | DATE | Optional |
| expected_close_date | DATE | Optional |
| accepted_at | TIMESTAMPTZ | Nullable |
| rejected_at | TIMESTAMPTZ | Nullable |
| rejection_reason | TEXT | Nullable |
| notes | TEXT | Optional |
| created_by | UUID | FK to CRM users |
| created_at | TIMESTAMPTZ | Required |
| updated_at | TIMESTAMPTZ | Required |

Do not hardcode service names in the database schema. Use the existing service master where available; otherwise create a configurable `bd_service_catalog`.

**Financial rules**

- Use decimal values and explicit currency codes.
- Do not add AED, USD, or other currencies together without a defined exchange rate and conversion timestamp.
- Distinguish potential value, quoted value, and accepted value.
- Count accepted services once in the Won total.
- Preserve the agreed fee and billing frequency at the point of closing.
- Define whether recurring revenue reports represent monthly equivalent, annualized contract value, or actual booked revenue. Never mix these measures.

## 7. Table 6 — bd_discussions

One record for each meaningful interaction.

| Field | Type | Requirement |
|---|---|---|
| id | UUID | Primary key |
| lead_id | UUID | FK to bd_leads |
| lead_service_id | UUID | FK to bd_lead_services, nullable |
| occurred_at | TIMESTAMPTZ | Required |
| channel | VARCHAR(30) | Call / WhatsApp / Email / Meeting / Social / Other |
| direction | VARCHAR(20) | Inbound / Outbound / Internal |
| contact_person | VARCHAR(255) | Optional where applicable |
| outcome | VARCHAR(100) | Contacted / No Answer / Interested / etc. |
| requirement_summary | TEXT | Required |
| discussion_summary | TEXT | Required |
| client_interest_level | VARCHAR(30) | Optional |
| objections | TEXT | Optional |
| agreed_next_action | TEXT | Required for actionable discussions |
| next_followup_at | TIMESTAMPTZ | Nullable under documented exception |
| no_followup_reason | TEXT | Required when no follow-up is needed |
| external_reference | VARCHAR(255) | Optional communication ID |
| attachment_reference | TEXT | Optional approved attachment reference |
| recorded_by | UUID | FK to CRM users |
| created_at | TIMESTAMPTZ | Required |
| updated_at | TIMESTAMPTZ | Required |

Every meaningful discussion must have a meaningful narrative summary.

Avoid arbitrary word-count validation alone. Validate required fields and reject empty or generic placeholder summaries through reasonable application-level rules.

Do not claim that a call, WhatsApp message, or email was delivered unless an authorized integration confirms that event.

## 8. Table 7 — bd_followups

One record per planned follow-up or scheduled action.

| Field | Type | Requirement |
|---|---|---|
| id | UUID | Primary key |
| lead_id | UUID | FK to bd_leads |
| lead_service_id | UUID | FK to bd_lead_services, nullable |
| discussion_id | UUID | FK to bd_discussions, nullable |
| assigned_to_user_id | UUID | Responsible employee |
| followup_type | VARCHAR(30) | Call / WhatsApp / Email / Meeting / Other |
| scheduled_at | TIMESTAMPTZ | Required |
| objective | TEXT | Required |
| status | VARCHAR(30) | Scheduled / Completed / Rescheduled / Cancelled |
| completed_at | TIMESTAMPTZ | Nullable |
| outcome | VARCHAR(100) | Nullable until completed |
| completion_summary | TEXT | Required on completion |
| next_action | TEXT | Optional |
| next_followup_at | TIMESTAMPTZ | Optional |
| reminder_at | TIMESTAMPTZ | Optional |
| escalation_level | INTEGER | Default 0 |
| created_by | UUID | FK to CRM users |
| created_at | TIMESTAMPTZ | Required |
| updated_at | TIMESTAMPTZ | Required |

Due Today and Overdue should be calculated using the current time in the application timezone. They do not need to be permanently stored as statuses.

If a follow-up is rescheduled, preserve the original scheduled date in an audit/history record.

Create indexes on `lead_id`, `assigned_to_user_id`, `scheduled_at`, and `status`.

## 9. Table 8 — bd_lead_stage_history

Immutable history of stage transitions.

| Field | Type | Requirement |
|---|---|---|
| id | UUID | Primary key |
| lead_id | UUID | FK to bd_leads |
| from_stage_id | UUID | Previous stage, nullable on creation |
| to_stage_id | UUID | New stage |
| changed_by_user_id | UUID | FK to CRM users |
| changed_at | TIMESTAMPTZ | Required |
| reason | TEXT | Optional or mandatory by rule |
| duration_in_previous_stage_seconds | BIGINT | Calculated by backend |
| transition_metadata | JSON | Optional snapshot of transition context |

Use this table to calculate stage ageing, time in pipeline, conversion rates, and progress-bar dates.

Do not overwrite previous stage history when a lead is reopened.

## 10. Table 9 — bd_lead_assignment_history

Records ownership and team changes.

| Field | Type | Requirement |
|---|---|---|
| id | UUID | Primary key |
| lead_id | UUID | FK to bd_leads |
| previous_owner_user_id | UUID | Nullable |
| new_owner_user_id | UUID | Required |
| previous_team_id | UUID | Nullable |
| new_team_id | UUID | Nullable |
| changed_by_user_id | UUID | Required |
| changed_at | TIMESTAMPTZ | Required |
| assignment_reason | TEXT | Optional or required by policy |

The original acquisition employee belongs on the lead record and must remain unchanged during normal reassignment.

## 11. Table 10 — bd_quotations

Use this table if the existing CRM does not already have an appropriate quotation module.

| Field | Type | Requirement |
|---|---|---|
| id | UUID | Primary key |
| quotation_number | VARCHAR(50) | Unique reference |
| lead_id | UUID | FK to bd_leads |
| quotation_date | DATE | Required |
| valid_until | DATE | Optional |
| currency_code | CHAR(3) | Required |
| subtotal | DECIMAL(18,2) | Required |
| discount_amount | DECIMAL(18,2) | Default 0 |
| tax_amount | DECIMAL(18,2) | Optional |
| total_amount | DECIMAL(18,2) | Required |
| status | VARCHAR(30) | Draft / Sent / Accepted / Rejected / Expired / Cancelled |
| sent_at | TIMESTAMPTZ | Nullable |
| accepted_at | TIMESTAMPTZ | Nullable |
| external_document_reference | TEXT | Optional |
| created_by | UUID | FK to CRM users |
| created_at | TIMESTAMPTZ | Required |
| updated_at | TIMESTAMPTZ | Required |

Add a separate `bd_quotation_items` table linking quotation line items to lead services. Preserve issued quotation versions rather than silently changing an already sent quotation.

## 12. Table 11 — bd_onboarding_handovers

One controlled handover per conversion event, with duplicate protection.

| Field | Type | Requirement |
|---|---|---|
| id | UUID | Primary key |
| handover_number | VARCHAR(50) | Unique reference |
| lead_id | UUID | FK to bd_leads |
| client_id | UUID | FK to existing Client Master; nullable until linked |
| status | VARCHAR(30) | Pending / Accepted / In Progress / Blocked / Completed / Cancelled |
| won_at | TIMESTAMPTZ | Date of commercial closure |
| handed_over_at | TIMESTAMPTZ | Nullable until submitted |
| handed_over_by | UUID | Closing employee |
| assigned_onboarding_user_id | UUID | Nullable until assigned |
| assigned_team_id | UUID | Optional |
| accepted_at | TIMESTAMPTZ | Nullable |
| completed_at | TIMESTAMPTZ | Nullable |
| handover_notes | TEXT | Required as appropriate |
| missing_items | JSON | Checklist of outstanding onboarding items |
| source_snapshot | JSON | Optional immutable summary of the handover |
| created_at | TIMESTAMPTZ | Required |
| updated_at | TIMESTAMPTZ | Required |

Prevent duplicate active handovers for the same conversion using an appropriate database constraint or transaction-safe idempotency mechanism.

A won lead is not the same as an onboarded client. Maintain separate timestamps and statuses.

## 13. Table 12 — bd_lost_reasons

| Field | Type | Requirement |
|---|---|---|
| id | UUID | Primary key |
| reason_code | VARCHAR(50) | Unique |
| reason_name | VARCHAR(100) | Required |
| requires_notes | BOOLEAN | Conditional validation |
| is_active | BOOLEAN | Required |
| sort_order | INTEGER | Display order |

Initial reasons: PRICE_TOO_HIGH, NO_RESPONSE, COMPETITOR_SELECTED, SERVICE_NOT_REQUIRED, BUDGET_UNAVAILABLE, TIMING_DEFERRED, REQUIREMENTS_NOT_MET, DUPLICATE_LEAD, OTHER

Record the selected reason, lost date, employee, affected services, and notes for every Lost outcome.

## 14. Table 13 — bd_audit_logs

Record significant changes across the module.

| Field | Type | Requirement |
|---|---|---|
| id | UUID | Primary key |
| entity_type | VARCHAR(100) | Table/entity name |
| entity_id | UUID | Changed record |
| action | VARCHAR(50) | Create / Update / Delete / Assign / Stage Change / Convert |
| changed_by_user_id | UUID | Actor |
| changed_at | TIMESTAMPTZ | Required |
| previous_values | JSON | Previous permitted values |
| new_values | JSON | New permitted values |
| reason | TEXT | Optional or mandatory by policy |
| request_reference | VARCHAR(100) | Optional correlation ID |

Prevent unauthorized modification of audit history. Do not indiscriminately log passwords, credentials, tokens, or full sensitive identity documents.

---

## 15. Supporting Database Entities

Reuse existing CRM tables for: Users and employee records; Teams and reporting relationships; Roles and permissions; Client Master; Service catalog; Document storage and access control; Notifications; Existing quotations, if available; Currency reference data and exchange rates, if used.

If the existing CRM lacks these entities, create appropriate supporting tables rather than embedding repeated information into every lead.

For documents, store secure file references and metadata, not publicly accessible file URLs.

## 16. Recommended Relationships

```text
CRM Users / Teams
       +---- bd_leads
       |        +---- bd_lead_services
       |        |        +---- bd_quotation_items
       |        +---- bd_discussions
       |        +---- bd_followups
       |        +---- bd_lead_stage_history
       |        +---- bd_lead_assignment_history
       |        +---- bd_quotations
       |        +---- bd_onboarding_handovers
       +---- bd_campaigns
       +---- bd_audit_logs

bd_leads.converted_client_id
       +---- Existing CRM Client Master
```

This is a logical relationship diagram, not a substitute for the actual database migration and foreign-key design.

## 17. Required Backend Business Rules

### Lead creation
- Generate a unique Lead ID.
- Require a valid source, acquisition employee, and current owner.
- Validate the initial discussion summary according to the agreed quick-capture policy.
- Check possible duplicates before inserting a new lead.
- Create the initial stage-history entry.

### Follow-ups
- Maintain one authoritative next-follow-up date derived from the relevant open follow-up records.
- Update the lead's last activity timestamp for qualifying activities.
- Notify the assigned employee of due and overdue actions.
- Preserve completion and rescheduling history.

### Stage changes
- Validate required fields server-side.
- Write the stage change and history entry in one transaction.
- Calculate stage duration from timestamps.
- Do not infer Won solely from moving a Kanban card.

### Won conversion
Within a transaction or equivalent reliable workflow:
1. Validate the lead's current state.
2. Validate accepted services and agreed fees.
3. Record the closing employee and closure timestamp.
4. Create or retrieve the appropriate onboarding handover.
5. Check existing client records using reliable identifiers.
6. Create or link the client master only through the approved Client Master workflow.
7. Persist the relationship and conversion outcome.
8. Make retries idempotent so repeated requests cannot create duplicate clients or handovers.

### Lost conversion
- Require a lost reason and required notes.
- Record affected services.
- Preserve the stage, ownership, and activity histories.
- Allow reopening only to authorized users with a recorded reason.

### Permissions
- Enforce authorization in the backend API and database-access layer.
- Restrict sensitive KYC and commercial information as required.
- Do not rely solely on hiding UI buttons.

---

## 18. API Requirements

Follow the existing CRM's API conventions. The following endpoints are logical requirements; their exact URLs may differ.

| Operation | Expected capability |
|---|---|
| Create lead | Create a lead with validation and duplicate checks |
| List leads | Filter, sort, search, paginate, and enforce permissions |
| Get lead details | Return permitted lead data and related records |
| Update lead | Update permitted fields and validate changes |
| Assign lead | Change owner/team and record assignment history |
| Update stage | Validate transition and record stage history |
| Add service | Attach a service opportunity to a lead |
| Update service budget | Record budget, proposed fee, and accepted fee |
| Log discussion | Create a required discussion record |
| Create follow-up | Schedule a new follow-up |
| Complete follow-up | Record outcome, summary, and next action |
| List follow-ups | Filter by employee, date, status, and team |
| Create quotation | Create quotation and service line items |
| Mark won | Validate closure and initiate controlled handover |
| Mark lost | Record reason and preserve history |
| Reopen lead | Authorized reopening with reason |
| Submit handover | Send won lead to onboarding |
| Complete onboarding | Record completion against the linked client |
| Dashboard metrics | Return filtered and consistently defined KPIs |
| Export | Export permitted records with appropriate access controls |

Use server-side pagination, validation errors, consistent response formats, and appropriate HTTP status codes.

---

## 19. Database Indexes and Constraints

At minimum, evaluate indexes on: `bd_leads.lead_number`, `bd_leads.assigned_to_user_id`, `bd_leads.acquired_by_user_id`, `bd_leads.stage_id`, `bd_leads.status`, `bd_leads.source_id`, `bd_leads.campaign_id`, `bd_leads.created_at`, `bd_leads.next_followup_at`, `bd_leads.converted_client_id`, `bd_lead_services.lead_id`, `bd_discussions.lead_id, occurred_at`, `bd_followups.assigned_to_user_id, scheduled_at`, `bd_followups.lead_id, status`, `bd_lead_stage_history.lead_id, changed_at`, `bd_lead_assignment_history.lead_id, changed_at`, `bd_quotations.quotation_number`, `bd_onboarding_handovers.handover_number`.

Use unique constraints for reference numbers and appropriate composite constraints for duplicate prevention. Avoid a blanket unique constraint on mobile or email that would prevent legitimate shared company contacts or multiple contacts belonging to one business.

## 20. Dashboard Calculation Definitions

All reports must use consistent definitions.

| Metric | Suggested definition |
|---|---|
| Total Leads | Distinct non-archived leads in the selected scope |
| New Leads | Leads created within the selected period |
| Contacted Leads | Leads with at least one qualifying recorded contact |
| Qualified Leads | Leads meeting the qualification definition |
| Open Pipeline Value | Potential value of active, eligible service opportunities |
| Weighted Pipeline | Eligible potential value multiplied by the configured forecast probability |
| Won Value | Accepted commercial value under the agreed reporting basis |
| Lost Leads | Leads with a Lost outcome during the selected closure period |
| Conversion Rate | Won leads divided by the agreed lead cohort or eligible closed leads |
| Average First Contact Time | Time from lead creation to first qualifying contact |
| Follow-up Compliance | Completed eligible follow-ups divided by follow-ups due in the period |
| Stage Ageing | Current time minus the most recent stage-entry timestamp |
| Onboarding Turnaround | Time from handover submission to onboarding completion |

Document whether each report is cohort-based or period-based. Avoid dividing won leads this month by leads created this month unless that cohort definition is intentional.

## 21. Implementation and Testing Checklist

- [ ] Database migrations created and reviewed.
- [ ] Existing CRM Client Master integration verified.
- [ ] Lead ID generation implemented.
- [ ] Source and campaign masters configured.
- [ ] Acquisition attribution separated from current ownership.
- [ ] Multiple services and budgets supported.
- [ ] Discussion and follow-up validation implemented.
- [ ] Stage and assignment history persisted.
- [ ] Duplicate detection implemented.
- [ ] Role permissions enforced server-side.
- [ ] Won conversion is transaction-safe and idempotent.
- [ ] Lost and reopen workflows preserve history.
- [ ] Audit logs implemented.
- [ ] Dashboard totals reconcile with underlying records.
- [ ] Timezone and currency handling tested.
- [ ] Export and sensitive-data access tested.
- [ ] Backup, migration rollback, and recovery approach documented.
- [ ] End-to-end tests completed for the full lead-to-onboarding lifecycle.

**Final implementation rule:** Before creating new tables, inspect the existing database and reuse compatible user, team, service, quotation, and client entities. Produce an entity-relationship diagram, migration plan, API contract, and field-mapping sheet before applying production changes.
