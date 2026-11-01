import test from "node:test";
import assert from "node:assert/strict";
import { monthDays, shiftMonth, groupMonth, canEditDay, parseTime, dubaiToday } from "../logic/attendance.js";

test("monthDays gives every date of the month, leap year included", () => {
  assert.equal(monthDays(2025, 2).length, 28);
  assert.equal(monthDays(2024, 2).length, 29);
  assert.deepEqual(monthDays(2025, 3).slice(0, 2), ["2025-03-01", "2025-03-02"]);
  assert.equal(monthDays(2025, 12).at(-1), "2025-12-31");
});
test("shiftMonth rolls over year ends", () => {
  assert.deepEqual(shiftMonth(2025, 12, 1), { year: 2026, month: 1 });
  assert.deepEqual(shiftMonth(2025, 1, -1), { year: 2024, month: 12 });
  assert.deepEqual(shiftMonth(2025, 6, 0), { year: 2025, month: 6 });
});
test("groupMonth makes one line per employee keyed by date", () => {
  const rows = [
    { employee_id: "a", employee_code: "E1", full_name: "A", work_date: "2025-03-01", status: "Weekend" },
    { employee_id: "a", employee_code: "E1", full_name: "A", work_date: "2025-03-03", status: "Present", time_in: "09:00:00", time_out: null },
    { employee_id: "b", employee_code: "E2", full_name: "B", work_date: "2025-03-03", status: null },
  ];
  const g = groupMonth(rows);
  assert.equal(g.length, 2);
  assert.equal(g[0].employee_code, "E1");
  assert.equal(g[0].days["2025-03-03"].status, "Present");
  assert.deepEqual(g[0].counts, { Present: 1, Absent: 0, Leave: 0, Holiday: 0, Weekend: 1 });
  assert.equal(g[1].days["2025-03-03"].status, null);
});
test("canEditDay follows the database rules", () => {
  const today = "2025-03-10";
  assert.equal(canEditDay({ role: "hr", myId: "m", employeeId: "m", date: "2025-03-09", today }), true, "HR may set their own");
  assert.equal(canEditDay({ role: "manager", myId: "m", employeeId: "r", date: "2025-03-09", today }), true);
  assert.equal(canEditDay({ role: "manager", myId: "m", employeeId: "m", date: "2025-03-09", today }), false, "manager not own");
  assert.equal(canEditDay({ role: "employee", myId: "e", employeeId: "e", date: "2025-03-09", today }), false);
  assert.equal(canEditDay({ role: "hr", myId: "m", employeeId: "x", date: "2025-03-11", today }), false, "future");
  assert.equal(canEditDay({ role: "hr", myId: "m", employeeId: "x", date: "2025-03-10", today }), true, "today");
});
test("canEditDay: a Left employee with no exit date cannot be edited, one with an exit date only up to it", () => {
  const base = { role: "hr", myId: "m", employeeId: "x", today: "2025-03-10" };
  assert.equal(canEditDay({ ...base, date: "2025-03-05", employeeStatus: "Left", exitDate: null }), false);
  assert.equal(canEditDay({ ...base, date: "2025-03-05", employeeStatus: "Left", exitDate: "2025-03-06" }), true);
  assert.equal(canEditDay({ ...base, date: "2025-03-07", employeeStatus: "Left", exitDate: "2025-03-06" }), false);
  assert.equal(canEditDay({ ...base, date: "2025-03-07", employeeStatus: "Active", exitDate: "2025-03-06" }), false, "past exit, not Left");
  assert.equal(canEditDay({ ...base, date: "2025-03-07", employeeStatus: "Active", exitDate: null }), true);
  assert.equal(canEditDay({ ...base, role: "manager", date: "2025-03-05", employeeStatus: "Left", exitDate: null }), false);
});
test("groupMonth keeps the employee status and exit date", () => {
  const g = groupMonth([{ employee_id: "a", employee_code: "E1", full_name: "A", work_date: "2025-03-01", status: null, employee_status: "Left", exit_date: null }]);
  assert.equal(g[0].employee_status, "Left");
  assert.equal(g[0].exit_date, null);
});
test("parseTime accepts HH:MM, blank is null, anything else throws", () => {
  assert.equal(parseTime(""), null);
  assert.equal(parseTime(null), null);
  assert.equal(parseTime(" 9:05 "), "09:05");
  assert.equal(parseTime("18:30"), "18:30");
  assert.equal(parseTime("09:00:00"), "09:00");
  assert.throws(() => parseTime("25:00"));
  assert.throws(() => parseTime("9am"));
});
test("dubaiToday uses the Asia/Dubai calendar date", () => {
  assert.equal(dubaiToday(new Date("2025-03-10T21:00:00Z")), "2025-03-11");
  assert.equal(dubaiToday(new Date("2025-03-10T19:59:00Z")), "2025-03-10");
});
