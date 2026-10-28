// Pure helpers shared by the Template module (no React, no Supabase).

// Normalize a key on SAVE (collapses runs, trims ends).
export const slugify = (s) =>
  (s || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

// Sanitize a key WHILE TYPING — keeps underscores you're mid-typing (does not
// strip trailing "_"), so "license_fee" can be typed left to right.
export const keyLive = (s) =>
  (s || "").toString().toLowerCase().replace(/[^a-z0-9_]+/g, "_");

export const DEFAULT_USD_RATE = 3.6725; // AED per 1 USD (UAE dirham peg)

// Where a generated quotation is filed as a CRM task, and the dropdown field
// that records which freezone it was. Change these names if the space/folder/
// list are renamed.
export const CRM_TARGET = { space: "Delivery", folder: "Quotation", list: "Quotations by CRM" };
export const FREEZONE_FIELD = "Free Zone";

// Freezone label for the CRM tag: drop a trailing "Template" so "IFZA Template"
// becomes "IFZA".
export const cleanFreezone = (s) => (String(s || "").replace(/\s*template\s*$/i, "").trim() || String(s || "").trim());

export const fmtMoney = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(v ?? "");
};

// USD amounts are shown as whole numbers (no decimals), rounded half-up: the
// fractional part < .50 floors, >= .50 ceils (12.4 -> 12, 12.5 -> 13, 12.6 -> 13).
// Math.round already rounds half-up for the non-negative values we deal with.
export const fmtUsd = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n).toLocaleString("en-US", { maximumFractionDigits: 0 }) : String(v ?? "");
};

export const fmtDate = (v) => {
  if (v === "" || v === null || v === undefined) return "";
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime())
    ? String(v)
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

export const today = () =>
  new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export const safeName = (s) => (s || "quotation").replace(/[^A-Za-z0-9._ -]/g, "").trim() || "quotation";

// Filename stamp: YYYY-MM-DD_HHMMSS at generation time.
export const stamp = () => {
  const d = new Date();
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

// Resolve the human name for a quotation (business activity / business name,
// falling back to the first non-fee text field that has a value). Templates
// differ in which key holds the activity (e.g. RAKEZ doesn't use
// `business_activity`), so we can't rely on that one key alone.
export function resolveQuotationName(ctx, fields) {
  const firstText = (fields || []).find((f) => !f.fee && f.type !== "date" && ctx[f.key]);
  return ctx.business_activity || ctx.business_name || (firstText ? ctx[firstText.key] : "") || "";
}

// Output filename = <business activity / name> + date-time stamp.
export function docName(ctx, fields, extra = "") {
  const name = resolveQuotationName(ctx, fields) || "quotation";
  return `${safeName(name)} - ${stamp()}${extra}.docx`;
}
