// Build the data a library Word template is rendered with.
import { buildContext } from "./buildContext.js";

const CTRL = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g;
const clean = (v) => (typeof v === "string" ? v.replace(CTRL, "") : v);

const isoToDisplay = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
};

function amountOf(r, label) {
  const raw = typeof r.amount === "string" ? r.amount.replace(/[,\s]/g, "") : r.amount;
  const n = raw === "" || raw === null || raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Amount for "${label}" is not a number: ${JSON.stringify(r.amount)}`);
  return n;
}

// Rows with a label only; text cleaned, amount as a number.
function cleanRows(rows) {
  const out = [];
  for (const r of rows || []) {
    const label = String(clean(r && r.label) ?? "").trim();
    if (!label) continue;
    out.push({ label, amount: amountOf(r, label), remarks: clean(r.remarks) || "", rate: clean(r.rate) ?? "" });
  }
  return out;
}

export function toLines(rows) {
  return cleanRows(rows).map((r) => ({ description: r.label, amount: r.amount, remarks: r.remarks, rate: r.rate }));
}

export function libraryContext(values, rows, usdRate, refNo) {
  const v = {};
  for (const [k, val] of Object.entries(values || {})) v[k] = clean(val);
  for (const k of Object.keys(v)) if (/(^|_)date$/.test(k)) v[k] = isoToDisplay(v[k]);
  const lines = cleanRows(rows);
  const ctx = buildContext(v, [], 0, usdRate, lines);
  ctx.items.forEach((it, i) => { it.rate = lines[i].rate; });
  ctx.ref_no = clean(refNo);
  delete ctx.quotation_no;
  return ctx;
}
