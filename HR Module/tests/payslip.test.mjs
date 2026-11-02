// node --test "HR Module/tests/"   (run from the repo root; no extra packages)
import test from "node:test";
import assert from "node:assert/strict";
import { payslipHtml } from "../logic/payslip.js";

const run = { id: "r1", period_month: "2026-10-01", status: "approved" };
const employee = { employee_code: "E001", full_name: "Asha Rao" };
const line = () => ({
  earnings: [{ label: "Basic", amount: 5000 }, { label: "Housing", amount: 2000.5 }],
  deductions: [{ label: "Unpaid leave", days: 2, amount: 300.25 }],
  adjustments: [{ label: "Bonus for October", amount: 100 }, { label: "Correction", amount: -50.1 }],
  net: 6750.15,
  notes: ["Review: half-pay leave not calculated"],
  iban: "AE070331234567890123456",
});

test("totals equal the line's net", () => {
  const html = payslipHtml(line(), employee, run);
  assert.match(html, /Total earnings[^]*?7,000\.50/);
  assert.match(html, /Total deductions[^]*?300\.25/);
  assert.match(html, /Total adjustments[^]*?49\.90/);
  assert.match(html, /Net pay[^]*?6,750\.15/);
});

test("adjustments are listed", () => {
  const html = payslipHtml(line(), employee, run);
  assert.ok(html.includes("Bonus for October"));
  assert.ok(html.includes("Correction"));
  assert.ok(html.includes("-50.10"));
});

test("a draft run throws", () => {
  assert.throws(() => payslipHtml(line(), employee, { ...run, status: "draft" }), /approved/);
  assert.throws(() => payslipHtml(line(), employee, null), /approved/);
});

test("figures that do not add up to net throw", () => {
  assert.throws(() => payslipHtml({ ...line(), net: 6750.16 }, employee, run), /do not add up/);
  const bad = line();
  bad.earnings[0].amount = "abc";
  assert.throws(() => payslipHtml(bad, employee, run), /amount/);
});

test("user text is escaped", () => {
  const l = line();
  l.adjustments[0].label = "<script>alert(1)</script>";
  const html = payslipHtml(l, { employee_code: "E<1>", full_name: 'Bob "<img src=x>"' }, run);
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
});

test("IBAN shows only the last 4", () => {
  const html = payslipHtml(line(), employee, run);
  assert.ok(html.includes("****3456"));
  assert.ok(!html.includes("AE070331234567890123456"));
  assert.ok(!html.includes("0331234567890123"));
});

test("a line without an IBAN prints no IBAN row", () => {
  const l = { ...line(), iban: null };
  assert.ok(!payslipHtml(l, employee, run).includes("****"));
});

test("internal notes are not printed", () => {
  const html = payslipHtml(line(), employee, run);
  assert.ok(!html.includes("half-pay"));
  assert.ok(!/Notes/i.test(html));
});

test("a blank employee name throws", () => {
  for (const emp of [null, undefined, {}, { full_name: "  " }, { full_name: undefined, employee_code: "E1" }]) assert.throws(() => payslipHtml(line(), emp, run), /name/);
});
