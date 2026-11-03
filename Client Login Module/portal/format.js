// Small display helpers shared by the portal tabs.
import { fmtDate } from "@banking/components/shared";

export const fmtSize = (n) => (n == null ? "" : n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);

// Null stays a dash: an amount nobody recorded is not zero.
export const fmtMoney = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? "–" : `AED ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

// The CRM holds dates as YYYY-MM-DD or, from the Client Master, DD/MM/YYYY. Returns YYYY-MM-DD or "".
export function toIso(v) {
  const s = String(v ?? "").trim();
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
}

// A date shown the way the portal shows dates; anything that is not a date is shown as written.
export const showDate = (v) => (v == null || v === "" ? "–" : toIso(v) ? fmtDate(toIso(v)) : String(v));
