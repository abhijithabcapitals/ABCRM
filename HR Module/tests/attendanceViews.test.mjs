import test from "node:test";
import assert from "node:assert/strict";
import { SHORT, STATUSES, editFormNote, groupRange, periodRange, shiftPeriod, statusLabel, weekDays, yearDays } from "../logic/attendance.js";

test("WFH is a status with a short form", () => {
  assert.ok(STATUSES.includes("WFH"));
  assert.equal(SHORT.WFH, "WH");
});
test("weekDays runs Monday to Sunday around any date", () => {
  const w = weekDays("2026-11-04");
  assert.equal(w.length, 7);
  assert.equal(w[0], "2026-11-02");
  assert.equal(w[6], "2026-11-08");
  assert.equal(weekDays("2026-11-08")[0], "2026-11-02");
  assert.equal(weekDays("2026-11-09")[0], "2026-11-09");
});
test("yearDays covers a leap year", () => {
  assert.equal(yearDays(2028).length, 366);
  assert.equal(yearDays(2026)[0], "2026-01-01");
  assert.equal(yearDays(2026).at(-1), "2026-12-31");
});
test("periodRange gives each period's first and last day", () => {
  assert.deepEqual(periodRange("day", "2026-02-10"), { from: "2026-02-10", to: "2026-02-10" });
  assert.deepEqual(periodRange("week", "2026-02-10"), { from: "2026-02-09", to: "2026-02-15" });
  assert.deepEqual(periodRange("month", "2026-02-10"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(periodRange("year", "2026-02-10"), { from: "2026-01-01", to: "2026-12-31" });
});
test("shiftPeriod moves by a whole period and never skips a short month", () => {
  assert.equal(shiftPeriod("day", "2026-03-01", -1), "2026-02-28");
  assert.equal(shiftPeriod("week", "2026-02-10", 1), "2026-02-17");
  assert.equal(shiftPeriod("month", "2026-01-31", 1).slice(0, 7), "2026-02");
  assert.equal(shiftPeriod("year", "2028-02-29", 1).slice(0, 4), "2029");
});
test("groupRange counts a late Present day under Present and Late", () => {
  const [p] = groupRange([
    { employee_id: "a", employee_code: "E1", full_name: "A", work_date: "2026-10-05", status: "Present", late_minutes: 5, overtime_minutes: 0 },
    { employee_id: "a", employee_code: "E1", full_name: "A", work_date: "2026-10-06", status: "Present", late_minutes: 0, overtime_minutes: 20 },
    { employee_id: "a", employee_code: "E1", full_name: "A", work_date: "2026-10-07", status: "Absent", late_minutes: 0, overtime_minutes: 0 },
  ]);
  assert.equal(p.counts.Present, 2);
  assert.equal(p.counts.Absent, 1);
  assert.equal(p.counts.Late, 1);
  assert.equal(p.counts.Overtime, 1);
});
test("statusLabel names leave kinds and the weekly off", () => {
  assert.equal(statusLabel({ status: "Leave", leave_kind: "Unpaid" }), "On Leave (Unpaid)");
  assert.equal(statusLabel({ status: "Leave", leave_kind: "Annual" }), "On Leave (Annual)");
  assert.equal(statusLabel({ status: "Weekend" }), "Weekly Off");
  assert.equal(statusLabel({ status: "WFH" }), "Work From Home");
  assert.equal(statusLabel({ status: null }), "Nothing recorded");
});
test("editFormNote says whether a save applies now or waits", () => {
  assert.match(editFormNote(true), /applies now/i);
  assert.match(editFormNote(false), /approval/i);
});
