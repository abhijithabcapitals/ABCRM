import test from "node:test";
import assert from "node:assert/strict";
import { annualRows, lateShade, leaveCard, netLateMinutes, setOffNote, todayLabel } from "../logic/attendance.js";

const annual = (over) => [{ leave_type: "Unpaid", entitlement: null, adjustment: 0, carried: 0, used: 4, pending: 0, remaining: null }, { leave_type: "Annual", entitlement: 30, adjustment: 0, carried: 0, used: 0, pending: 0, remaining: 30, ...over }];

test("netLateMinutes takes the extra time off the lateness, never below 0", () => {
  assert.equal(netLateMinutes({ late_minutes: 30, overtime_minutes: 15 }), 15);
  assert.equal(netLateMinutes({ late_minutes: 30, overtime_minutes: 30 }), 0);
  assert.equal(netLateMinutes({ late_minutes: 30, overtime_minutes: 90 }), 0);
  assert.equal(netLateMinutes({ late_minutes: 30, overtime_minutes: 0 }), 30);
  assert.equal(netLateMinutes({ late_minutes: 0, overtime_minutes: 40 }), 0);
  assert.equal(netLateMinutes(undefined), 0);
});
test("lateShade runs from yellow to orange over the hour and stays orange after it", () => {
  assert.equal(lateShade(0), null);
  assert.equal(lateShade(-5), null);
  assert.equal(lateShade(60), "#f28c28");
  assert.equal(lateShade(200), "#f28c28");
  assert.equal(lateShade(30), "#f9b954");
  const near = lateShade(1);
  assert.match(near, /^#ff/);
  assert.notEqual(near, lateShade(30));
});
test("setOffNote only speaks when both lateness and extra time exist", () => {
  assert.equal(setOffNote({ late_minutes: 30, overtime_minutes: 0 }), "");
  assert.equal(setOffNote({ late_minutes: 0, overtime_minutes: 30 }), "");
  assert.equal(setOffNote({ late_minutes: 30, overtime_minutes: 15 }), ", 15 min net late");
  assert.equal(setOffNote({ late_minutes: 30, overtime_minutes: 30 }), ", set off by overtime");
});
test("annualRows reads a used figure held as a negative adjustment, so the sheet's numbers show", () => {
  const people = [{ id: "a", full_name: "Alex" }];
  const [row] = annualRows(people, [annual({ entitlement: 27, adjustment: -25, remaining: 2 })]);
  assert.deepEqual(row, { id: "a", full_name: "Alex", credit: 27, used: 25, pending: 0, balance: 2 });
});
test("annualRows adds carried days and approved days, and a positive adjustment is credit", () => {
  const [row] = annualRows([{ id: "a", full_name: "A" }], [annual({ entitlement: 30, adjustment: 2, carried: 5, used: 3, pending: 1, remaining: 34 })]);
  assert.deepEqual(row, { id: "a", full_name: "A", credit: 37, used: 3, pending: 1, balance: 34 });
});
test("annualRows counts accrued days as credit", () => {
  const [row] = annualRows([{ id: "a", full_name: "A" }], [annual({ entitlement: 27, adjustment: -25, accrued: 5, remaining: 7 })]);
  assert.deepEqual(row, { id: "a", full_name: "A", credit: 32, used: 25, pending: 0, balance: 7 });
});
test("annualRows gives dashes when there is no Annual type, and tolerates text numbers", () => {
  const rows = annualRows([{ id: "a", full_name: "A" }, { id: "b", full_name: "B" }], [[], annual({ entitlement: "21.5", adjustment: "-0.5", remaining: "21" })]);
  assert.deepEqual(rows[0], { id: "a", full_name: "A", credit: null, used: null, pending: null, balance: null });
  assert.deepEqual(rows[1], { id: "b", full_name: "B", credit: 21.5, used: 0.5, pending: 0, balance: 21 });
});
test("leaveCard joins Annual and Unpaid, saying which is which", () => {
  const card = leaveCard({
    counts: { leave_annual: 2, leave_unpaid: 1 },
    people: { leave_annual: [{ employee_id: "a", full_name: "Zed", days: 2 }], leave_unpaid: [{ employee_id: "a", full_name: "Zed", days: 1 }, { employee_id: "b", full_name: "Amy", days: 1 }] },
  });
  assert.equal(card.count, 3);
  assert.equal(card.annual, 2);
  assert.equal(card.unpaid, 1);
  assert.deepEqual(card.people.map((p) => [p.full_name, p.kind]), [["Amy", "Unpaid"], ["Zed", "Annual"], ["Zed", "Unpaid"]]);
});
test("leaveCard copes with no data", () => {
  assert.deepEqual(leaveCard({}), { count: 0, annual: 0, unpaid: 0, people: [] });
});
test("todayLabel writes the date with its weekday, whatever the machine's zone", () => {
  assert.equal(todayLabel("2026-11-03"), "Tue, 3 Nov 2026");
});
