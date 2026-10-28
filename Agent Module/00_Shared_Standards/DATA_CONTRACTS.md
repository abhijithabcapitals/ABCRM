# Data Contracts

SQL engine: Microsoft SQL Server (2017+). Baseline DDL: `sql\001_baseline_schema.sql`.

## Conventions
- One SQL schema per agent: `client`, `accounting`, `tax`, `audit`, `bizdev`, `social`, `document`, `support`, `security`, `hr`, `personal`, `it`. Shared tables live in `core`.
- An agent writes only inside its own schema. Cross-schema reads use tables or views granted in the baseline script.
- Keys: `uniqueidentifier` with `DEFAULT NEWSEQUENTIALID()`.
- Times: `datetime2(3)` in UTC, `DEFAULT SYSUTCDATETIME()`.
- Enumerations: `varchar` with a `CHECK` constraint.
- JSON: `nvarchar(max)` with `CHECK (ISJSON(col) = 1)`.
- Concurrency: `row_version rowversion` on mutable business tables.
- No hard deletes: `DELETE` is denied on every agent schema.

## Common columns (every owned table)
| Column | Type | Notes |
| --- | --- | --- |
| id | uniqueidentifier | Primary key |
| client_id | uniqueidentifier NULL | FK to `client.clients.id` where relevant |
| status | varchar(20) | Lifecycle state, CHECK constrained |
| created_at | datetime2(3) | UTC |
| created_by | varchar(256) | Agent ID or user ID |
| updated_at | datetime2(3) NULL | UTC |
| updated_by | varchar(256) NULL | |
| row_version | rowversion | Optimistic concurrency |

## core.agent_action_log (append-only)
| Column | Type | Notes |
| --- | --- | --- |
| id | uniqueidentifier | |
| ts | datetime2(3) | UTC |
| agent_id | varchar(40) | e.g. AGT-02-ACCOUNTING |
| on_behalf_of | nvarchar(256) NULL | Human user who started the request |
| action | varchar(30) | read, create, update, handoff, approval_request, refuse |
| target_table | sysname NULL | |
| target_id | uniqueidentifier NULL | |
| result | varchar(20) | ok, refused, error, pending_approval |
| reason | nvarchar(1000) NULL | Short explanation |
| correlation_id | uniqueidentifier | Links all steps of one request |

A trigger blocks UPDATE and DELETE for everyone, including `dbo`.

## core.approvals
| Column | Type | Notes |
| --- | --- | --- |
| id | uniqueidentifier | |
| created_at | datetime2(3) | UTC |
| requested_by | varchar(40) | Agent ID |
| correlation_id | uniqueidentifier | |
| client_id | uniqueidentifier NULL | |
| action_summary | nvarchar(500) | |
| payload | nvarchar(max) JSON | Exact action to run on approval |
| approver | nvarchar(256) NULL | Set only by `crm_approver` |
| decision | varchar(10) | pending, approved, rejected |
| decided_at | datetime2(3) NULL | |
| decision_note | nvarchar(1000) NULL | |

Agents can insert pending rows only (enforced by trigger). Only the `crm_approver` role can decide.

## core.handoffs
See `HANDOFF_PROTOCOL.md` for the envelope. Columns match the envelope, plus `status` (sent, accepted, rejected, needs_info, done), `status_reason`, `status_at`.

## client.clients (owned by Client Agent)
| Column | Type | Notes |
| --- | --- | --- |
| id | uniqueidentifier | |
| legal_name | nvarchar(300) | |
| display_name | nvarchar(300) NULL | |
| client_type | varchar(20) | individual, company, partnership, trust, other |
| tax_id | nvarchar(50) NULL | Unique per jurisdiction, unless merged |
| jurisdiction | char(2) NULL | ISO 3166-1 alpha-2 |
| lifecycle_stage | varchar(20) | onboarding, active, dormant, offboarded |
| status | varchar(20) | active, archived, merged |
| merged_into_id | uniqueidentifier NULL | Self FK |
| retention_until | date NULL | |

## document.documents (owned by Document Agent)
| Column | Type | Notes |
| --- | --- | --- |
| id | uniqueidentifier | |
| client_id | uniqueidentifier | FK to `client.clients` |
| onedrive_drive_id | nvarchar(200) | Microsoft Graph drive id |
| onedrive_item_id | nvarchar(200) | Microsoft Graph driveItem id; unique with drive id |
| path | nvarchar(1000) | Display path only |
| doc_type | varchar(20) | invoice, contract, tax_return, statement, report, id_document, hr, other |
| period | varchar(10) NULL | e.g. 2026-Q3 |
| sha256 | char(64) | Computed locally on upload |
| quickxor_hash | varchar(44) NULL | From Graph `file.hashes.quickXorHash`; matches files added outside the agent. Not yet in `001_baseline_schema.sql` |
| sensitivity | varchar(12) | public, internal, confidential, restricted |
| retention_until | date NULL | |
| status | varchar(20) | active, superseded, retention_hold, purge_approved |

Other agents read `document.v_document_metadata`, which hides restricted, HR, and identity documents.
