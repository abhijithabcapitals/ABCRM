# BD backend: entity-relationship diagram

This diagram matches `migrations/bd/001_bd_schema.sql` (draft). Only the key columns are shown; the full column list is in `SQL Data/BD_Field_Mapping.xlsx`.

Key for the boxes:
- **Grey**, reused from the CRM: `profiles`, plus the Client Master. The Client Master is outside this database; it lives in the Client Module as `client-master.csv`.
- **New shared CRM tables**: `crm_teams`, `crm_team_members`.
- **Everything else** is new in the BD part.

```mermaid
erDiagram
    profiles ||--o{ crm_team_members : "member of"
    crm_teams ||--o{ crm_team_members : has
    profiles ||--o| bd_user_roles : "BD permission"

    bd_lead_sources ||--o{ bd_leads : "original source"
    bd_campaigns ||--o{ bd_leads : "attributed to"
    bd_pipeline_stages ||--o{ bd_leads : "current stage"
    bd_lost_reasons ||--o{ bd_leads : "lost because"
    profiles ||--o{ bd_leads : "acquired_by / assigned_to / closing / created_by"
    crm_teams ||--o{ bd_leads : "assigned team"
    profiles ||--o{ bd_campaigns : owns

    bd_leads ||--o{ bd_lead_services : "service opportunities"
    bd_service_catalog ||--o{ bd_lead_services : "service"
    bd_leads ||--o{ bd_quotations : quotations
    bd_quotations ||--o{ bd_quotations : "supersedes (versions)"
    bd_quotations ||--o{ bd_quotation_items : lines
    bd_lead_services ||--o{ bd_quotation_items : "quoted as"
    bd_quotations ||--o{ bd_lead_services : "latest quotation"

    bd_leads ||--o{ bd_discussions : discussions
    bd_lead_services ||--o{ bd_discussions : "about service"
    bd_leads ||--o{ bd_followups : "follow-ups"
    bd_discussions ||--o{ bd_followups : "agreed in"
    bd_followups ||--o{ bd_followup_history : "reschedule / complete log"

    bd_leads ||--o{ bd_lead_stage_history : "stage transitions"
    bd_pipeline_stages ||--o{ bd_lead_stage_history : "from / to"
    bd_leads ||--o{ bd_lead_assignment_history : "owner changes"

    bd_leads ||--o{ bd_onboarding_handovers : "handover (max 1 not cancelled)"
    bd_leads |o--o| bd_onboarding_handovers : "current handover"
    CLIENT_MASTER ||--o{ bd_onboarding_handovers : "client_id = CL000001..."
    CLIENT_MASTER ||--o{ bd_leads : "converted_client_id = CL000001..."

    bd_audit_logs }o--|| profiles : "changed_by"

    bd_leads {
        uuid id PK
        varchar lead_number UK "LD-2026-000001"
        varchar status "Open/Won/Lost/Disqualified/On Hold"
        uuid stage_id FK
        uuid source_id FK
        uuid acquired_by_user_id FK "never changes"
        uuid assigned_to_user_id FK "current owner"
        varchar converted_client_id "Client Module ID"
        timestamptz case_opened_at "immutable"
    }
    bd_lead_services {
        uuid id PK
        uuid lead_id FK
        uuid service_id FK
        varchar service_status
        char currency_code
        numeric client_budget_amount
        numeric proposed_fee_amount
        numeric final_agreed_fee_amount
    }
    bd_onboarding_handovers {
        uuid id PK
        varchar handover_number UK "HO-2026-000001"
        uuid lead_id FK
        varchar client_id "CL000001"
        varchar idempotency_key UK
        varchar status
    }
    CLIENT_MASTER {
        varchar client_id PK "Client Module client-master.csv"
    }
    profiles {
        uuid id PK "auth.users on the live CRM"
        text role "admin / member"
    }
```

## Notes

- **Users:** the live CRM's `public.profiles` (`id = auth.uid()`) is the user table. The migration creates `profiles` only when it is missing, which is the case in a local database.
- **Client Master link:** the Client Master is the Client Module CSV, so `converted_client_id` and `bd_onboarding_handovers.client_id` cannot be database foreign keys:
  - they are `VARCHAR(20)` values checked against the `CL000001` format;
  - the API checks each one against the Client Module (`GET /api/clients/{id}`) before saving it.
  - When the Client Master moves into this database, these become real foreign keys.
- **Quotation templates:** `bd_quotations.quotation_template_id` will point to the live `public.quotation_templates` (the freezone .docx templates). The foreign key will be added when the BD part is deployed to the CRM's Supabase project.
- **Append-only tables:** stage history, assignment history, follow-up history and audit logs. A trigger rejects UPDATE and DELETE on them.
