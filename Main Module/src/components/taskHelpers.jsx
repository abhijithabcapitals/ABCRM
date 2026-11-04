// Pure helpers and small display pieces for the Tasks page.
export const PRIORITY_STYLES = {
  // High keeps the loud red (it's the signal that matters); Medium is the
  // neutral default, so it's muted grey; Low recedes to a soft slate.
  High: { bg: "#fee2e2", color: "#b91c1c", dot: "#ef4444" },
  Medium: { bg: "#eef1f4", color: "#556270", dot: "#94a3b8" },
  Low: { bg: "#f1f5f4", color: "#5c7a6f", dot: "#84b09e" },
};

// Return a text color with enough contrast on a light tint of `hex`: light
// status colors get darkened so pills stay readable (fixes pale-on-pale text).
export function readableInk(hex) {
  if (!hex || hex[0] !== "#" || hex.length < 7) return hex || "#374151";
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (lum > 0.55) {
    const d = (x) => Math.round(x * 0.42);
    return `rgb(${d(r)}, ${d(g)}, ${d(b)})`;
  }
  return hex;
}

// White or dark text for a SOLID background of `hex` (keeps bold pills readable).
export function contrastText(hex) {
  if (!hex || hex[0] !== "#" || hex.length < 7) return "#fff";
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? "#1f2937" : "#fff";
}

export const FORMULA_PRESETS = [
  {
    key: "days_since_created",
    label: "Days since created",
    fn: (task) =>
      Math.floor((Date.now() - new Date(task.created_at)) / 86400000),
  },
  {
    key: "days_since_updated",
    label: "Days since updated",
    fn: (task) =>
      Math.floor(
        (Date.now() - new Date(task.updated_at || task.created_at)) / 86400000,
      ),
  },
  {
    key: "days_until_due",
    label: "Days until due date",
    fn: (task) =>
      task.due_date
        ? Math.ceil((new Date(task.due_date) - Date.now()) / 86400000)
        : null,
  },
  { key: "custom", label: "Custom (manual text)", fn: () => null },
];

// fmtDate / fmtDMY now live in ../dateFormat so every view stays consistent.

// Split a "list" field's stored value (one item per line) into clean items.
export function listItems(value) {
  return String(value || "").split(/\r?\n/).map((s) => s.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean);
}
export function ListValue({ value, fontSize = 12 }) {
  const items = listItems(value);
  if (items.length === 0) return "—";
  return (
    <ul style={{ margin: 0, paddingLeft: 16 }}>
      {items.map((it, i) => (
        <li key={i} style={{ fontSize, color: "#555", lineHeight: 1.5 }}>{it}</li>
      ))}
    </ul>
  );
}

// VAT cycle: next due date = base date + `months` months, snapped to `day`
// (clamped to the month length). Base is the task's current due date, or today
// if it has none. Returns an ISO yyyy-mm-dd string. Mirrors _abcap_shift_date.
export function advanceDue(baseStr, months = 3, day = 28) {
  const base = baseStr ? new Date(baseStr) : new Date();
  if (isNaN(base)) return "";
  let y = base.getUTCFullYear();
  let m = base.getUTCMonth() + months;
  y += Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const d = Math.min(day, lastDay);
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseFlexibleDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  // ISO first (year-first): "2026-03-01" or "2026-03-01T..". Build from parts in
  // UTC so a date-only value never shifts a day across timezones.
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  // Day-first "dd-mm-yyyy" / "dd/mm/yyyy" (1–2 digit day & month). This app
  // displays and reads dates day-first, so parse them day-first explicitly —
  // JS's own `new Date("01-03-2026")` would wrongly read them month-first (US)
  // and swap the day and month.
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  // Fallback for long forms like "Thursday, February 26th 2026".
  const cleaned = s.replace(/(\d+)(st|nd|rd|th)/gi, "$1").replace(/^[A-Za-z]+,\s*/, "");
  const d = new Date(cleaned);
  return isNaN(d) ? null : d;
}

// Returns a human-readable formula expression for a formula field, e.g.
// "TODAY() − [Pre-approved date]" so users see the actual computation.
export function describeFormula(field) {
  if (field.field_type !== "formula") return "";
  const opts = field.field_options || [];
  const key = opts[0] || "days_since_created";
  switch (key) {
    case "days_since_created":
      return "TODAY() − Created Date";
    case "days_since_updated":
      return "TODAY() − Last Updated";
    case "days_until_due":
      return "Due Date − TODAY()";
    case "days_since_date_field": {
      const name = (opts[1] || "").trim();
      return name ? `TODAY() − [${name}]` : "TODAY() − [date field]";
    }
    case "custom":
      return (opts[1] || "").trim() || "(no formula)";
    default:
      return key;
  }
}

export function computeFormula(field, task, allFields, lookupFields) {
  if (field.field_type !== "formula") return null;
  const opts = field.field_options || [];
  const key = opts[0] || "days_since_created";
  const now = Date.now();
  if (key === "days_since_created") {
    if (!task.created_at) return "—";
    const days = Math.floor((now - new Date(task.created_at)) / 86400000);
    return `${days} day${days !== 1 ? "s" : ""}`;
  }
  if (key === "days_since_updated") {
    const ref = task.updated_at || task.created_at;
    if (!ref) return "—";
    const days = Math.floor((now - new Date(ref)) / 86400000);
    return `${days} day${days !== 1 ? "s" : ""}`;
  }
  if (key === "days_until_due") {
    if (!task.due_date) return "No due date";
    const days = Math.ceil((new Date(task.due_date) - now) / 86400000);
    if (days < 0)
      return `${Math.abs(days)} day${Math.abs(days) !== 1 ? "s" : ""} overdue`;
    if (days === 0) return "Due today";
    return `${days} day${days !== 1 ? "s" : ""} left`;
  }
  if (key === "days_since_date_field") {
    const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
    const target = norm(opts[1]);
    if (!target) return "—";
    // Duplicate field names can exist across scopes/imports, so match ALL
    // fields with this name and find the value stored against any of them.
    const pool = [...(allFields || []), ...(lookupFields || [])];
    const matchingIds = new Set(
      pool.filter((f) => norm(f.field_name) === target).map((f) => f.id),
    );
    if (matchingIds.size === 0) return `(field "${opts[1]}" not found)`;
    const fv = (task.task_field_values || []).find(
      (v) => matchingIds.has(v.field_id) && v.value,
    );
    if (!fv?.value) return "—";
    const d = parseFlexibleDate(fv.value);
    if (!d) return "—";
    const days = Math.floor((now - d) / 86400000);
    return `${days} day${days !== 1 ? "s" : ""}`;
  }
  if (key === "custom") {
    const expr = (opts[1] || "").trim();
    if (!expr) return "—";
    if (expr.includes("days_since(created_at)")) {
      const days = Math.floor((now - new Date(task.created_at)) / 86400000);
      return expr.replace("days_since(created_at)", `${days} days`);
    }
    if (
      expr.includes("days_until(due_date)") ||
      expr.includes("days_between(created_at, due_date)")
    ) {
      if (!task.due_date) return "No due date";
      const days = Math.ceil((new Date(task.due_date) - now) / 86400000);
      const label =
        days < 0
          ? `${Math.abs(days)} days overdue`
          : days === 0
            ? "Due today"
            : `${days} days left`;
      return expr
        .replace("days_until(due_date)", label)
        .replace("days_between(created_at, due_date)", label);
    }
    return expr;
  }
  return "—";
}

export function PriorityDot({ priority }) {
  const s = PRIORITY_STYLES[priority] || PRIORITY_STYLES.Medium;
  return (
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: s.dot,
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}

export function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr);
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatFullDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
