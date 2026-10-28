# Handoff Protocol

Agents never write into another agent's tables. They send a handoff.

## Envelope (JSON)
```json
{
  "handoff_id": "uuid",
  "correlation_id": "uuid",
  "from_agent": "AGT-01-CLIENT",
  "to_agent": "AGT-02-ACCOUNTING",
  "type": "billing_setup_request",
  "client_id": "uuid or null",
  "priority": "low | normal | high | urgent",
  "summary": "One sentence",
  "payload": {},
  "attachments": ["documents.id"],
  "requires_approval": false,
  "created_at": "UTC timestamp"
}
```

## Rules
- The Orchestrator validates `to_agent`, permissions, and payload schema before delivery.
- The receiving agent replies with `accepted`, `rejected` (with reason), or `needs_info`.
- Payload holds the minimum data needed. Restricted data (HR, identity documents) goes by reference only.
- Every handoff and reply is written to `agent_action_log` with the same `correlation_id`.
