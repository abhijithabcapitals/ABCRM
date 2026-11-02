// Payslip as a complete printable HTML document. Pure: it prints figures the database already worked out and
// checks they add up; it never calculates pay. Internal notes and the full IBAN are never printed.
import { maskIban, money, monthLabel } from "./payroll.js";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Whole fils, so the check is exact.
function fils(value, what) {
  const n = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(n)) throw new Error(`The ${what} amount is not a number, so no payslip was made`);
  return Math.round(n * 100);
}

function part(items, name) {
  const rows = (items || []).map((x) => ({ label: x.label, days: x.days, f: fils(x.amount, name) }));
  return { rows, total: rows.reduce((s, r) => s + r.f, 0) };
}

const PRINT_CSS = `@page{size:A4;margin:16mm}body{font:12px/1.5 Arial,Helvetica,sans-serif;color:#1c2b30;margin:0;background:#fff}h1{font-size:18px;margin:0}h2{font-size:12.5px;margin:16px 0 4px}table{width:100%;border-collapse:collapse;margin:4px 0}th,td{border:1px solid #bcc7cb;padding:6px 8px;text-align:left}th{background:#eef2f3}.r{text-align:right}.tot td{font-weight:700;background:#eef2f3}.meta td{border:0;padding:1px 8px 1px 0}.head{border-bottom:2px solid #123;padding-bottom:8px;margin-bottom:12px}`;

export function payslipHtml(line, employee, run) {
  if (!run || run.status !== "approved") throw new Error("A payslip can only be made from an approved run");
  if (!String(employee?.full_name ?? "").trim()) throw new Error("The employee name is missing, so no payslip was made");
  if (!line) throw new Error("There is no pay line to print");
  const e = part(line.earnings, "earnings");
  const d = part(line.deductions, "deductions");
  const a = part(line.adjustments, "adjustments");
  const net = fils(line.net, "net pay");
  if (e.total - d.total + a.total !== net) throw new Error("The earnings, deductions and adjustments do not add up to the net pay, so no payslip was made");

  const section = (title, p, totalLabel) => `<h2>${esc(title)}</h2><table>${p.rows.length
    ? p.rows.map((r) => `<tr><td>${esc(r.label)}${r.days ? ` (${esc(r.days)} days)` : ""}</td><td class="r">${money(r.f / 100)}</td></tr>`).join("")
    : `<tr><td>None</td><td class="r">${money(0)}</td></tr>`}<tr class="tot"><td>${esc(totalLabel)}</td><td class="r">${money(p.total / 100)}</td></tr></table>`;

  const period = monthLabel(run.period_month);
  const iban = maskIban(line.iban);
  const who = `${employee?.full_name ?? ""}`;
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(`Payslip ${period} ${who}`.trim())}</title><style>${PRINT_CSS}</style></head><body>
<div class="head"><h1>Payroll</h1><div>Payslip for ${esc(period)}</div></div>
<table class="meta"><tr><td><b>Employee</b> ${esc(who)}</td><td><b>Employee code</b> ${esc(employee?.employee_code)}</td></tr>${iban ? `<tr><td colspan="2"><b>Paid to IBAN</b> ${esc(iban)}</td></tr>` : ""}</table>
${section("Earnings", e, "Total earnings")}${section("Deductions", d, "Total deductions")}${section("Adjustments", a, "Total adjustments")}
<table><tr class="tot"><td>Net pay</td><td class="r">${money(net / 100)}</td></tr></table>
</body></html>`;
}
