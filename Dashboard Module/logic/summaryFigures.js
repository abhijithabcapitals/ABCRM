// Turns what each source returns into the plain numbers a summary card shows.
// No imports, so node --test can load it.
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const list = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === "object" ? v : {});

// Stages not in `stages` are counted under "Other".
export function bdFigures(rows, stages, cap = 500) {
  const items = list(rows);
  const known = list(stages);
  const out = known.map((label) => ({ label, value: items.filter((r) => r.stage === label).length }));
  const other = items.filter((r) => !known.includes(r.stage)).length;
  if (other) out.push({ label: "Other", value: other });
  return { total: items.length >= cap ? `${cap}+` : items.length, stages: out };
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

export function notificationFigures(rows) {
  const items = list(rows);
  return { unread: items.filter((n) => !n.read).length, latest: items.slice(0, 5) };
}

// Postgres "insufficient privilege".
export const isNoAccess = (error) => error?.code === "42501";
