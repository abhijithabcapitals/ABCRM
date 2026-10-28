# CRM AI Agent System

Specifications for 12 CRM agents plus an Orchestrator. These are design documents, not working integrations.

## Layout
- `SYSTEM_ARCHITECTURE.md`: components, request flow, open decisions
- `AGENT_REGISTRY.json`: agent IDs, folders, owned tables, status
- `00_Shared_Standards\`: rules every agent follows (operating rules, data contracts, handoffs, permissions)
- `NN_<Agent>\CLAUDE.md`: role, boundaries, approvals, handoffs
- `NN_<Agent>\ROADMAP.md`: phased development checklist
- `NN_<Agent>\TEST_PLAN.md`: test cases to run before integration

## How to develop an agent
1. Open the agent folder in Claude Code. CLAUDE.md loads as context.
2. Work through ROADMAP.md phase by phase.
3. Run TEST_PLAN.md cases against sample data only.
4. Update status in AGENT_REGISTRY.json.

## Regenerating
The setup script only creates missing files. Edited files are never overwritten.
