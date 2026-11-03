import test from "node:test";
import assert from "node:assert/strict";
import { addMonth, confirmSoon, extendMonths, markClasses, markText, marksByDate, monthKey, monthsAround, visibleDayIndex, withEveryone } from "../logic/attendance.js";
import { VISA_STATUSES, currentPay, latestDoc, payLines, splitHra, withHra, yearTotals } from "../logic/profile.js";

test("yearTotals adds text amounts and copes with no rows", () => {
  assert.deepEqual(yearTotals([{ payable: "100.50", paid: "50", outstanding: "50.50" }, { payable: 10, paid: 10, outstanding: 0 }]), { payable: 110.5, paid: 60, outstanding: 50.5 });
  assert.deepEqual(yearTotals(null), { payable: 0, paid: 0, outstanding: 0 });
});

test("marksByDate puts real holidays and marks on their dates, holidays first", () => {
  const m = marksByDate(
    [{ holiday_date: "2035-12-02", name: "National Day" }],
    [{ mark_date: "2035-12-02", name: "Eid Al Fitr", region: "UAE" }, { mark_date: "2035-10-30", name: "Diwali", region: "India" }],
  );
  assert.deepEqual(m["2035-12-02"].map((x) => [x.name, x.holiday]), [["National Day", true], ["Eid Al Fitr", false]]);
  assert.equal(m["2035-10-30"][0].region, "India");
  assert.deepEqual(marksByDate(null, null), {});
});
test("markText says which names are only estimates", () => {
  assert.equal(markText([{ name: "National Day", holiday: true }, { name: "Eid", holiday: false, region: "UAE" }]), "National Day, Eid (estimated)");
  assert.equal(markText(undefined), "");
});
test("markClasses gives one class per region present", () => {
  assert.equal(markClasses([{ region: "UAE" }]), "hr-cell-mark-uae");
  assert.equal(markClasses([{ region: "India" }]), "hr-cell-mark-india");
  assert.equal(markClasses([{ region: "UAE" }, { region: "India" }]), "hr-cell-mark-uae hr-cell-mark-india");
  assert.equal(markClasses([]), "");
});
test("confirmSoon flags a UAE mark from 30 days before its date, and any past one", () => {
  const uae = (mark_date) => ({ mark_date, region: "UAE" });
  assert.equal(confirmSoon(uae("2026-12-03"), "2026-11-03"), true);
  assert.equal(confirmSoon(uae("2026-12-04"), "2026-11-03"), false);
  assert.equal(confirmSoon(uae("2026-10-01"), "2026-11-03"), true);
  assert.equal(confirmSoon({ mark_date: "2026-11-05", region: "India" }, "2026-11-03"), false);
});
test("month helpers cross year ends", () => {
  assert.equal(monthKey("2026-11-03"), "2026-11");
  assert.equal(addMonth("2026-01", -1), "2025-12");
  assert.equal(addMonth("2026-12", 1), "2027-01");
  assert.deepEqual(monthsAround("2026-01"), ["2025-12", "2026-01", "2026-02"]);
});
test("extendMonths keeps the list unbroken up to a far month, either way", () => {
  assert.deepEqual(extendMonths(["2026-10", "2026-11"], "2026-11"), ["2026-10", "2026-11"]);
  assert.deepEqual(extendMonths(["2026-10", "2026-11"], "2026-08"), ["2026-08", "2026-09", "2026-10", "2026-11"]);
  assert.deepEqual(extendMonths(["2026-10", "2026-11"], "2027-01"), ["2026-10", "2026-11", "2026-12", "2027-01"]);
});
test("visibleDayIndex finds the day in the middle of the part not frozen, within the list", () => {
  assert.equal(visibleDayIndex({ scrollLeft: 0, clientWidth: 1000, frozen: 300, col: 35, days: 90 }), 10);
  assert.equal(visibleDayIndex({ scrollLeft: 350, clientWidth: 1000, frozen: 300, col: 35, days: 90 }), 20);
  assert.equal(visibleDayIndex({ scrollLeft: 99999, clientWidth: 1000, frozen: 300, col: 35, days: 90 }), 89);
});
test("currentPay takes the latest row already in effect", () => {
  const rows = [{ effective_from: "2027-01-01", basic: 9 }, { effective_from: "2026-06-01", basic: 5 }, { effective_from: "2026-01-01", basic: 1 }];
  assert.equal(currentPay(rows, "2026-11-03").basic, 5);
  assert.equal(currentPay(rows, "2025-01-01"), null);
  assert.equal(currentPay(null, "2026-11-03"), null);
});
test("payLines lists Basic, HRA first, then the rest, then the total", () => {
  assert.deepEqual(payLines({ basic: "5000", allowances: { Transport: 500, HRA: "2000" } }), { lines: [["Basic", 5000], ["HRA", 2000], ["Transport", 500]], total: 7500 });
  assert.deepEqual(payLines({ basic: 1000, allowances: null }), { lines: [["Basic", 1000]], total: 1000 });
});
test("splitHra and withHra keep the other allowances untouched", () => {
  assert.deepEqual(splitHra({ HRA: 2000, Transport: 500 }), { hra: 2000, rest: { Transport: 500 } });
  assert.deepEqual(splitHra(null), { hra: "", rest: {} });
  assert.deepEqual(withHra(2000, { Transport: 500 }), { HRA: 2000, Transport: 500 });
  assert.deepEqual(withHra("", { Transport: 500 }), { Transport: 500 });
  assert.deepEqual(withHra(0, {}), {});
  assert.deepEqual(withHra("1500.50", {}), { HRA: 1500.5 });
  assert.throws(() => withHra("abc", {}), /HRA/);
  assert.throws(() => withHra(-5, {}), /HRA/);
});
test("latestDoc takes the type's latest expiry, and a dated row beats an undated one", () => {
  const docs = [
    { id: 1, doc_type: "Emirates ID", expiry_date: "2026-01-01" },
    { id: 2, doc_type: "Emirates ID", expiry_date: "2028-01-01" },
    { id: 3, doc_type: "Emirates ID", expiry_date: null },
    { id: 4, doc_type: "Residence visa", expiry_date: "2030-01-01" },
  ];
  assert.equal(latestDoc(docs, "Emirates ID").id, 2);
  assert.equal(latestDoc(docs, "Driving licence"), null);
});
test("withEveryone adds today's people with no days, without touching those already there", () => {
  const today = [{ employee_id: "a", employee_code: "E1", days: { "2026-11-03": {} }, counts: { Present: 1 } }, { employee_id: "b", employee_code: "E2", days: { "2026-11-03": {} }, counts: { Present: 1 } }];
  const got = withEveryone([{ employee_id: "b", employee_code: "E2", days: { x: 1 }, counts: { Present: 9 } }], today);
  assert.deepEqual(got.map((g) => [g.employee_id, Object.keys(g.days).length, g.counts.Present]), [["a", 0, 0], ["b", 1, 9]]);
});
test("the visa list includes the common statuses", () => {
  assert.ok(VISA_STATUSES.includes("Employment") && VISA_STATUSES.includes("Cancelled"));
});
