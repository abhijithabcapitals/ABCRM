// Pure rules for the Accounting pipeline: statuses, file-name parsing, Dubai dates and the
// follow-up mail. No imports, so the tests run without Vite.

export const WORK_STATUSES = ["To Do", "In Progress", "Pending", "Completed", "Client Cancelled"];
export const RECEIPT_MODES = ["Email", "WhatsApp", "Hand delivery", "Courier", "Shared link", "Other"];
export const PAYMENT_METHODS = ["Bank transfer", "Cash", "Cheque", "Card", "Other"];
export const FOLLOW_UP_CHANNELS = ["Phone", "Email", "WhatsApp", "In person", "Other"];

const REMARKS_STATUSES = ["Pending", "Client Cancelled"];

// One file name per line; trims, drops blanks and repeats, keeps first-seen order.
export function parseFileNames(text) {
  const seen = new Set();
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const name = line.trim();
    if (name) seen.add(name);
  }
  return [...seen];
}

export const needsRemarks = (status) => REMARKS_STATUSES.includes(status);

// The UTC date would be a day behind after 20:00 UTC, so the date is read in Dubai.
export function dubaiToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function nextFollowUpDefault(now = new Date()) {
  const d = new Date(`${dubaiToday(now)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

const money = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function followUpMail(job, sender) {
  const period = job.period_label ? ` (${job.period_label})` : "";
  const lines = [
    `Dear ${job.client_name},`,
    "",
    `This is a reminder about ${job.service_name}${period}, job ${job.job_number}.`,
  ];
  if (job.invoice_number) lines.push(`Invoice ${job.invoice_number} is outstanding.`);
  lines.push(`The balance due is AED ${money(job.balance)}.`, "", "Please let us know when payment will be made.", "", "Regards,", sender);
  return { subject: `Payment reminder: ${job.job_number}`, body: lines.join("\n") };
}

// ── Pipeline list rules ─────────────────────────────────────────────
const CLOSED_STATUSES = ["Completed", "Client Cancelled"];
export const SERVICE_DEPARTMENTS = ["Accounting", "Tax Compliance"];

// filters: { service, assignee, status, toInvoice }. Service and assignee narrow the rows the chips count.
export function narrowJobs(rows, { service, assignee } = {}) {
  return (rows || []).filter((r) => (!service || r.service_name === service) && (!assignee || (r.assignee_ids || []).includes(assignee)));
}

export function statusCounts(rows, filters = {}) {
  const counts = Object.fromEntries(WORK_STATUSES.map((s) => [s, 0]));
  for (const r of narrowJobs(rows, filters)) if (r.work_status in counts) counts[r.work_status] += 1;
  return counts;
}

// Completed and Client Cancelled jobs are set aside unless the status filter asks for them. A job still to invoice stays in view.
export function splitJobs(rows, filters = {}) {
  const matching = narrowJobs(rows, filters)
    .filter((r) => !filters.status || r.work_status === filters.status)
    .filter((r) => !filters.toInvoice || r.needs_invoice);
  const asked = !!filters.status && CLOSED_STATUSES.includes(filters.status);
  const isClosed = (r) => !asked && CLOSED_STATUSES.includes(r.work_status) && !r.needs_invoice;
  return { open: matching.filter((r) => !isClosed(r)), closed: matching.filter(isClosed) };
}

export const toInvoiceCount = (rows, filters = {}) => narrowJobs(rows, filters).filter((r) => r.needs_invoice).length;

// CRM names for assignee ids, then any old names kept from the import.
export function assigneeText(job, nameById = {}) {
  const names = (job.assignee_ids || []).map((id) => nameById[id]).filter(Boolean);
  return [...names, job.legacy_assignees].filter(Boolean).join(", ");
}

// Only a Client Master record (client_lookup rank 1) has a client ID. Other rows leave it empty.
export const clientIdFromLookup = (row) => (row && Number(row.rank) === 1 && row.ref ? String(row.ref) : null);

export function findLookupRow(clients, name) {
  const n = String(name ?? "").trim().toLowerCase();
  if (!n) return null;
  const hits = (clients || []).filter((c) => [c.name, c.legal_name, c.trade_name].some((v) => v && String(v).trim().toLowerCase() === n));
  return hits.find((c) => Number(c.rank) === 1) || hits[0] || null;
}

// Catalogue categories of the two Accounting departments, as select groups.
export function serviceGroups(catalogue, departments = SERVICE_DEPARTMENTS) {
  return (catalogue || []).filter((c) => departments.includes(c.department)).map((c) => ({ label: c.name, department: c.department, items: (c.service_items || []).map((s) => s.name) })).filter((g) => g.items.length);
}
export const departmentOf = (groups, service) => groups.find((g) => g.items.includes(service))?.department ?? null;

export const isStaleSave = (message) => /changed by someone else/i.test(String(message ?? ""));
export const STALE_MESSAGE = "Someone changed this job. Reload it to see their changes.";

// ── Payment rules ───────────────────────────────────────────────────
// A reversal is a row with reverses_id pointing at the payment it undoes.
const reversedSet = (payments) => new Set((payments || []).filter((p) => p.reverses_id).map((p) => p.reverses_id));

// The receipt check in New client steps: a positive payment that nothing has reversed.
export const hasUnreversedPayment = (payments) => {
  const reversed = reversedSet(payments);
  return (payments || []).some((p) => Number(p.amount) > 0 && !p.reverses_id && !reversed.has(p.id));
};

// Reverse is offered only on a payment nobody has reversed yet.
export function paymentRowState(payment, payments) {
  const reversal = !!payment.reverses_id;
  const reversed = reversedSet(payments).has(payment.id);
  return { reversal, reversed, canReverse: !reversal && !reversed };
}

// The fee with VAT. A fee from a linked quote already includes VAT; a typed fee is before VAT, so 5% is added
// (worked in cents, rounded half up, the same way the zoho-books function does). Null when there is no fee.
export function feeWithVat(job) {
  if (job?.fee_amount == null || job.fee_amount === "" || !Number.isFinite(Number(job.fee_amount))) return null;
  const cents = Math.round(Number(job.fee_amount) * 100);
  if (job.quote_id) return cents / 100;
  return (cents + Math.floor((cents * 5 + 50) / 100)) / 100;
}

// The fee label, by where the fee comes from.
// quote_vat_mode comes with the job from getJob: a No VAT quote has no VAT in its total.
export const feeLabel = (job) => {
  if (!job?.quote_id) return "Fee (AED, before VAT)";
  return job.quote_vat_mode === "none" ? "Fee (AED, no VAT, from the quote)" : "Fee (AED, including VAT, from the quote)";
};

// Linking a quote sets the fee to its total, so staff are asked first when the job already has a different fee.
export const feeConflict = (job, doc) => job.fee_amount != null && Number(doc.total_amount) > 0 && Number(job.fee_amount) !== Number(doc.total_amount);

// A quotation or letter filed for another client should not link to a job silently.
export const sameClientName = (a, b) => {
  const n = (v) => String(v ?? "").trim().toLowerCase();
  return n(a) !== "" && n(a) === n(b);
};

// ── Follow-up rules ─────────────────────────────────────────────────
// Newest contacted_on per job, from follow-up rows ({ job_id, contacted_on }).
export function lastContactByJob(rows) {
  const last = {};
  for (const r of rows || []) if (r.contacted_on && (!last[r.job_id] || r.contacted_on > last[r.job_id])) last[r.job_id] = r.contacted_on;
  return last;
}

// The log form always needs a next date: the database treats a blank one as due at once.
export function followUpFormError(v, today = dubaiToday()) {
  if (!v.next_follow_up_on) return "Set the next follow-up date. A job with no next date is shown as due at once.";
  if (v.contacted_on > today) return "The contact date cannot be in the future.";
  if (v.next_follow_up_on < today) return "The next follow-up date cannot be in the past.";
  return null;
}

// The client's address from the client lookup: the linked Client Master record first, then the exact name. Empty when none.
export function clientEmail(clients, job) {
  const byId = job.client_id ? (clients || []).find((c) => Number(c.rank) === 1 && String(c.ref) === String(job.client_id)) : null;
  return byId?.email || findLookupRow(clients, job.client_name)?.email || "";
}

export const mailtoLink = (to, subject, body) => `mailto:${encodeURIComponent(to || "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
