// Pure helpers for the Notification Centre page. No imports.
// "today" is always passed in as an Asia/Dubai date string (YYYY-MM-DD); see dubaiToday().

export const FILTERS = ["All", "Urgent", "Due Today", "Client Pending", "Government Pending"];

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

export function emptyText(access, filter) {
  if (filter && filter !== "All") return "Nothing matches this filter";
  return "Nothing assigned to you";
}

// Tabs the caller may see. The server still refuses on its own.
export function tabsFor(access) {
  const tabs = ["My Notifications"];
  if (access?.is_admin || access?.is_manager) tabs.push("Department");
  if (access?.is_admin) tabs.push("Management", "Settings");
  return tabs;
}
