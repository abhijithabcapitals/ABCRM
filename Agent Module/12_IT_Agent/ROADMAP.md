# IT Agent Roadmap

## Phase 0: Specification
- [ ] Confirm mission, boundaries, and approval list in CLAUDE.md
- [ ] Confirm owned tables and fields with IT Agent
- [ ] Add row to permission matrix (`..\00_Shared_Standards\PERMISSIONS.md`)

## Phase 1: Prompt development in Claude
- [ ] Draft system prompt from CLAUDE.md
- [ ] Run all TEST_PLAN.md cases against sample data
- [ ] Record failures and revise prompt

## Phase 2: Tool contracts
- [ ] Define tool functions (inputs, outputs, errors) for owned tables
- [ ] Define read-only views for read access
- [ ] Define handoff types this agent sends and receives

## Phase 3: Integration (test environment)
- [ ] Connect to test SQL database with least-privilege login
- [ ] Connect OneDrive access through Document Agent only
- [ ] Verify action logging end to end

## Phase 4: Pilot
- [ ] Run with human approval on every write
- [ ] Review action log weekly with Audit Agent
- [ ] Decide which actions can drop to approval-on-exception

## Phase 5: Production
- [ ] IT Agent deployment checklist complete
- [ ] Security Agent access review complete
- [ ] Update status in `..\AGENT_REGISTRY.json`
