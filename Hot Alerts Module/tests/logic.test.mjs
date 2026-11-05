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

import { basedOnNote } from "../logic/alertLogic.js";
test("basedOnNote: thin data, plenty of data, nothing checked", () => {
  assert.equal(basedOnNote({ checked: 178, with_data: 6 }), "Based on 6 of 178 records with a date");
  assert.equal(basedOnNote({ checked: 230, with_data: 215 }), null);
  assert.equal(basedOnNote({ checked: 0, with_data: 0 }), "No records checked");
});

import { noteForCategories, modeConfirmText } from "../logic/alertLogic.js";
test("noteForCategories sums the matching rules and skips unscanned ones", () => {
  const cov = { rules: [
    { category: "Licence", checked: 100, with_data: 4 }, { category: "Visa & Emirates ID", checked: 78, with_data: 2 },
    { category: "Deadlines", checked: null, with_data: null }, { category: "Deadlines", checked: 10, with_data: 10 }] };
  assert.equal(noteForCategories(cov, ["Licence", "Visa & Emirates ID"]), "Based on 6 of 178 records with a date");
  assert.equal(noteForCategories(cov, ["Deadlines"]), null);
  assert.equal(noteForCategories(cov, ["Tax"]), null);
  assert.equal(noteForCategories(null, ["Licence"]), null);
});
test("modeConfirmText says who starts receiving what", () => {
  assert.match(modeConfirmText("Preview", "Triage"), /assigned to an alert start getting a bell.*Managers are not belled/);
  assert.match(modeConfirmText("Preview", "Live"), /managers start getting bells.*escalation starts/);
  assert.match(modeConfirmText("Triage", "Live"), /Managers start getting bells/);
  assert.match(modeConfirmText("Live", "Preview"), /Nobody will be belled/);
  assert.equal(modeConfirmText("Live", "Live"), null);
});

import { MANAGER_FILTERS, ALERT_PAGE, readAlertRows, appendAlertRows, resolvePlaceholder, PREVIEW_TEXT } from "../logic/alertLogic.js";
test("emptyText says the Centre is in preview to a non-admin, whatever the filter", () => {
  assert.equal(emptyText({ mode: "Preview", is_admin: false }, "All"), PREVIEW_TEXT);
  assert.equal(emptyText({ mode: "Preview", is_admin: false }, "Urgent"), PREVIEW_TEXT);
  assert.match(PREVIEW_TEXT, /preview/i);
});
test("emptyText keeps its usual words for an admin in Preview and for anyone after Preview", () => {
  assert.equal(emptyText({ mode: "Preview", is_admin: true }, "All"), "Nothing assigned to you");
  assert.equal(emptyText({ mode: "Live", is_admin: false }, "All"), "Nothing assigned to you");
  assert.equal(emptyText({ mode: "Triage", is_admin: false }, "Urgent"), "Nothing matches this filter");
});
test("managers get the Backlog filter on top of the usual ones", () => {
  assert.deepEqual(MANAGER_FILTERS, [...FILTERS, "Backlog"]);
  assert.equal(FILTERS.includes("Backlog"), false);
});
test("readAlertRows reads one page when one is wanted", async () => {
  const calls = [];
  const r = await readAlertRows(async (limit, offset) => { calls.push([limit, offset]); return { rows: [{ id: 1 }, { id: 2 }], total: 300 }; }, 2, 2);
  assert.deepEqual(calls, [[2, 0]]);
  assert.deepEqual(r, { rows: [{ id: 1 }, { id: 2 }], total: 300 });
});
test("readAlertRows reads as many pages as were on screen, so a reload keeps the list as long", async () => {
  const all = Array.from({ length: 5 }, (_, i) => ({ id: i }));
  const offsets = [];
  const r = await readAlertRows(async (limit, offset) => { offsets.push(offset); return { rows: all.slice(offset, offset + limit), total: 5 }; }, 4, 2);
  assert.deepEqual(offsets, [0, 2]);
  assert.equal(r.rows.length, 4);
  assert.equal(r.total, 5);
});
test("readAlertRows stops at a short page", async () => {
  let n = 0;
  const r = await readAlertRows(async () => { n += 1; return { rows: [{ id: 1 }], total: 1 }; }, 200, ALERT_PAGE);
  assert.equal(n, 1);
  assert.equal(r.rows.length, 1);
});
test("readAlertRows copes with an empty answer", async () => {
  assert.deepEqual(await readAlertRows(async () => null, 100, 100), { rows: [], total: 0 });
});
test("appendAlertRows adds new rows at the end and skips any already shown", () => {
  assert.deepEqual(appendAlertRows([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }]), [{ id: 1 }, { id: 2 }, { id: 3 }]);
  assert.deepEqual(appendAlertRows([], []), []);
});
test("the resolve placeholder says a Critical alert needs a note", () => {
  assert.match(resolvePlaceholder("Critical"), /required/i);
  assert.match(resolvePlaceholder("High"), /optional/i);
  assert.match(resolvePlaceholder(undefined), /optional/i);
});
