import test from "node:test";
import assert from "node:assert/strict";
import { loadedPrivateValues, mergeReview, privateChanges, isExpired, needsReview, assertAllUpdated } from "../logic/status.js";

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

const LOADED = { id: "1", basis: "Study note", payee: "Authority", confidence: "Low" };

test("mergeReview adds the private columns by id and keeps lines it has no values for", () => {
  const merged = mergeReview([{ id: "1", item: "A" }, { id: "2", item: "B" }], [LOADED]);
  assert.deepEqual(merged[0], { id: "1", item: "A", basis: "Study note", payee: "Authority", confidence: "Low" });
  assert.deepEqual(merged[1], { id: "2", item: "B" });
  assert.equal(needsReview({ status: "Approved", visibility: "Shareable", ...merged[0] }), true);
});
test("mergeReview returns the lines as they are when the review failed to load", () => {
  assert.deepEqual(mergeReview([{ id: "1" }], null), [{ id: "1" }]);
});
test("loadedPrivateValues gives the row's values, blanks for a new row, and null when they are unknown", () => {
  assert.deepEqual(loadedPrivateValues({ id: "1" }, [LOADED]), LOADED);
  assert.deepEqual(loadedPrivateValues(null, null), { basis: null, payee: null, confidence: null });
  assert.equal(loadedPrivateValues({ id: "1" }, null), null);
  assert.equal(loadedPrivateValues({ id: "9" }, [LOADED]), null);
});
test("privateChanges sends nothing when the values were not loaded, even over blanks", () => {
  assert.deepEqual(privateChanges({ basis: "", payee: "", confidence: "" }, null), {});
  assert.deepEqual(privateChanges({ basis: "Typed", payee: "Typed", confidence: "High" }, null), {});
});
test("privateChanges sends only the fields that changed", () => {
  assert.deepEqual(privateChanges({ basis: " Study note ", payee: "Authority", confidence: "Low" }, LOADED), {});
  assert.deepEqual(privateChanges({ basis: "New note", payee: "Authority", confidence: "Low" }, LOADED), { basis: "New note" });
});
test("privateChanges lets an admin clear a loaded value on purpose, and treats untouched blanks as unchanged", () => {
  assert.deepEqual(privateChanges({ basis: "", payee: "Authority", confidence: "Low" }, LOADED), { basis: null });
  assert.deepEqual(privateChanges({ basis: "", payee: "", confidence: "" }, { basis: null, payee: null, confidence: null }), {});
});
