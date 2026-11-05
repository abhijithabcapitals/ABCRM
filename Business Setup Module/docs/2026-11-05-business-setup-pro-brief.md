# Business Setup & PRO Services: User's Brief and Decision

Date: 2026-11-05. Status: the user's brief, not yet a spec. No part of it is built.

## Decision

The user chose **Extend current build**, on 2026-11-05. So this brief extends branch `business-setup-restructure` and `2026-11-05-business-setup-client-flow-design.md`. It is not a new standalone module.

The recommendation the user accepted:
- Phase A of the client flow finishes as planned.
- Phase C checklists are upgraded to the brief's stage, status and verification model. A service on a case is the brief's Service Request.
- New phases follow, in order: renewals register and reminders; approvals and document versions; Kanban and reports.
- The brief's 15-tab layout comes only if tabs are regrouped at the end.

## Conflicts with what exists

| # | Conflict | Proposed handling | State |
|---|---|---|---|
| 1 | `business_setup_services` already holds real client services; the brief uses that name for the catalogue | New tables take other names | Proposed |
| 2 | Business Banking is its own department with about 900 clients; the brief lists it as a tab here | A link only | Proposed |
| 3 | Project notes say uploads go to `D:\Abhijith Projects\DataBase` and OneDrive is parked; the brief says use OneDrive folders | Not decided | **User decides** |
| 4 | Live roles are Admin, Manager, Sales Executive, Document Executive, Finance; the brief has Admin, Manager, Employee, Viewer | Map the brief's onto the existing ones | Proposed |
| 5 | The user chose checklists ticked in any order; the brief adds stages, reviewers and manager verification | Not decided: strict order or sign-off would change that decision | **User decides** |
| 6 | The brief gives each service an independent workflow; the current design has one case, one quote and one handover | A service on a case is the Service Request, per the decision above | Decided |

## The brief, as the user gave it

**Objective.** A complete Business Setup & PRO Services Management Module inside the existing CRM, not standalone. It manages each client service request from quotation and document collection through government submission, approval, delivery, closure and renewal. Real-time visibility of: client service progress, stage-wise checkpoints, employee responsibilities, pending tasks, client document requirements, government application status, internal approvals, service fees and payments, renewal and compliance deadlines, complete activity history.

**Inspect first.** Project structure, frontend, backend and APIs, database schema, authentication and roles, Client Master, employee management and allocation, document storage and OneDrive, notifications and activity logs, reusable UI. Do not recreate existing functionality, duplicate client tables, break existing modules or replace authentication. Follow existing standards and reuse components. Prepare a development plan and a migration plan before implementation.

**Navigation.** Department "BUSINESS SETUP & PRO". Submodules: Dashboard, Service Requests, Company Formation, License & Approvals, Visa & Immigration, PRO Services, Corporate Amendments, Corporate Compliance, Office & Ejari, Business Banking, Liquidation & Closure, Renewals & Expiry Management, Tasks & Employee Allocation, Reports, Service Configuration. Service categories configurable from administration.

**Add Service Request.** Service Request ID (auto), Client ID (Client Master), Client Name (auto), Service Department, Service Category, Specific Service, Jurisdiction / Authority, Service Description, Request Date, Assigned Employee, Reviewing Manager, Priority, Expected Completion Date, Consultancy Fee, Government Fee, VAT where applicable, Total Quotation, Payment Status, Internal Remarks. Each request has its own independent workflow. A client can have several active requests.

**Workflow engine.** Configurable. Each service has stages, stage-wise checkpoints, mandatory and optional checkpoints, conditional checkpoints, required document types, employee assignment, reviewer assignment, due dates, completion requirements, approval requirements. Predefined editable templates: Mainland, Free Zone and Offshore Company Formation; Trade License Renewal; Investor, Employment and Family Visa; Establishment Card; MOHRE Services; Corporate Amendments; UBO Compliance; AML/CFT Compliance; Ejari Services; Company Liquidation; General PRO Transactions. Authorised administrators edit them. Updating a template must not change requests already created.

**Checkpoints.** Fields: Checkpoint ID, Stage ID, Name, Description, Mandatory / Optional, Applicable / Not Applicable, Assigned Employee, Reviewer, Start Date, Due Date, Completion Date, Status, Remarks, Attachments, Verification Status. Statuses: Not Started, In Progress, Pending Client, Pending Authority, Pending Internal Approval, On Hold, Completed, Not Applicable, Reopened. Employees update individually. Authorised managers verify mandatory checkpoints. Full history of every change.

**Progress.** Completed Applicable Checkpoints / Total Applicable Checkpoints x 100, automatic. Completed counts; Not Applicable is excluded; pending, In Progress and On Hold do not count; Reopened reduces progress; cancelled requests have a separate status. Show overall and stage-wise progress, completed, pending and overdue checkpoints, next pending action. Employees cannot edit percentages by hand.

**Service workspace tabs.** Overview, Workflow & Checklists, Tasks, Documents, Communication, Fees & Payments, Approvals, Activity History, Renewals. Overview shows service name, client name, request ID, assigned employee, reviewing manager, current stage, progress, status, next action, expected completion, days pending, outstanding documents, outstanding payments.

**Tasks.** A task per checkpoint where needed: Task ID, Client, Service Request, Task Name, Assigned Employee, Reviewer, Priority, Due Date, Status, Remarks, Attachments, Completed Date. Automatic alerts: tasks near deadline, overdue tasks, pending client documents, pending authority approvals, internal approvals, delayed requests. Managers can reassign.

**Documents.** Use the existing storage. Each request supports client-submitted, internal working, government submission, approval certificate and final issued documents. Each has name, type, upload date, uploaded by, version, expiry if any, verification status, linked checkpoint, storage reference. Use the existing OneDrive structure; no duplicate repositories.

**Renewal & compliance register.** Central Client Compliance Register tracking Trade License, Establishment Card, Investor Visa, Employment Visa, Emirates ID, Ejari, MOHRE / Labour Establishment, Immigration File, Insurance, Government Approvals, other configurable items. Fields: Client ID, Compliance Type, Document Reference, Issue Date, Expiry Date, Responsible Employee, Current Status, Last Updated, Next Action, Related Service Request. Configurable reminders at 90, 60, 30, 15 and 7 days before expiry and on the expiry date. A reminder creates a follow-up task. A renewal request is created only through the configured workflow and proper authorisation.

**Dashboard.** Total Active, Completed, Pending, Overdue Cases; Waiting for Client; Waiting for Authority; Tasks Due Today; Upcoming Renewals; Expired Documents; Employee Workload. Filters: Employee, Client, Service Category, Authority, Priority, Status, Date Range. Graphs of monthly performance and service completion.

**Database, as the brief names it.** business_setup_services, service_workflow_templates, workflow_stages, workflow_checkpoint_templates, client_service_requests, service_checkpoints, service_tasks, service_documents, service_approvals, service_communications, service_payments, client_compliance_register, compliance_reminders, employee_service_assignments, service_activity_logs. Reuse Client Master, Employee Master, authentication and document storage. Foreign keys, indexes, constraints, migrations. Transactions for creating a request and its checkpoints.

**Roles.** Admin: full access, workflow configuration, allocation, all reports. Manager: department dashboard, assignments, checkpoint verification, approval and escalation, monitoring. Employee: assigned requests and tasks, uploads, checkpoint updates, client follow-ups. Viewer: read-only as authorised. Audit logs for sensitive changes. Employees cannot bypass mandatory approval checkpoints or delete history.

**UI.** Modern and consistent with the CRM: clean dashboard, responsive, status badges, progress bars, workflow timelines, search and filters, Kanban for requests, table for monitoring, detailed workspace, clear overdue indicators. Avoid unnecessary fields and navigation. Easy for non-technical employees.

**Phases.** 1 Foundation: inspect, database design, service master, templates, request creation. 2 Operations: checkpoint engine, progress, allocation, tasks, workspace. 3 Documents & approvals: integration, approval workflow, verification, history. 4 Renewals: register, expiry tracking, reminder engine, renewal tasks. 5 Management: dashboard, reports, employee performance, escalations.

**Tests before deployment.** Create a company formation request; automatic checkpoint generation; complete checkpoints and check progress; Not Applicable adjusts the denominator; reopen a completed checkpoint; assign tasks to several employees; upload and retrieve documents; mandatory approval restrictions; renewal reminders; overdue alerts; role-based access; existing modules keep working.

**Instructions.** Work phase by phase, no one uncontrolled change. After each phase: run migrations and tests, check errors, verify integration, summarise files changed, document new tables and APIs, name outstanding work. No dummy data in production. No workflows hardcoded in the frontend. All workflows, stages, checkpoints, mandatory conditions and reminder rules are configurable.
