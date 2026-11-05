// Turns what each source returns into the plain numbers a summary card shows.
// Imports only plain logic, so node --test can load it.
import { isOpen } from "../../Business Development Module/logic/leadRules.js";

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const list = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === "object" ? v : {});

// Supabase caps a response at 1,000 rows, so a list is read page by page until a short page. The caller must order by
// something unique, so pages never overlap. Same approach as Accounting Module/services/jobsApi.js.
export const PAGE_SIZE = 1000;
export async function readPages(fetchPage) {
  const out = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = list(await fetchPage(from, from + PAGE_SIZE - 1));
    out.push(...page);
    if (page.length < PAGE_SIZE) return out;
  }
}

// Open leads only, as the Business Development screen counts them. `cap` is how many leads, open or not, were asked
// for: reaching it means the read was cut off. Stages not in `stages` are counted under "Other".
export function bdFigures(rows, stages, cap = 500) {
  const all = list(rows);
  const items = all.filter(isOpen);
  const known = list(stages);
  const out = known.map((label) => ({ label, value: items.filter((r) => r.stage === label).length }));
  const other = items.filter((r) => !known.includes(r.stage)).length;
  if (other) out.push({ label: "Other", value: other });
  return { total: all.length >= cap ? `${cap}+` : items.length, stages: out };
}

// Same labels as the Business Banking dashboard.
const BANK_CARDS = [["total_leads", "Total Leads Received"], ["documents_pending", "Documents Pending"], ["submitted", "Applications Submitted"], ["approved", "Accounts Approved"]];
const BANK_ALERTS = [
  ["lead_followups", "Leads requiring follow-up"], ["quotes_waiting", "Quotations awaiting acceptance"], ["payments_overdue", "Accepted quotations with a balance"], ["documents_pending", "Documents pending"],
  ["agreements_unsigned", "Agreements awaiting signature"], ["appointments", "Bank appointments scheduled"], ["bank_response", "Applications pending bank response"], ["comm_followups", "Overdue communication follow-ups"],
  ["tasks_overdue", "Overdue tasks"], ["import_review", "Excel rows awaiting review"],
];
export function bankingFigures(d) {
  const x = obj(d);
  const pick = (src, keys) => keys.map(([k, label]) => ({ label, value: num(obj(src)[k]) }));
  return { cards: pick(x.cards, BANK_CARDS), alerts: pick(x.alerts, BANK_ALERTS), finance: x.finance && typeof x.finance === "object" ? x.finance : null };
}

// The Business Setup dashboard shows forms_waiting as a plain number.
export function setupFigures(d) {
  const x = obj(d);
  const exp = obj(x.expiries);
  return {
    forms: num(x.forms_waiting), openQuotes: num(x.open_quotes), noLetter: num(x.accepted_without_letter), outstanding: num(x.outstanding),
    activeServices: num(x.active_services), expiringUpcoming: num(exp.upcoming), expiringPast: num(exp.past),
  };
}

export function accountingFigures(rows) {
  const items = list(rows);
  const status = new Map();
  for (const r of items) {
    const s = r.work_status || "Other";
    status.set(s, (status.get(s) || 0) + 1);
  }
  return {
    byStatus: [...status].map(([label, value]) => ({ label, value })),
    followUpsDue: items.filter((r) => r.follow_up_due).length,
    needInvoice: items.filter((r) => r.needs_invoice).length,
    balanceDue: items.reduce((sum, r) => sum + Math.max(num(r.balance), 0), 0),
  };
}

export function hrFigures(d) {
  const x = obj(d);
  return { headcount: num(x.headcount), pendingLeave: num(x.pending_leave), expiringDocuments: num(x.expiring_documents) };
}

export function taxFigures(result) {
  const x = obj(result);
  const s = obj(x.summary);
  return { overdue: num(s.overdue), due14: num(s.due_14), due30: num(s.due_30), missing: num(s.missing), clients: num(x.clientsChecked) };
}

// Only the newest NOTIFICATION_LIMIT are read. All of them unread means there may be more.
export const NOTIFICATION_LIMIT = 50;
export function notificationFigures(rows) {
  const items = list(rows);
  const unread = items.filter((n) => !n.read).length;
  return { unread: unread >= NOTIFICATION_LIMIT ? `${NOTIFICATION_LIMIT}+` : unread, latest: items.slice(0, 5) };
}

// The six counts of the Notification Centre card, from alert_tiles, and the mode. Missing counts are 0.
export function alertFigures(tiles) {
  const t = obj(tiles);
  return { overdue: num(t.overdue), upcoming: num(t.upcoming), documents: num(t.documents), authority: num(t.authority), renewals: num(t.renewals), unassigned: num(t.unassigned), mode: t.mode ?? null };
}

// In Preview only admins see alerts, so a member's six zeros would read as all clear.
export const alertsInPreview = (figures, isAdmin) => figures?.mode === "Preview" && !isAdmin;

// Postgres "insufficient privilege".
export const isNoAccess = (error) => error?.code === "42501";

// ---- Zoho financial snapshot ----
const MINUTE = 60_000;
const FRESH_MINUTES = 360;
const REFRESH_WAIT_MINUTES = 5;
// After Zoho limited requests the function makes the button wait longer. These texts must match errors.ts in zoho-finance.
const RATE_LIMIT_WAIT_MINUTES = 15;
export const RATE_LIMIT_MESSAGES = [
  "Zoho is busy, try again shortly.",
  "Zoho is limiting requests, so some figures are incomplete. Refresh again in a few minutes.",
  "Zoho is limiting requests. Refresh again in a few minutes.",
];
const stamp = (v) => (v ? Date.parse(v) : NaN);

// "empty" has no figures yet, "failed" is the last attempt failing (the old figures stay), "stale" is over 6 hours old.
export function snapshotState(row, now) {
  const asOf = stamp(row?.as_of);
  if (Number.isNaN(asOf)) return "empty";
  if (row.status === "failed") return "failed";
  return now - asOf > FRESH_MINUTES * MINUTE ? "stale" : "fresh";
}

// "n/a" for an unknown ratio. Never zero.
export const fmtRatio = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? "n/a" : Number(v).toFixed(2));

// Whole minutes until the Refresh button works: the function allows it once both the figures and the last attempt are 5 minutes old,
// or 15 after a rate-limit message.
export function refreshWaitMinutes(row, now) {
  const newest = Math.max(stamp(row?.as_of) || 0, stamp(row?.last_attempt_at) || 0);
  if (!newest) return 0;
  const minutes = RATE_LIMIT_MESSAGES.includes(row?.error) ? RATE_LIMIT_WAIT_MINUTES : REFRESH_WAIT_MINUTES;
  return Math.max(0, Math.ceil((newest + minutes * MINUTE - now) / MINUTE));
}

// The function is not there yet (migration not applied): PostgREST's schema-cache miss, or Postgres "undefined function".
export const isMissingFunction = (error) => error?.code === "PGRST202" || error?.code === "42883";
// The table is not there yet (migration not applied): Postgres 42P01, or PostgREST's schema-cache miss.
export const isMissingTable = (error) => error?.code === "42P01" || error?.code === "PGRST205";

// The line under the header after a failed refresh, or null. A first-ever failure has no earlier figures to point to.
export function failureNote(row) {
  if (row?.status !== "failed") return null;
  const why = row.error || "The last refresh failed.";
  return Number.isNaN(stamp(row.as_of)) ? `${why} There are no earlier figures.` : `${why} The figures below are from the last good refresh.`;
}
