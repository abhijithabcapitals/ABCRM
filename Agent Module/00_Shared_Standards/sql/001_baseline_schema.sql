/*
  CRM AI Agent System - baseline schema for Microsoft SQL Server (2017+).

  Creates:
    - One SQL schema per agent, plus [core] for shared tables
    - Shared tables: core.agent_action_log, core.approvals, core.handoffs
    - Anchor tables other agents depend on: client.clients, document.documents
    - One database role per agent, granted per 00_Shared_Standards\PERMISSIONS.md

  Does NOT create logins, users, or passwords. IT Agent creates one database user
  per agent per environment and adds it to the matching role.

  Idempotent: safe to rerun. Run in a TEST database first, as a deployment account
  (db_owner), never as an agent login.

  EXISTING CRM: do not run this against the CRM database yet. Run
  000_discover_existing_schema.sql first. If the CRM already has client or
  document tables, the "anchor tables" section below is replaced by views in the
  client and document schemas that read the existing tables, so agents never
  duplicate or alter CRM tables.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

/* ------------------------------------------------------------------ schemas */
DECLARE @schemas TABLE (name sysname);
INSERT @schemas VALUES
  ('core'), ('client'), ('accounting'), ('tax'), ('audit'), ('bizdev'), ('social'),
  ('document'), ('support'), ('security'), ('hr'), ('personal'), ('it');

DECLARE @s sysname, @sql nvarchar(max);
DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM @schemas;
OPEN c; FETCH NEXT FROM c INTO @s;
WHILE @@FETCH_STATUS = 0
BEGIN
  IF SCHEMA_ID(@s) IS NULL
  BEGIN
    SET @sql = N'CREATE SCHEMA ' + QUOTENAME(@s) + N' AUTHORIZATION dbo;';
    EXEC (@sql);
  END
  FETCH NEXT FROM c INTO @s;
END
CLOSE c; DEALLOCATE c;
GO

/* ------------------------------------------------------------------ core tables */
IF OBJECT_ID(N'core.agent_action_log', N'U') IS NULL
CREATE TABLE core.agent_action_log (
  id              uniqueidentifier NOT NULL CONSTRAINT DF_action_log_id DEFAULT NEWSEQUENTIALID(),
  ts              datetime2(3)     NOT NULL CONSTRAINT DF_action_log_ts DEFAULT SYSUTCDATETIME(),
  agent_id        varchar(40)      NOT NULL,
  on_behalf_of    nvarchar(256)    NULL,
  action          varchar(30)      NOT NULL
    CONSTRAINT CK_action_log_action CHECK (action IN ('read','create','update','handoff','approval_request','refuse')),
  target_table    sysname          NULL,
  target_id       uniqueidentifier NULL,
  result          varchar(20)      NOT NULL
    CONSTRAINT CK_action_log_result CHECK (result IN ('ok','refused','error','pending_approval')),
  reason          nvarchar(1000)   NULL,
  correlation_id  uniqueidentifier NOT NULL,
  CONSTRAINT PK_agent_action_log PRIMARY KEY CLUSTERED (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_action_log_correlation')
  CREATE INDEX IX_action_log_correlation ON core.agent_action_log (correlation_id, ts);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_action_log_agent_ts')
  CREATE INDEX IX_action_log_agent_ts ON core.agent_action_log (agent_id, ts);
GO

-- Append-only: blocks UPDATE and DELETE for everyone, including dbo.
CREATE OR ALTER TRIGGER core.TR_agent_action_log_append_only
ON core.agent_action_log
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  THROW 50001, 'core.agent_action_log is append-only.', 1;
END;
GO

IF OBJECT_ID(N'core.approvals', N'U') IS NULL
CREATE TABLE core.approvals (
  id              uniqueidentifier NOT NULL CONSTRAINT DF_approvals_id DEFAULT NEWSEQUENTIALID(),
  created_at      datetime2(3)     NOT NULL CONSTRAINT DF_approvals_created DEFAULT SYSUTCDATETIME(),
  requested_by    varchar(40)      NOT NULL,
  correlation_id  uniqueidentifier NOT NULL,
  client_id       uniqueidentifier NULL,
  action_summary  nvarchar(500)    NOT NULL,
  payload         nvarchar(max)    NOT NULL CONSTRAINT CK_approvals_payload_json CHECK (ISJSON(payload) = 1),
  approver        nvarchar(256)    NULL,
  decision        varchar(10)      NOT NULL CONSTRAINT DF_approvals_decision DEFAULT 'pending'
    CONSTRAINT CK_approvals_decision CHECK (decision IN ('pending','approved','rejected')),
  decided_at      datetime2(3)     NULL,
  decision_note   nvarchar(1000)   NULL,
  CONSTRAINT PK_approvals PRIMARY KEY CLUSTERED (id),
  CONSTRAINT CK_approvals_decided CHECK (
    (decision = 'pending' AND approver IS NULL AND decided_at IS NULL)
    OR (decision <> 'pending' AND approver IS NOT NULL AND decided_at IS NOT NULL))
);
GO

-- Agents may only create pending requests. SQL Server has no column-level INSERT
-- grant, so this trigger stops an agent inserting a pre-approved row.
CREATE OR ALTER TRIGGER core.TR_approvals_insert_pending
ON core.approvals
AFTER INSERT
AS
BEGIN
  IF EXISTS (SELECT 1 FROM inserted WHERE decision <> 'pending')
    THROW 50002, 'New approvals must be pending.', 1;
END;
GO

IF OBJECT_ID(N'core.handoffs', N'U') IS NULL
CREATE TABLE core.handoffs (
  handoff_id        uniqueidentifier NOT NULL CONSTRAINT DF_handoffs_id DEFAULT NEWSEQUENTIALID(),
  correlation_id    uniqueidentifier NOT NULL,
  created_at        datetime2(3)     NOT NULL CONSTRAINT DF_handoffs_created DEFAULT SYSUTCDATETIME(),
  from_agent        varchar(40)      NOT NULL,
  to_agent          varchar(40)      NOT NULL,
  type              varchar(60)      NOT NULL,
  client_id         uniqueidentifier NULL,
  priority          varchar(10)      NOT NULL CONSTRAINT DF_handoffs_priority DEFAULT 'normal'
    CONSTRAINT CK_handoffs_priority CHECK (priority IN ('low','normal','high','urgent')),
  summary           nvarchar(500)    NOT NULL,
  payload           nvarchar(max)    NOT NULL CONSTRAINT CK_handoffs_payload_json CHECK (ISJSON(payload) = 1),
  requires_approval bit              NOT NULL CONSTRAINT DF_handoffs_req_appr DEFAULT 0,
  status            varchar(12)      NOT NULL CONSTRAINT DF_handoffs_status DEFAULT 'sent'
    CONSTRAINT CK_handoffs_status CHECK (status IN ('sent','accepted','rejected','needs_info','done')),
  status_reason     nvarchar(500)    NULL,
  status_at         datetime2(3)     NULL,
  CONSTRAINT PK_handoffs PRIMARY KEY CLUSTERED (handoff_id),
  CONSTRAINT CK_handoffs_not_self CHECK (from_agent <> to_agent)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_handoffs_to_status')
  CREATE INDEX IX_handoffs_to_status ON core.handoffs (to_agent, status, created_at);
GO

/* ------------------------------------------------------------------ anchor tables
   Placeholder for a CRM with no client or document tables. For the existing CRM,
   replace this section with adapter views after discovery (see header). */
IF OBJECT_ID(N'client.clients', N'U') IS NULL
CREATE TABLE client.clients (
  id               uniqueidentifier NOT NULL CONSTRAINT DF_clients_id DEFAULT NEWSEQUENTIALID(),
  legal_name       nvarchar(300)    NOT NULL,
  display_name     nvarchar(300)    NULL,
  client_type      varchar(20)      NOT NULL
    CONSTRAINT CK_clients_type CHECK (client_type IN ('individual','company','partnership','trust','other')),
  tax_id           nvarchar(50)     NULL,
  jurisdiction     char(2)          NULL,  -- ISO 3166-1 alpha-2
  lifecycle_stage  varchar(20)      NOT NULL CONSTRAINT DF_clients_stage DEFAULT 'onboarding'
    CONSTRAINT CK_clients_stage CHECK (lifecycle_stage IN ('onboarding','active','dormant','offboarded')),
  status           varchar(20)      NOT NULL CONSTRAINT DF_clients_status DEFAULT 'active'
    CONSTRAINT CK_clients_status CHECK (status IN ('active','archived','merged')),
  merged_into_id   uniqueidentifier NULL,
  retention_until  date             NULL,
  created_at       datetime2(3)     NOT NULL CONSTRAINT DF_clients_created DEFAULT SYSUTCDATETIME(),
  created_by       varchar(256)     NOT NULL,
  updated_at       datetime2(3)     NULL,
  updated_by       varchar(256)     NULL,
  row_version      rowversion       NOT NULL,
  CONSTRAINT PK_clients PRIMARY KEY CLUSTERED (id),
  CONSTRAINT FK_clients_merged_into FOREIGN KEY (merged_into_id) REFERENCES client.clients (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_clients_tax_id')
  CREATE UNIQUE INDEX UX_clients_tax_id ON client.clients (jurisdiction, tax_id)
  WHERE tax_id IS NOT NULL AND status <> 'merged';
GO

IF OBJECT_ID(N'document.documents', N'U') IS NULL
CREATE TABLE document.documents (
  id                uniqueidentifier NOT NULL CONSTRAINT DF_documents_id DEFAULT NEWSEQUENTIALID(),
  client_id         uniqueidentifier NOT NULL,
  onedrive_drive_id nvarchar(200)    NOT NULL,  -- Microsoft Graph drive id
  onedrive_item_id  nvarchar(200)    NOT NULL,  -- Microsoft Graph driveItem id
  path              nvarchar(1000)   NOT NULL,  -- display path only; item id is the key
  doc_type          varchar(20)      NOT NULL
    CONSTRAINT CK_documents_type CHECK (doc_type IN ('invoice','contract','tax_return','statement','report','id_document','hr','other')),
  period            varchar(10)      NULL,      -- e.g. 2026-Q3, 2026-10
  sha256            char(64)         NOT NULL,
  sensitivity       varchar(12)      NOT NULL CONSTRAINT DF_documents_sens DEFAULT 'confidential'
    CONSTRAINT CK_documents_sens CHECK (sensitivity IN ('public','internal','confidential','restricted')),
  retention_until   date             NULL,
  status            varchar(20)      NOT NULL CONSTRAINT DF_documents_status DEFAULT 'active'
    CONSTRAINT CK_documents_status CHECK (status IN ('active','superseded','retention_hold','purge_approved')),
  created_at        datetime2(3)     NOT NULL CONSTRAINT DF_documents_created DEFAULT SYSUTCDATETIME(),
  created_by        varchar(256)     NOT NULL,
  updated_at        datetime2(3)     NULL,
  updated_by        varchar(256)     NULL,
  row_version       rowversion       NOT NULL,
  CONSTRAINT PK_documents PRIMARY KEY CLUSTERED (id),
  CONSTRAINT FK_documents_client FOREIGN KEY (client_id) REFERENCES client.clients (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_documents_item')
  CREATE UNIQUE INDEX UX_documents_item ON document.documents (onedrive_drive_id, onedrive_item_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_documents_client_hash')
  CREATE INDEX IX_documents_client_hash ON document.documents (client_id, sha256);
GO

-- Metadata-only view for agents that may see documents but not restricted ones.
CREATE OR ALTER VIEW document.v_document_metadata
AS
SELECT id, client_id, path, doc_type, period, sensitivity, status, created_at
FROM document.documents
WHERE sensitivity <> 'restricted' AND doc_type NOT IN ('hr','id_document');
GO

/* ------------------------------------------------------------------ roles */
DECLARE @roles TABLE (name sysname);
INSERT @roles VALUES
  ('agent_orchestrator'),
  ('agent_client'), ('agent_accounting'), ('agent_tax'), ('agent_audit'),
  ('agent_bizdev'), ('agent_social'), ('agent_document'), ('agent_support'),
  ('agent_security'), ('agent_hr'), ('agent_personal'), ('agent_it'),
  ('crm_approver');  -- humans who decide approvals, via the CRM UI

DECLARE @r sysname, @sql nvarchar(max);
DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM @roles;
OPEN c; FETCH NEXT FROM c INTO @r;
WHILE @@FETCH_STATUS = 0
BEGIN
  IF DATABASE_PRINCIPAL_ID(@r) IS NULL
  BEGIN
    SET @sql = N'CREATE ROLE ' + QUOTENAME(@r) + N' AUTHORIZATION dbo;';
    EXEC (@sql);
  END
  FETCH NEXT FROM c INTO @r;
END
CLOSE c; DEALLOCATE c;
GO

/* ------------------------------------------------------------------ grants
   Owner schema: SELECT, INSERT, UPDATE, EXECUTE. DELETE is denied (no hard deletes).
   Grants are schema-level, so tables added later inherit them. */
DECLARE @own TABLE (role sysname, sch sysname);
INSERT @own VALUES
  ('agent_client','client'), ('agent_accounting','accounting'), ('agent_tax','tax'),
  ('agent_audit','audit'), ('agent_bizdev','bizdev'), ('agent_social','social'),
  ('agent_document','document'), ('agent_support','support'), ('agent_security','security'),
  ('agent_hr','hr'), ('agent_personal','personal'), ('agent_it','it');

DECLARE @role sysname, @sch sysname, @sql nvarchar(max);
DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT role, sch FROM @own;
OPEN c; FETCH NEXT FROM c INTO @role, @sch;
WHILE @@FETCH_STATUS = 0
BEGIN
  SET @sql = N'GRANT SELECT, INSERT, UPDATE, EXECUTE ON SCHEMA::' + QUOTENAME(@sch) + N' TO ' + QUOTENAME(@role) + N';'
           + N'DENY DELETE ON SCHEMA::' + QUOTENAME(@sch) + N' TO ' + QUOTENAME(@role) + N';'
           -- shared tables: write-only log, create approvals and handoffs
           + N'GRANT INSERT ON core.agent_action_log TO ' + QUOTENAME(@role) + N';'
           + N'GRANT INSERT, SELECT ON core.approvals TO ' + QUOTENAME(@role) + N';'
           + N'GRANT INSERT, SELECT ON core.handoffs TO ' + QUOTENAME(@role) + N';'
           + N'GRANT UPDATE (status, status_reason, status_at) ON core.handoffs TO ' + QUOTENAME(@role) + N';';
  EXEC (@sql);
  FETCH NEXT FROM c INTO @role, @sch;
END
CLOSE c; DEALLOCATE c;
GO

-- Cross-schema reads (PERMISSIONS.md "Read" column). "Summary only" reads become
-- views in the owning schema during each agent's Phase 2; grant them here then.
GRANT SELECT ON client.clients TO agent_accounting, agent_tax, agent_bizdev,
                                  agent_document, agent_support;
GRANT SELECT ON document.v_document_metadata TO agent_client, agent_accounting, agent_tax;
GRANT SELECT ON SCHEMA::accounting TO agent_tax;

-- Audit: read-only on business schemas. HR and personal are excluded on purpose;
-- audit access to them is granted case by case through an approval.
GRANT SELECT ON SCHEMA::core       TO agent_audit;
GRANT SELECT ON SCHEMA::client     TO agent_audit;
GRANT SELECT ON SCHEMA::accounting TO agent_audit;
GRANT SELECT ON SCHEMA::tax        TO agent_audit;
GRANT SELECT ON SCHEMA::bizdev     TO agent_audit;
GRANT SELECT ON SCHEMA::social     TO agent_audit;
GRANT SELECT ON SCHEMA::document   TO agent_audit;
GRANT SELECT ON SCHEMA::support    TO agent_audit;
GRANT SELECT ON SCHEMA::security   TO agent_audit;
GRANT SELECT ON SCHEMA::it         TO agent_audit;

-- Security and IT read the action log.
GRANT SELECT ON core.agent_action_log TO agent_security, agent_it;

-- Orchestrator: routes handoffs, reads approvals, cannot decide them.
GRANT SELECT, INSERT ON core.handoffs TO agent_orchestrator;
GRANT UPDATE (status, status_reason, status_at) ON core.handoffs TO agent_orchestrator;
GRANT SELECT ON core.approvals TO agent_orchestrator;
GRANT INSERT ON core.agent_action_log TO agent_orchestrator;

-- Humans decide approvals. No agent role gets this.
GRANT SELECT ON core.approvals TO crm_approver;
GRANT UPDATE (approver, decision, decided_at, decision_note) ON core.approvals TO crm_approver;
GRANT INSERT ON core.agent_action_log TO crm_approver;

-- Personal Agent: own schema only. Explicitly blocked from business data.
DENY SELECT ON SCHEMA::client     TO agent_personal;
DENY SELECT ON SCHEMA::accounting TO agent_personal;
DENY SELECT ON SCHEMA::hr         TO agent_personal;
DENY SELECT ON SCHEMA::document   TO agent_personal;
GO

PRINT 'Baseline schema applied.';
