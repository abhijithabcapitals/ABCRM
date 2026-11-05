// Pure helpers for the Notification Centre page. No imports.
// "today" is always passed in as an Asia/Dubai date string (YYYY-MM-DD); see dubaiToday().

export const FILTERS = ["All", "Urgent", "Due Today", "Client Pending", "Government Pending"];
// Department and Management work the backlog too.
export const MANAGER_FILTERS = [...FILTERS, "Backlog"];

// Stored priorities only. "Urgent" is a display tag and never a priority.
export const PRIORITY_STYLES = {
  Critical: { background: "#fee2e2", color: "#b91c1c" },
  High: { background: "#ffedd5", color: "#c2410c" },
  Medium: { background: "#fef9c3", color: "#854d0e" },
  Normal: { background: "#dbeafe", color: "#1d4ed8" },
};

export const TAG_STYLES = {
  Urgent: { background: "#b91c1c", color: "#fff" },
  "Action required": { background: "#fff7ed", color: "#c2410c" },
  Upcoming: { background: "#f1f5f9", color: "#475569" },
};
export const BACKLOG_STYLE = { background: "#ede9fe", color: "#5b21b6" };

export function dubaiToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function dayNumber(d) {
  if (!d) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d));
  if (!m) return null;
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
}

// Days from today to the due date: negative when overdue, null with no date.
export function daysUntil(dueDate, today) {
  const a = dayNumber(dueDate), b = dayNumber(today);
  return a == null || b == null ? null : a - b;
}

// Urgent: Critical, or High and overdue. Action required: other High or Medium, due within 7 days, overdue or undated.
// Upcoming: High or Medium due later than 7 days. Normal has no tag.
export function tagFor(alert, today) {
  const p = alert?.priority;
  const d = daysUntil(alert?.due_date, today);
  if (p === "Critical") return "Urgent";
  if (p === "High" && d != null && d < 0) return "Urgent";
  if (p === "High" || p === "Medium") return d != null && d > 7 ? "Upcoming" : "Action required";
  return null;
}

export function daysLabel(dueDate, today) {
  const d = daysUntil(dueDate, today);
  if (d == null) return "No date";
  if (d === 0) return "Due today";
  const n = Math.abs(d);
  const unit = n === 1 ? "day" : "days";
  return d < 0 ? `${n} ${unit} overdue` : `${n} ${unit} left`;
}

// True when a Notification Centre function is missing because the migration is not applied yet.
export function isNotSwitchedOn(error) {
  const code = error && typeof error === "object" ? error.code : null;
  return code === "42883" || code === "PGRST202";
}

export const PREVIEW_TEXT = "The Notification Centre is in preview. Alerts will show here once it is switched on.";

// In Preview only admins see alerts, so an empty list says nothing about the work. It must not read as all clear.
export function emptyText(access, filter) {
  if (access?.mode === "Preview" && !access?.is_admin) return PREVIEW_TEXT;
  if (filter && filter !== "All") return "Nothing matches this filter";
  return "Nothing assigned to you";
}

// One page of the alert list. The server caps a single read at 500.
export const ALERT_PAGE = 100;

// Reads pages until `want` rows or a short page. fetchPage(limit, offset) returns { rows, total }.
export async function readAlertRows(fetchPage, want = ALERT_PAGE, pageSize = ALERT_PAGE) {
  let rows = [];
  let total = 0;
  while (rows.length < want) {
    const page = await fetchPage(pageSize, rows.length);
    const got = page?.rows || [];
    rows = rows.concat(got);
    total = page?.total || 0;
    if (got.length < pageSize) break;
  }
  return { rows, total };
}

// Load more adds at the end. A row can repeat when the list shifted between two reads.
export function appendAlertRows(rows, more) {
  const seen = new Set(rows.map((r) => r.id));
  return rows.concat(more.filter((r) => !seen.has(r.id)));
}

// The server refuses to close a Critical alert with no note.
export function resolvePlaceholder(priority) {
  return priority === "Critical" ? "Resolution note (required for a Critical alert)" : "Resolution note (optional)";
}

// Tabs the caller may see. The server still refuses on its own.
export function tabsFor(access) {
  const tabs = ["My Notifications"];
  if (access?.is_admin || access?.is_manager) tabs.push("Department");
  if (access?.can_register) tabs.push("Compliance Register");
  if (access?.is_admin) tabs.push("Management", "Settings");
  return tabs;
}

// The red band over Management: a failed last scan, or no good scan in 26 hours. Null when healthy or unknown.
export function scanBand(coverage) {
  if (!coverage) return null;
  if (String(coverage.last_scan_status || "").toLowerCase() === "failed") {
    return `The last scan failed${coverage.last_scan_error ? `: ${coverage.last_scan_error}` : "."} Counts below may be out of date.`;
  }
  if (coverage.stale) return "No successful scan in the last 26 hours. Counts below may be out of date.";
  return null;
}

// The "based on" line under a tile when its rule had data for fewer than half the records it checked.
// A rule that was never scanned (checked null) has nothing to say.
export function basedOnNote(rule) {
  if (!rule || rule.checked == null) return null;
  const checked = Number(rule.checked), withData = Number(rule.with_data ?? 0);
  if (checked === 0) return "No records checked";
  return withData * 2 < checked ? `Based on ${withData} of ${checked} records with a date` : null;
}

// Sums checked and with_data over the rules in the given categories and applies basedOnNote.
// Null when no such rule has been scanned, so a tile with no matching rule shows no line.
// The rules behind a tile that counts by due date (Overdue, Upcoming, Today's Work): deadlines, licences and visas alike.
export const DUE_DATE_CATEGORIES = ["Deadlines", "Licence", "Visa & Emirates ID", "Ejari & Establishment Card"];

export function noteForCategories(coverage, categories) {
  const rules = (coverage?.rules || []).filter((r) => categories.includes(r.category) && r.checked != null);
  if (!rules.length) return null;
  return basedOnNote({
    checked: rules.reduce((n, r) => n + Number(r.checked), 0),
    with_data: rules.reduce((n, r) => n + Number(r.with_data ?? 0), 0),
  });
}

// The plain sentence the mode switch asks before it changes anything: who starts (or stops) receiving what.
export function modeConfirmText(from, to) {
  if (to === from) return null;
  if (to === "Preview") return "Switch to Preview? Nobody will be belled, nothing will escalate, and only admins can see alerts.";
  if (to === "Triage") {
    return from === "Live"
      ? "Switch to Triage? Managers stop being belled and escalation stops. People assigned to an alert keep their bell, for new threshold crossings only."
      : "Switch to Triage? People assigned to an alert start getting a bell, for new threshold crossings only. Backlog alerts never bell. Managers are not belled and nothing escalates.";
  }
  return from === "Preview"
    ? "Switch to Live? People assigned to an alert start getting a bell for new threshold crossings, managers start getting bells for unassigned and escalated alerts, and escalation starts. Backlog alerts still never bell."
    : "Switch to Live? Managers start getting bells for unassigned and escalated alerts, and escalation starts. People assigned to an alert already get a bell.";
}

// A scan time for display, in Asia/Dubai.
export function fmtScanTime(ts) {
  if (!ts) return "never";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", dateStyle: "medium", timeStyle: "short" }).format(d);
}
