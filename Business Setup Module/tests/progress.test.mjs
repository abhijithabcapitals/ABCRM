// Service checklists (022): labels, grouping and the client-side rules that mirror the server.
import test from "node:test";
import assert from "node:assert/strict";
import { caseBalance, groupByStage, needsNote, nextDue, nextStatuses, progressLabel } from "../logic/progress.js";

test("progressLabel: cancelled says Cancelled, a checklist shows its percentage, none shows the status", () => {
  assert.equal(progressLabel({ status: "Cancelled", progress: 40 }), "Cancelled");
  assert.equal(progressLabel({ status: "In progress", progress: 0 }), "0%");
  assert.equal(progressLabel({ status: "Not started", progress: null }), "Not started");
});

test("groupByStage keeps order, with and without stages", () => {
  const flat = [{ label: "a" }, { label: "b" }];
  assert.deepEqual(groupByStage(flat), [{ stage: null, items: flat }]);
  const staged = [{ label: "a", stage: "One" }, { label: "b", stage: "One" }, { label: "c", stage: "Two" }, { label: "d" }];
  assert.deepEqual(groupByStage(staged).map((g) => [g.stage, g.items.map((x) => x.label).join("")]), [["One", "ab"], ["Two", "c"], ["Other", "d"]]);
});

test("Not Applicable needs a reason; Reopened needs a note only from Completed", () => {
  assert.ok(needsNote("In Progress", "Not Applicable"));
  assert.ok(needsNote("Completed", "Reopened"));
  assert.equal(needsNote("Not Started", "Completed"), null);
});

test("Reopened is offered only from Completed; a signed-off item offers only Reopened", () => {
  assert.ok(!nextStatuses({ status: "In Progress" }).includes("Reopened"));
  assert.ok(nextStatuses({ status: "Completed" }).includes("Reopened"));
  assert.deepEqual(nextStatuses({ status: "Completed", verified_at: "2026-11-05" }), ["Completed", "Reopened"]);
});

test("caseBalance and nextDue", () => {
  assert.equal(caseBalance({ quote_total: 1000, net_paid: 400 }), 600);
  assert.equal(caseBalance({ quote_total: null }), null);
  assert.equal(nextDue({ services: [{ next_due: "2026-12-01" }, { next_due: null }, { next_due: "2026-11-20" }] }), "2026-11-20");
});
