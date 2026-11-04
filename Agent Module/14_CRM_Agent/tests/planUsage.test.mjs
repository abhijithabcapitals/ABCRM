import test from "node:test";
import assert from "node:assert/strict";
import { STALE_AFTER_MS, describeUsage } from "../components/planUsage.js";

const now = Date.parse("2026-11-04T14:00:00Z");
const reading = (over = {}) => ({
  plan: "Pro",
  reported_at: "2026-11-04T13:30:00Z",
  windows: [{ label: "5-hour limit", percent: 21, resets_at: "2026-11-04T17:40:00Z" }],
  ...over,
});

test("no reading gives null", () => {
  assert.equal(describeUsage(null, now), null);
});

test("a recent reading is not stale", () => {
  const u = describeUsage(reading(), now);
  assert.equal(u.stale, false);
  assert.equal(u.plan, "Pro");
  assert.deepEqual(u.windows[0], { label: "5-hour limit", percent: 21, resetsAt: "2026-11-04T17:40:00Z", hasReset: false });
});

test("stale only after 2 hours", () => {
  assert.equal(describeUsage(reading({ reported_at: new Date(now - STALE_AFTER_MS).toISOString() }), now).stale, false);
  assert.equal(describeUsage(reading({ reported_at: new Date(now - STALE_AFTER_MS - 1).toISOString() }), now).stale, true);
});

test("a bad report time counts as stale", () => {
  assert.equal(describeUsage(reading({ reported_at: "soon" }), now).stale, true);
});

test("a limit past its reset time is marked", () => {
  const u = describeUsage(reading({ windows: [{ label: "x", percent: 90, resets_at: "2026-11-04T13:59:00Z" }] }), now);
  assert.equal(u.windows[0].hasReset, true);
});

test("no reset time is not treated as reset", () => {
  const u = describeUsage(reading({ windows: [{ label: "x", percent: 5, resets_at: null }] }), now);
  assert.equal(u.windows[0].hasReset, false);
});

test("percent is kept within the bar", () => {
  const u = describeUsage(reading({ windows: [{ label: "a", percent: 140 }, { label: "b", percent: -3 }, { label: "c", percent: "x" }] }), now);
  assert.deepEqual(u.windows.map((w) => w.percent), [100, 0, 0]);
});

test("missing windows give an empty list", () => {
  assert.deepEqual(describeUsage(reading({ windows: null }), now).windows, []);
});
