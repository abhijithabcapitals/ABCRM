// Employee profile helpers. Dates are calendar dates (YYYY-MM-DD).
export const VISA_STATUSES = ["Employment", "Investor", "Partner", "Dependent", "Golden", "Visit", "Cancelled"];

// The documents shown on the profile. Their records and files live in Documents.
export const PROFILE_DOCS = ["Residence visa", "Emirates ID", "Driving licence"];

export const isPhoto = (name) => /\.(png|jpe?g|webp)$/i.test(name || "");

// Rows in any order -> the latest one already in effect on the date.
export function currentPay(rows, date) {
  const live = (rows || []).filter((r) => r.effective_from <= date);
  return live.reduce((best, r) => (!best || r.effective_from > best.effective_from ? r : best), null);
}

// Basic, then HRA, then other allowances in their stored order, with the monthly total.
export function payLines(detail) {
  const { hra, rest } = splitHra(detail.allowances);
  const lines = [["Basic", Number(detail.basic)]];
  if (hra !== "") lines.push(["HRA", Number(hra)]);
  for (const [k, v] of Object.entries(rest)) lines.push([k, Number(v)]);
  return { lines, total: lines.reduce((s, [, v]) => s + v, 0) };
}

// HRA has its own field on the salary form. It stays one key among the allowances, so payroll reads it like any other.
export function splitHra(allowances) {
  const { HRA, ...rest } = allowances || {};
  return { hra: HRA ?? "", rest };
}

export function withHra(hra, rest) {
  if (hra === "" || hra === null || hra === undefined) return rest;
  const n = Number(hra);
  if (!Number.isFinite(n) || n < 0) throw new Error("HRA must be an amount of 0 or more");
  return n === 0 ? rest : { HRA: n, ...rest };
}

// Rows from hr_salaries_overview -> the year's Payable, Paid and Outstanding.
export function yearTotals(rows) {
  const add = (k) => (rows || []).reduce((s, r) => s + Number(r[k] || 0), 0);
  return { payable: add("payable"), paid: add("paid"), outstanding: add("outstanding") };
}

// The record to show for a document type: the one that runs longest, since older copies stay on file.
export function latestDoc(docs, type) {
  const rows = (docs || []).filter((d) => d.doc_type === type);
  return rows.reduce((best, d) => (!best || String(d.expiry_date ?? "") > String(best.expiry_date ?? "") ? d : best), null);
}
