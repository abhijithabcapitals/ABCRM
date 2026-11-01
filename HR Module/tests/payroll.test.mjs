import test from "node:test";
import assert from "node:assert/strict";
import { formatAllowances, maskIban, missingData, missingSettings, money, monthStart, parseAllowances, runTotals } from "../logic/payroll.js";

test("parseAllowances reads one label and amount per line", () => {
  assert.deepEqual(parseAllowances("Housing: 3000\n Transport : 1000.50 \n\n"), { Housing: 3000, Transport: 1000.5 });
  assert.deepEqual(parseAllowances(""), {});
  assert.deepEqual(parseAllowances(null), {});
});
test("parseAllowances refuses what the database would refuse, naming the line", () => {
  assert.throws(() => parseAllowances("Housing"), /Housing/);
  assert.throws(() => parseAllowances("Housing: lots"), /Housing/);
  assert.throws(() => parseAllowances("Housing: -1"), /Housing/);
  assert.throws(() => parseAllowances(": 5"), /label/);
  assert.throws(() => parseAllowances("Housing: 1\nHousing: 2"), /twice/);
});
test("formatAllowances is the reverse of parseAllowances", () => {
  const a = { Housing: 3000, Transport: 1000.5 };
  assert.deepEqual(parseAllowances(formatAllowances(a)), a);
  assert.equal(formatAllowances(null), "");
});
test("runTotals adds net in fils so totals do not drift", () => {
  assert.deepEqual(runTotals([{ net: 0.1 }, { net: 0.2 }, { net: "1000.55" }]), { headcount: 3, totalNet: 1000.85 });
  assert.deepEqual(runTotals([]), { headcount: 0, totalNet: 0 });
});
test("missingData lists only people with blockers, or net below zero", () => {
  const names = { a: "Asha", b: "Bilal", c: "Chen" };
  const lines = [
    { employee_id: "a", net: 100, blockers: ["IBAN missing"] },
    { employee_id: "b", net: 100, blockers: [] },
    { employee_id: "c", net: -1, blockers: [] },
  ];
  assert.deepEqual(missingData(lines, names), [{ name: "Asha", problems: ["IBAN missing"] }, { name: "Chen", problems: ["Net pay is below zero"] }]);
});
test("missingSettings names what a run needs", () => {
  assert.deepEqual(missingSettings({}), ["Pay day divisor mode", "Unpaid leave wage base"]);
  assert.deepEqual(missingSettings({ pay_day_divisor_mode: "fixed", pay_unpaid_wage_base: "basic" }), ["Pay days basis"]);
  assert.deepEqual(missingSettings({ pay_day_divisor_mode: "calendar_days", pay_unpaid_wage_base: "total" }), []);
});
test("monthStart turns a month input into the first day", () => {
  assert.equal(monthStart("2025-06"), "2025-06-01");
  assert.throws(() => monthStart(""), /month/);
});
test("money shows two decimals", () => {
  assert.equal(money(1234.5), "1,234.50");
  assert.equal(money("-0.01"), "-0.01");
});
test("maskIban keeps only the last 4", () => {
  assert.equal(maskIban("AE070331234567890123452"), "****3452");
  assert.equal(maskIban(null), null);
});
