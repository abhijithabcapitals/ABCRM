# Permission Matrix

Each agent connects with its own SQL login. Grants follow this matrix exactly.
OneDrive access goes through Document Agent only.

| Agent ID | Agent | Write (owner) | Read |
| --- | --- | --- | --- |
| AGT-01-CLIENT | Client Agent | `clients`, `client_contacts`, `engagements`, `client_lifecycle_events` | invoices (summary only); tickets (summary only); documents (metadata only) |
| AGT-02-ACCOUNTING | Accounting Agent | `invoices`, `invoice_lines`, `payments_received`, `payables`, `journal_entries`, `reconciliations` | clients; engagements; documents (invoices, statements) |
| AGT-03-TAX | Tax Agent | `tax_rules`, `tax_obligations`, `tax_computations`, `filing_calendar` | clients; journal_entries; invoices; documents (tax notices, prior returns) |
| AGT-04-AUDIT | Audit Agent | `audit_findings`, `audit_samples`, `audit_workpapers` | All business tables (read-only); agent_action_log; documents (read-only) |
| AGT-05-BIZDEV | Business Development Agent | `leads`, `opportunities`, `proposals`, `pipeline_activities` | clients (to detect existing clients); service_catalogue; price_list |
| AGT-06-SOCIAL | Social Media Agent | `content_calendar`, `social_posts`, `campaigns`, `social_metrics` | brand_guidelines; approved_case_studies |
| AGT-07-DOCUMENT | Document Agent | `documents`, `document_versions`, `retention_policies`, `folder_map` | clients; engagements |
| AGT-08-SUPPORT | Support Agent | `tickets`, `ticket_messages`, `knowledge_base`, `sla_policies` | clients; engagements; invoices (summary only) |
| AGT-09-SECURITY | Security Agent | `security_incidents`, `access_reviews`, `permission_matrix`, `security_alerts` | agent_action_log; user_roles; document sharing metadata |
| AGT-10-HR | Human Resource Agent | `employees`, `leave_records`, `training_records`, `hr_cases` | org_structure; user_roles (summary) |
| AGT-11-PERSONAL | Personal Agent | `personal_tasks`, `personal_notes`, `reminders` | Business data only via explicit, logged requests to the owning agent |
| AGT-12-IT | IT Agent | `schema_migrations`, `integration_config (non-secret)`, `job_runs`, `agent_registry` | agent_action_log; system health metrics |

All agents: INSERT only on `agent_action_log`, `approvals`, `handoffs`. No UPDATE or DELETE on log tables.

## SQL Server implementation
Applied by `sql\001_baseline_schema.sql`. Each agent's database user joins one role.

| Role | Grants |
| --- | --- |
| `agent_<name>` | SELECT, INSERT, UPDATE, EXECUTE on its own schema. DELETE denied. |
| every `agent_<name>` | INSERT on `core.agent_action_log`; INSERT, SELECT on `core.approvals` (pending only); INSERT, SELECT, UPDATE (status columns) on `core.handoffs` |
| `agent_audit` | SELECT on every schema except `hr` and `personal` |
| `agent_security`, `agent_it` | SELECT on `core.agent_action_log` |
| `agent_orchestrator` | Route handoffs, read approvals. Cannot decide approvals. |
| `crm_approver` | Humans only. The only role that can decide approvals. |
| `agent_personal` | Own schema only. SELECT denied on `client`, `accounting`, `hr`, `document`. |

Known gaps (fix in Phase 2):
- "Summary only" reads need views in the owning schema, then a grant.
- Any agent can update the status of any handoff. Move status changes into a stored procedure that checks `to_agent` against the caller.
