// A quote's lines. The tracker is built from these when the quote is accepted.
export const ACTIONS = ["New", "Renewal", "Rectification", "Cancellation"];

export const DEFAULT_VAT_RATE = 5;
// Money is counted in whole fils so a half rounds up exactly as the database does (round on numeric).
const fils = (n) => Math.round(Number(n || 0) * 100);
const lineVatFils = (amountFils, rate) => Math.floor((amountFils * rate + 50) / 100);
const rateOf = (r) => (r.vat_rate === null || r.vat_rate === undefined || r.vat_rate === "" ? DEFAULT_VAT_RATE : Number(r.vat_rate));

// The database reads each line's rate from its fee item and ignores what is sent here; the rate on a line is for the screen and the file.
export const buildLines = (rows) => rows.map((r) => ({
  service_name: r.service_name,
  action: r.action || "New",
  fee_item_id: r.fee_item_id || null,
  description: !r.action || r.action === "New" ? r.service_name : `${r.action} ${r.service_name}`,
  amount: Number(r.amount),
  remarks: r.remarks || "",
  scope: String(r.scope || "").trim(),
  vat_rate: rateOf(r),
}));

// A row's rate comes from its fee item when it has one, else from the line (an older quote), else 5.
export const withRates = (rows, fees) => rows.map((r) => {
  const f = r.fee_item_id ? (fees || []).find((x) => x.id === r.fee_item_id) : null;
  return { ...r, vat_rate: f ? Number(f.vat_rate) : rateOf(r) };
});

// Net, VAT and total, VAT rounded per line as the database does. A cell left empty counts as nothing.
export function lineTotals(rows) {
  const net = rows.reduce((n, r) => n + fils(r.amount), 0);
  const vat = rows.reduce((n, r) => n + lineVatFils(fils(r.amount), rateOf(r)), 0);
  return { net: net / 100, vat: vat / 100, total: (net + vat) / 100 };
}

// The first problem that stops a quote from being issued, or null. The grey stored amount is not a fee: an empty cell is an error, a zero is not.
export function lineError(rows) {
  if (!rows.length) return "Add at least one service.";
  const bad = rows.some((r) => !String(r.service_name || "").trim() || r.amount === "" || r.amount === null || r.amount === undefined || !Number.isFinite(Number(r.amount)) || Number(r.amount) < 0);
  if (bad) return "Each line needs a service and a fee.";
  if (rows.some((r) => Math.abs(Number(r.amount) * 100 - Math.round(Number(r.amount) * 100)) > 1e-6)) return "A fee can have at most two decimals.";
  return null;
}
