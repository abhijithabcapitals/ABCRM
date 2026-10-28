# System Architecture

## Components
- **CRM AI Orchestrator** (AGT-00): routes tasks, enforces permissions, delivers handoffs, tracks results.
- **12 specialist agents**, grouped:
- **Client & Support**: Client Agent, Support Agent, Personal Agent
- **Finance & Assurance**: Accounting Agent, Tax Agent, Audit Agent
- **Growth & People**: Business Development Agent, Social Media Agent, Human Resource Agent
- **Technology & Records**: Document Agent, Security Agent, IT Agent
- **SQL database (Microsoft SQL Server)**: structured records, relationships, permissions, approvals, and the action log. One schema and one database role per agent; baseline in `00_Shared_Standards\sql\001_baseline_schema.sql`.
- **OneDrive / SharePoint**: client folders, contracts, invoices, reports, and supporting documents. Accessed only through Document Agent via Microsoft Graph, using an app-only Entra app limited by `Sites.Selected` to the client-files site.

## Request flow
1. User or trigger sends a request to the Orchestrator.
2. Orchestrator picks the owning agent from AGENT_REGISTRY.json.
3. Agent acts within its grants in 00_Shared_Standards\PERMISSIONS.md.
4. Approval-required actions go to the `approvals` table and wait.
5. Cross-domain work goes through HANDOFF_PROTOCOL.md envelopes.
6. Every step is logged to `agent_action_log`.

## Integration with the existing CRM
- Existing CRM tables stay as they are. Agents never alter or drop them.
- Agents read existing data through views in their own schema (adapter layer). Column renames and type changes happen in the view, not the CRM.
- Agent writes to existing CRM data go through the CRM's own stored procedures or API where they exist, so CRM business rules still run.
- New agent-only data (action log, approvals, handoffs, agent working tables) lives in the new schemas.
- Order of work:
  1. Run `00_Shared_Standards\sql\000_discover_existing_schema.sql` (read-only) and save the results.
  2. Map each agent's owned tables to existing CRM tables, or mark them as new.
  3. Adjust `001_baseline_schema.sql` (anchor tables become views) and apply it in a test copy of the CRM database.

## Open decisions
- [x] SQL engine: Microsoft SQL Server
- [x] CRM state: already built; agents are added to it
- [x] OneDrive location: Microsoft 365 cloud. Design in `00_Shared_Standards\ONEDRIVE_INTEGRATION.md`
- [ ] Agent runtime (Claude API with tool use, Claude Agent SDK, other)
- [ ] Secret store (Azure Key Vault, Windows Credential Manager, other)
