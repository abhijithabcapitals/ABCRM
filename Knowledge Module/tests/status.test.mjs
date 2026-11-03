import test from "node:test";
import assert from "node:assert/strict";
import { isExpired, needsReview } from "../logic/status.js";

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
