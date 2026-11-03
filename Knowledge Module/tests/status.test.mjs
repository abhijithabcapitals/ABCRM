import test from "node:test";
import assert from "node:assert/strict";
import { isExpired, needsReview, assertAllUpdated } from "../logic/status.js";

test("isExpired: null false; today false; yesterday true", () => {
  assert.equal(isExpired(null, "2026-11-03"), false);
  assert.equal(isExpired(undefined, "2026-11-03"), false);
  assert.equal(isExpired("2026-11-03", "2026-11-03"), false);
  assert.equal(isExpired("2026-11-02", "2026-11-03"), true);
  assert.equal(isExpired("2026-11-04", "2026-11-03"), false);
});
test("needsReview: true for Draft, Internal or Low confidence; false for Approved Shareable High", () => {
  const ok = { status: "Approved", visibility: "Shareable", confidence: "High" };
  assert.equal(needsReview(ok), false);
  assert.equal(needsReview({ ...ok, status: "Draft" }), true);
  assert.equal(needsReview({ ...ok, visibility: "Internal" }), true);
  assert.equal(needsReview({ ...ok, confidence: "Low" }), true);
});
test("needsReview works for entries, which have no confidence", () => {
  assert.equal(needsReview({ status: "Approved", visibility: "Shareable" }), false);
  assert.equal(needsReview({ status: "Draft", visibility: "Shareable" }), true);
});

test("assertAllUpdated: passes when every row came back; throws on some or none", () => {
  const rows = [{ id: "a" }, { id: "b" }];
  assert.equal(assertAllUpdated(rows, ["a", "b"], "Approved"), rows);
  assert.equal(assertAllUpdated([{ id: "a" }], "a", "Approved").length, 1);
  assert.throws(() => assertAllUpdated([{ id: "a" }], ["a", "b"], "Approved"), /Approved 1 of 2 rows \(not permitted or not found\)/);
  assert.throws(() => assertAllUpdated([], ["a", "b"], "Changed visibility of"), /0 of 2 rows/);
  assert.throws(() => assertAllUpdated(null, ["a"], "Approved"), /0 of 1 rows/);
});

import { groupCopyItem } from "../logic/status.js";

test("groupCopyItem ignores Internal lines when deciding Shareable and Draft", () => {
  const l = (status, visibility) => ({ status, visibility });
  assert.deepEqual(groupCopyItem([l("Draft", "Internal"), l("Approved", "Internal")]), { visibility: "Internal", status: "Approved" });
  assert.deepEqual(groupCopyItem([l("Draft", "Internal"), l("Approved", "Shareable")]), { visibility: "Shareable", status: "Approved" });
  assert.deepEqual(groupCopyItem([l("Approved", "Shareable"), l("Draft", "Shareable")]), { visibility: "Shareable", status: "Draft" });
  assert.deepEqual(groupCopyItem([]), { visibility: "Internal", status: "Approved" });
});

import { groupDisplayStatus } from "../logic/status.js";

test("groupDisplayStatus is Draft when any line is Draft, even if all are Internal", () => {
  const l = (status, visibility) => ({ status, visibility });
  assert.equal(groupDisplayStatus([l("Draft", "Internal"), l("Draft", "Internal")]), "Draft");
  assert.equal(groupDisplayStatus([l("Approved", "Shareable"), l("Draft", "Internal")]), "Draft");
  assert.equal(groupDisplayStatus([l("Approved", "Shareable"), l("Approved", "Internal")]), "Approved");
});
