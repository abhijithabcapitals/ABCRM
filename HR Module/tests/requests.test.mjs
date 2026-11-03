import test from "node:test";
import assert from "node:assert/strict";
import { REQUEST_KINDS, correctionValues, historyLine, insuranceEnd, mergeRequests, requestChoices, requestFields, requestSummary, unreturnedAssets } from "../logic/requests.js";

test("each request type asks for what the database needs", () => {
  const names = (c) => requestFields(c).map((f) => f.name);
  assert.deepEqual(names("wfh"), ["work_date", "note"]);
  assert.deepEqual(names("overtime"), ["work_date", "hours", "note"]);
  assert.deepEqual(names("reimbursement"), ["work_date", "amount", "note"]);
  assert.deepEqual(names("leave:abc"), ["from_date", "to_date", "note"]);
  assert.deepEqual(requestFields(""), []);
  assert.equal(REQUEST_KINDS.reimbursement.needsFile, true);
});
test("Other needs words, and other types do not", () => {
  assert.equal(requestFields("other")[0].required, true);
  assert.notEqual(requestFields("wfh").find((f) => f.name === "note").required, true);
});
test("requestChoices lists leave types first", () => {
  const c = requestChoices([{ id: "1", name: "Annual" }, { id: "2", name: "Sick" }]);
  assert.deepEqual(c.slice(0, 2).map((x) => x.label), ["Annual leave", "Sick leave"]);
  assert.equal(c.at(-1).value, "other");
  assert.equal(c.length, 2 + 6);
});
test("requestSummary says what was asked for", () => {
  const money = (n) => `AED ${n}`;
  assert.equal(requestSummary({ source: "request", kind: "wfh", work_date: "2026-11-03" }), "2026-11-03");
  assert.equal(requestSummary({ source: "request", kind: "overtime", work_date: "2026-11-03", hours: 2, amount: null }, money), "2026-11-03, 2 hours, amount not entered");
  assert.equal(requestSummary({ source: "request", kind: "overtime", work_date: "2026-11-03", hours: 2, amount: 120 }, money), "2026-11-03, 2 hours, AED 120");
  assert.equal(requestSummary({ source: "request", kind: "reimbursement", work_date: "2026-11-03", amount: 50 }, money), "2026-11-03, AED 50");
  assert.equal(requestSummary({ source: "leave", from_date: "2026-11-03", to_date: "2026-11-05", days: 3 }), "2026-11-03 to 2026-11-05, 3 days");
  assert.equal(requestSummary({ source: "request", kind: "other" }), "");
});
test("mergeRequests joins both lists, newest first, and asks who may decide leave", () => {
  const rows = mergeRequests(
    [{ id: "r", kind: "wfh", status: "pending", created_at: "2026-11-02", can_decide: true }],
    [{ id: "l", employee_id: "e", status: "pending", from_date: "2026-11-03", to_date: "2026-11-03", days: 1, created_at: "2026-11-03", hr_leave_types: { name: "Annual" }, hr_employees: { employee_code: "E", full_name: "A" } },
      { id: "m", employee_id: "me", status: "pending", created_at: "2026-11-01", hr_leave_types: { name: "Sick" } },
      { id: "n", employee_id: "e", status: "approved", created_at: "2026-10-01", hr_leave_types: { name: "Sick" } }],
    (l) => l.employee_id !== "me",
  );
  assert.deepEqual(rows.map((r) => r.id), ["l", "r", "m", "n"]);
  assert.equal(rows[0].title, "Annual leave");
  assert.equal(rows[1].title, "Work from home");
  assert.deepEqual(rows.map((r) => r.can_decide), [true, true, false, false]);
  assert.deepEqual(mergeRequests(null, null, () => true), []);
});
test("unreturnedAssets leaves out what came back", () => {
  assert.deepEqual(unreturnedAssets([{ id: 1, returned_on: null }, { id: 2, returned_on: "2026-01-01" }]).map((a) => a.id), [1]);
  assert.deepEqual(unreturnedAssets(null), []);
});
test("insuranceEnd is the day before the tenure runs out", () => {
  assert.equal(insuranceEnd("2026-01-01", 12), "2026-12-31");
  assert.equal(insuranceEnd("2026-03-15", 6), "2026-09-14");
  assert.equal(insuranceEnd("2026-08-31", 6), "2027-02-27");
  assert.equal(insuranceEnd("", 12), "");
  assert.equal(insuranceEnd("2026-01-01", ""), "");
});

test("correctionValues turns each choice into what the database needs", () => {
  assert.deepEqual(correctionValues({ choice: "annual", reason: "Unwell" }), { status: "Leave", timeIn: null, timeOut: null, useAnnual: true });
  assert.deepEqual(correctionValues({ choice: "wfh", reason: "x" }), { status: "WFH", timeIn: null, timeOut: null, useAnnual: false });
  assert.deepEqual(correctionValues({ choice: "timing", time_in: "9:30", time_out: "18:30" }), { status: "Present", timeIn: "09:30", timeOut: "18:30", useAnnual: false });
  assert.throws(() => correctionValues({ choice: "timing", time_in: "9:30" }), /login and logoff/);
  assert.throws(() => correctionValues({ choice: "timing", time_in: "9:30", time_out: "soon" }), /not a time/);
  assert.throws(() => correctionValues({}), /Choose/);
});
test("historyLine says what happened in plain words", () => {
  const e = (action, n, o) => ({ action, new_values: n, old_values: o });
  assert.equal(historyLine(e("attendance.edit_requested", { status: "WFH" }, { status: "Absent" })), "Asked: Absent to Work From Home");
  assert.equal(historyLine(e("attendance.edit_requested", { status: "Leave", use_annual: true }, { status: "Absent" })), "Asked: Absent to Annual leave");
  assert.equal(historyLine(e("attendance.edit_approved", { status: "Present", time_in: "09:30:00", time_out: "18:30:00" }, { status: "Absent" })), "Validated: Absent to Present 09:30-18:30");
  assert.equal(historyLine(e("attendance.edit_rejected", { status: "WFH" }, { status: "Absent" })), "Rejected: Absent to Work From Home");
  assert.equal(historyLine(e("attendance.updated", { status: "Present", time_in: "09:30:00", time_out: null }, { status: "Absent" })), "Changed: Absent to Present 09:30-?");
  assert.equal(historyLine(e("attendance.created", { status: "Absent" }, null)), "Changed: Nothing recorded to Absent");
});
