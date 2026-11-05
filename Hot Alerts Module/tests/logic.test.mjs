import test from "node:test";
import assert from "node:assert/strict";
import { tagFor, daysLabel, isNotSwitchedOn, PRIORITY_STYLES, FILTERS, emptyText } from "../logic/alertLogic.js";

test("Critical is Urgent", () => assert.equal(tagFor({ priority: "Critical", due_date: "2030-01-01" }, "2026-11-05"), "Urgent"));
test("High overdue is Urgent", () => assert.equal(tagFor({ priority: "High", due_date: "2026-11-01" }, "2026-11-05"), "Urgent"));
test("High due today is Action required", () => assert.equal(tagFor({ priority: "High", due_date: "2026-11-05" }, "2026-11-05"), "Action required"));
test("Medium in 30 days is Upcoming", () => assert.equal(tagFor({ priority: "Medium", due_date: "2026-12-05" }, "2026-11-05"), "Upcoming"));
test("High in 30 days is Upcoming", () => assert.equal(tagFor({ priority: "High", due_date: "2026-12-05" }, "2026-11-05"), "Upcoming"));
test("Medium in 7 days is Action required", () => assert.equal(tagFor({ priority: "Medium", due_date: "2026-11-12" }, "2026-11-05"), "Action required"));
test("Medium in 8 days is Upcoming", () => assert.equal(tagFor({ priority: "Medium", due_date: "2026-11-13" }, "2026-11-05"), "Upcoming"));
test("Medium overdue is Action required", () => assert.equal(tagFor({ priority: "Medium", due_date: "2026-11-01" }, "2026-11-05"), "Action required"));
test("Normal in 3 days has no tag", () => assert.equal(tagFor({ priority: "Normal", due_date: "2026-11-08" }, "2026-11-05"), null));
test("High with no date is Action required", () => assert.equal(tagFor({ priority: "High", due_date: null }, "2026-11-05"), "Action required"));

test("one day overdue is singular", () => assert.equal(daysLabel("2026-11-04", "2026-11-05"), "1 day overdue"));
test("three days overdue", () => assert.equal(daysLabel("2026-11-02", "2026-11-05"), "3 days overdue"));
test("due today", () => assert.equal(daysLabel("2026-11-05", "2026-11-05"), "Due today"));
test("12 days left", () => assert.equal(daysLabel("2026-11-17", "2026-11-05"), "12 days left"));
test("1 day left", () => assert.equal(daysLabel("2026-11-06", "2026-11-05"), "1 day left"));
test("no date", () => assert.equal(daysLabel(null, "2026-11-05"), "No date"));
test("timestamp due date is read by its date part", () => assert.equal(daysLabel("2026-11-04T00:00:00+00:00", "2026-11-05"), "1 day overdue"));

test("filters", () => assert.deepEqual(FILTERS, ["All", "Urgent", "Due Today", "Client Pending", "Government Pending"]));
test("four priority colours", () => assert.deepEqual(Object.keys(PRIORITY_STYLES), ["Critical", "High", "Medium", "Normal"]));

test("missing function is not switched on", () => {
  assert.equal(isNotSwitchedOn({ code: "42883" }), true);
  assert.equal(isNotSwitchedOn({ code: "PGRST202" }), true);
});
test("other errors are not 'not switched on'", () => {
  assert.equal(isNotSwitchedOn({ code: "42501", message: "x" }), false);
  assert.equal(isNotSwitchedOn(new Error("You do not have permission to view alerts.")), false);
  assert.equal(isNotSwitchedOn(null), false);
  assert.equal(isNotSwitchedOn(undefined), false);
});
test("error that carries a code on a wrapped cause", () => {
  const e = new Error("boom"); e.code = "42883";
  assert.equal(isNotSwitchedOn(e), true);
});

test("empty text in Preview for a non-admin", () => {
  assert.equal(emptyText({ mode: "Preview", is_admin: false }, "All"), "Nothing assigned to you");
});
test("empty text with a filter", () => {
  assert.equal(emptyText({ mode: "Live", is_admin: false }, "Urgent"), "Nothing matches this filter");
  assert.equal(emptyText({ mode: "Live", is_admin: false }, "All"), "Nothing assigned to you");
});

import { scanBand } from "../logic/alertLogic.js";
test("scanBand: Failed shows the band with the error", () => {
  assert.match(scanBand({ last_scan_status: "Failed", last_scan_error: "boom", stale: false }), /last scan failed: boom/);
});
test("scanBand: Ok is healthy", () => assert.equal(scanBand({ last_scan_status: "Ok", stale: false }), null));
test("scanBand: stale shows the band", () => assert.match(scanBand({ last_scan_status: "Ok", stale: true }), /26 hours/));
test("scanBand: null coverage", () => assert.equal(scanBand(null), null));
