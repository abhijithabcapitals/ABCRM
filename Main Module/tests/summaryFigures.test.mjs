import test from "node:test";
import assert from "node:assert/strict";
import {
  bdFigures, bankingFigures, setupFigures, accountingFigures, hrFigures, taxFigures, notificationFigures, alertFigures, alertsInPreview, isMissingFunction, readPages, PAGE_SIZE, NOTIFICATION_LIMIT, isNoAccess, snapshotState, fmtRatio, refreshWaitMinutes, isMissingTable, failureNote, RATE_LIMIT_MESSAGES,
} from "../../Dashboard Module/logic/summaryFigures.js";

const rows = (n, stage = "New", status = "active") => Array.from({ length: n }, () => ({ stage, status }));

test("bdFigures caps the total at 500", () => {
  assert.equal(bdFigures(rows(500), ["New"]).total, "500+");
  assert.equal(bdFigures(rows(3), ["New"]).total, 3);
});
test("bdFigures counts per stage and puts unknown stages under Other", () => {
  const r = bdFigures([...rows(2), ...rows(1, "Odd")], ["New", "Won"]);
  assert.deepEqual(r.stages, [{ label: "New", value: 2 }, { label: "Won", value: 0 }, { label: "Other", value: 1 }]);
});
test("bdFigures counts open leads only, as the screen does, in the total and the stages", () => {
  const r = bdFigures([...rows(2), ...rows(1, "New", "won"), ...rows(1, "Odd", "lost")], ["New"]);
  assert.equal(r.total, 2);
  assert.deepEqual(r.stages, [{ label: "New", value: 2 }]);
});
test("bdFigures says 500+ when the read was cut off, even if some of those leads are closed", () => {
  assert.equal(bdFigures([...rows(499), ...rows(1, "New", "lost")], ["New"]).total, "500+");
  assert.equal(bdFigures([...rows(498), ...rows(1, "New", "lost")], ["New"]).total, 498);
});

test("readPages reads until a short page, and asks for each range", async () => {
  const asked = [];
  const sizes = [PAGE_SIZE, PAGE_SIZE, 3];
  const out = await readPages(async (from, to) => {
    asked.push([from, to]);
    return Array.from({ length: sizes[asked.length - 1] }, (_, i) => from + i);
  });
  assert.equal(out.length, 2 * PAGE_SIZE + 3);
  assert.deepEqual(asked, [[0, 999], [1000, 1999], [2000, 2999]]);
  assert.equal(out[PAGE_SIZE], PAGE_SIZE);
});
test("readPages stops after an exactly full last page and an empty one", async () => {
  let calls = 0;
  const out = await readPages(async () => (++calls === 1 ? Array(PAGE_SIZE).fill(1) : []));
  assert.equal(out.length, PAGE_SIZE);
  assert.equal(calls, 2);
});
test("readPages passes a failure up, never a short total", async () => {
  await assert.rejects(readPages(async () => { throw new Error("no"); }), /no/);
});
test("accountingFigures totals rows past the 1,000 cap", async () => {
  const pages = [Array(PAGE_SIZE).fill({ balance: 2 }), [{ balance: 5 }]];
  const r = accountingFigures(await readPages(async () => pages.shift()));
  assert.equal(r.balanceDue, 2 * PAGE_SIZE + 5);
});

test("bankingFigures uses the banking dashboard labels", () => {
  const r = bankingFigures({ cards: { total_leads: 4, documents_pending: 2, submitted: 1, approved: 0 }, alerts: { lead_followups: 3 }, finance: { collected: 9 } });
  assert.deepEqual(r.cards, [
    { label: "Total Leads Received", value: 4 }, { label: "Documents Pending", value: 2 },
    { label: "Applications Submitted", value: 1 }, { label: "Accounts Approved", value: 0 },
  ]);
  assert.equal(r.alerts.length, 10);
  assert.deepEqual(r.alerts[0], { label: "Leads requiring follow-up", value: 3 });
  assert.deepEqual(r.finance, { collected: 9 });
});

test("setupFigures reads the setup dashboard", () => {
  const r = setupFigures({ forms_waiting: 2, open_quotes: 3, accepted_without_letter: 1, outstanding: 50, active_services: 7, expiries: { upcoming: 4, past: 5 } });
  assert.deepEqual(r, { forms: 2, openQuotes: 3, noLetter: 1, outstanding: 50, activeServices: 7, expiringUpcoming: 4, expiringPast: 5 });
});

test("accountingFigures sums only positive balances", () => {
  const r = accountingFigures([
    { work_status: "Open", balance: 100, follow_up_due: true, needs_invoice: false },
    { work_status: "Open", balance: -20, follow_up_due: false, needs_invoice: true },
    { work_status: "Done", balance: null },
  ]);
  assert.equal(r.balanceDue, 100);
  assert.equal(r.followUpsDue, 1);
  assert.equal(r.needInvoice, 1);
  assert.deepEqual(r.byStatus, [{ label: "Open", value: 2 }, { label: "Done", value: 1 }]);
});

test("hrFigures reads the hr dashboard", () => {
  assert.deepEqual(hrFigures({ headcount: 12, pending_leave: 2, expiring_documents: 3 }), { headcount: 12, pendingLeave: 2, expiringDocuments: 3 });
});

test("taxFigures maps the compliance summary", () => {
  const r = taxFigures({ clientsChecked: 9, summary: { overdue: 1, due_14: 2, due_30: 3, missing: 4 } });
  assert.deepEqual(r, { overdue: 1, due14: 2, due30: 3, missing: 4, clients: 9 });
});

test("notificationFigures counts unread and keeps the first five", () => {
  const list = Array.from({ length: 7 }, (_, i) => ({ id: i, read: i >= 2 }));
  const r = notificationFigures(list);
  assert.equal(r.unread, 2);
  assert.equal(r.latest.length, 5);
});

test("notificationFigures says 50+ when all 50 rows read are unread", () => {
  const unread = (n) => Array.from({ length: n }, (_, i) => ({ id: i, read: false }));
  assert.equal(NOTIFICATION_LIMIT, 50);
  assert.equal(notificationFigures(unread(50)).unread, "50+");
  assert.equal(notificationFigures(unread(49)).unread, 49);
  assert.equal(notificationFigures([...unread(49), { id: 99, read: true }]).unread, 49);
});

test("isNoAccess is true only for permission denied", () => {
  assert.equal(isNoAccess({ code: "42501" }), true);
  assert.equal(isNoAccess({ code: "PGRST116" }), false);
  assert.equal(isNoAccess(null), false);
});

test("empty input gives zeros, not a throw", () => {
  assert.deepEqual(bdFigures([], ["New"]), { total: 0, stages: [{ label: "New", value: 0 }] });
  assert.deepEqual(bdFigures(null, null), { total: 0, stages: [] });
  assert.equal(bankingFigures(null).cards.every((c) => c.value === 0), true);
  assert.equal(bankingFigures(null).finance, null);
  assert.deepEqual(setupFigures(null), { forms: 0, openQuotes: 0, noLetter: 0, outstanding: 0, activeServices: 0, expiringUpcoming: 0, expiringPast: 0 });
  assert.deepEqual(accountingFigures(null), { byStatus: [], followUpsDue: 0, needInvoice: 0, balanceDue: 0 });
  assert.deepEqual(hrFigures(null), { headcount: 0, pendingLeave: 0, expiringDocuments: 0 });
  assert.deepEqual(taxFigures(null), { overdue: 0, due14: 0, due30: 0, missing: 0, clients: 0 });
  assert.deepEqual(notificationFigures(null), { unread: 0, latest: [] });
});

const NOW = Date.parse("2026-11-04T10:00:00Z");
const minutesAgo = (m) => new Date(NOW - m * 60_000).toISOString();

test("snapshotState: no as_of is empty, 359 minutes is fresh, 361 is stale", () => {
  assert.equal(snapshotState(null, NOW), "empty");
  assert.equal(snapshotState({ as_of: null, status: "ok" }, NOW), "empty");
  assert.equal(snapshotState({ as_of: minutesAgo(359), status: "ok" }, NOW), "fresh");
  assert.equal(snapshotState({ as_of: minutesAgo(361), status: "ok" }, NOW), "stale");
  assert.equal(snapshotState({ as_of: minutesAgo(5), status: "partial" }, NOW), "fresh");
});

test("snapshotState: a failed refresh with old data is failed", () => {
  assert.equal(snapshotState({ as_of: minutesAgo(600), status: "failed", error: "x" }, NOW), "failed");
  assert.equal(snapshotState({ as_of: null, status: "failed" }, NOW), "empty");
});

test("fmtRatio shows n/a for unknown and two decimals otherwise", () => {
  assert.equal(fmtRatio(null), "n/a");
  assert.equal(fmtRatio(undefined), "n/a");
  assert.equal(fmtRatio(1.234), "1.23");
  assert.equal(fmtRatio(0), "0.00");
});

test("refreshWaitMinutes: after a rate-limit message the wait is 15 minutes", () => {
  for (const error of RATE_LIMIT_MESSAGES) {
    assert.equal(refreshWaitMinutes({ as_of: minutesAgo(600), last_attempt_at: minutesAgo(10), error }, NOW), 5, error);
    assert.equal(refreshWaitMinutes({ as_of: minutesAgo(600), last_attempt_at: minutesAgo(15), error }, NOW), 0, error);
  }
  assert.equal(refreshWaitMinutes({ as_of: minutesAgo(600), last_attempt_at: minutesAgo(10), error: "Zoho refused the request." }, NOW), 0);
  // The same list is pinned in zoho-finance/refresh.test.ts.
  assert.deepEqual(RATE_LIMIT_MESSAGES, [
    "Zoho is busy, try again shortly.",
    "Zoho is limiting requests, so some figures are incomplete. Refresh again in a few minutes.",
    "Zoho is limiting requests. Refresh again in a few minutes.",
  ]);
});

test("refreshWaitMinutes: Refresh waits 5 minutes from the last figures or attempt", () => {
  assert.equal(refreshWaitMinutes(null, NOW), 0);
  assert.equal(refreshWaitMinutes({ as_of: minutesAgo(10), last_attempt_at: minutesAgo(10) }, NOW), 0);
  assert.equal(refreshWaitMinutes({ as_of: minutesAgo(1), last_attempt_at: minutesAgo(1) }, NOW), 4);
  assert.equal(refreshWaitMinutes({ as_of: minutesAgo(400), last_attempt_at: minutesAgo(2.5) }, NOW), 3);
});

test("failureNote: shows the error for a first-ever failure, and says there are no earlier figures", () => {
  assert.equal(failureNote(null), null);
  assert.equal(failureNote({ as_of: minutesAgo(5), status: "ok", error: null }), null);
  assert.equal(failureNote({ as_of: null, status: "failed", error: "Zoho did not answer." }), "Zoho did not answer. There are no earlier figures.");
  assert.equal(failureNote({ as_of: null, status: "failed", error: null }), "The last refresh failed. There are no earlier figures.");
  assert.equal(failureNote({ as_of: minutesAgo(600), status: "failed", error: "x" }), "x The figures below are from the last good refresh.");
});

test("isMissingTable recognises a missing table and nothing else", () => {
  assert.equal(isMissingTable({ code: "42P01" }), true);
  assert.equal(isMissingTable({ code: "PGRST205" }), true);
  assert.equal(isMissingTable({ code: "42501" }), false);
  assert.equal(isMissingTable(null), false);
});

test("alertFigures reads the six tile counts, missing keys as 0", () => {
  assert.equal(alertFigures({ overdue: 2 }).renewals, 0);
  assert.equal(alertFigures({ overdue: 2 }).overdue, 2);
  assert.equal(alertFigures(null).overdue, 0);
  assert.deepEqual(alertFigures({ overdue: 1, upcoming: 2, documents: 3, authority: 4, renewals: 5, unassigned: 6, backlog: 9 }),
    { overdue: 1, upcoming: 2, documents: 3, authority: 4, renewals: 5, unassigned: 6, mode: null });
});
test("isMissingFunction is true for a function not in the schema", () => {
  assert.equal(isMissingFunction({ code: "PGRST202" }), true);
  assert.equal(isMissingFunction({ code: "42883" }), true);
  assert.equal(isMissingFunction({ code: "42501" }), false);
  assert.equal(isMissingFunction(null), false);
});
test("alertFigures carries the mode", () => {
  assert.equal(alertFigures({ mode: "Preview" }).mode, "Preview");
});
test("alertsInPreview is true for everyone in Preview, and only then", () => {
  assert.equal(alertsInPreview({ mode: "Preview" }), true);
  assert.equal(alertsInPreview({ mode: "Triage" }), false);
  assert.equal(alertsInPreview({ mode: "Live" }), false);
  assert.equal(alertsInPreview({}), false);
});
