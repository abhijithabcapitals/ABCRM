// node --test "Template Module/tests/proposalReplies.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { replyBy, replyHistory, replyLabel, replyProblem, replyState, replyTone, sharedOptionRows, sharedVia } from "../logic/proposalReplies.js";

const options = [{ authority_key: "zone-a", authority_name: "Zone A" }, { authority_key: "zone-b" }];
const doc = (o = {}) => ({ id: "p1", status: "issued", client_id: null, mail_sent_at: null, field_values: { proposal: { options, accepted_option: null } }, ...o });

test("labels name the option and the decision", () => {
  assert.equal(replyLabel({ kind: "option", option_index: 1 }, options), "Chose Option 2 (zone-b)");
  assert.equal(replyLabel({ kind: "accepted", option_index: 0 }, options), "Accepted Option 1 (Zone A)");
  assert.equal(replyLabel({ kind: "declined" }, options), "Declined");
  assert.equal(replyLabel({ kind: "comment", comment: "x" }, options), "Comment");
  assert.equal(replyLabel({ decision: "Rejected" }, options), "Declined");
  assert.equal(replyTone({ decision: "Accepted" }), "good");
  assert.equal(replyTone({ kind: "declined" }), "bad");
  assert.equal(replyBy({ source: "Portal" }), "Client, in the portal");
  assert.equal(replyBy({ source: "Staff" }), "Recorded in the CRM");
});

test("history merges the proposal's replies and decisions, oldest first, and leaves other proposals out", () => {
  const replies = [
    { id: "r2", quote_id: "p1", kind: "comment", comment: "Call Sunday", source: "Portal", created_at: "2026-11-07T10:00:00Z" },
    { id: "r1", quote_id: "p1", kind: "option", option_index: 1, source: "Portal", created_at: "2026-11-07T09:00:00Z" },
    { id: "r9", quote_id: "p2", kind: "declined", source: "Staff", created_at: "2026-11-07T08:00:00Z" },
  ];
  const decisions = [{ id: "a1", document_id: "p1", decision: "Accepted", source: "Portal", created_at: "2026-11-07T11:00:00Z" }];
  const h = replyHistory("p1", replies, decisions);
  assert.deepEqual(h.map((e) => e.id), ["r1", "r2", "a1"]);
  const s = replyState(doc({ field_values: { proposal: { options, accepted_option: 1 } } }), h);
  assert.equal(s.latest.id, "a1", "a decision wins");
  assert.equal(s.comment.id, "r2");
  assert.equal(s.chosen, 1);
  assert.equal(s.count, 3);
});

test("without a decision the latest choice stays in view after a comment", () => {
  const h = replyHistory("p1", [
    { id: "r1", quote_id: "p1", kind: "option", option_index: 0, source: "Staff", created_at: "1" },
    { id: "r2", quote_id: "p1", kind: "comment", comment: "later", source: "Staff", created_at: "2" },
  ], []);
  assert.equal(replyState(doc(), h).latest.id, "r1");
  assert.equal(replyState(doc(), []).latest, null);
  assert.equal(replyState(doc(), []).chosen, null);
});

test("a proposal is shared by mail, by the portal (it has a client), or both", () => {
  assert.deepEqual(sharedVia(doc()), []);
  assert.deepEqual(sharedVia(doc({ mail_sent_at: "2026-11-07" })), ["mail"]);
  assert.deepEqual(sharedVia(doc({ client_id: "CL1" })), ["portal"]);
  assert.deepEqual(sharedVia(doc({ client_id: "CL1", status: "superseded" })), []);
  assert.deepEqual(sharedVia(doc({ client_id: "CL1", mail_sent_at: "x" })), ["mail", "portal"]);
});

test("one row per option of every shared proposal, a lead's mailed proposal included", () => {
  const rows = sharedOptionRows([doc({ id: "lead", mail_sent_at: "x" }), doc({ id: "unsent" }), doc({ id: "client", client_id: "CL1" })]);
  assert.deepEqual(rows.map((r) => r.key), ["lead-0", "lead-1", "client-0", "client-1"]);
  assert.equal(rows[0].first, true);
  assert.equal(rows[1].first, false);
});

test("the reply dialog checks what each reply needs", () => {
  assert.equal(replyProblem("option", "", "", 2), "Choose the option.");
  assert.equal(replyProblem("accepted", "", "", 2), "Choose the option.");
  assert.equal(replyProblem("accepted", "", "", 1), null, "one option: no choice needed");
  assert.equal(replyProblem("comment", "", " ", 2), "Write the comment.");
  assert.equal(replyProblem("declined", "", "", 2), null);
  assert.equal(replyProblem("maybe", "", "", 2), "Choose the reply.");
  assert.equal(replyProblem("comment", "", "x".repeat(1001), 2), "Keep the comment to 1000 characters.");
});
