export const ACTION_LABEL = { INSERT: "Added", UPDATE: "Changed", DELETE: "Deleted" };

// A person when the change came from a login, otherwise the system that made it.
export const auditWho = (r) => r.actor_name || r.actor_email || r.actor || `System (${r.source})`;

export const auditValue = (v) => {
  if (v === undefined || v === null || v === "") return "–";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
};

// One line per field for the detail view. Private mail tables store no values, so only names show.
export function auditFields(r) {
  const before = r.old_values || {};
  const after = r.new_values || {};
  const names = r.changed?.length ? r.changed : [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return names.map((field) => ({ field, before: auditValue(before[field]), after: auditValue(after[field]) }));
}

// Dubai day boundaries for the date filters, and characters that would break the search filter removed.
export const dayStart = (d) => `${d}T00:00:00+04:00`;
export const dayEnd = (d) => `${d}T23:59:59.999+04:00`;
export const cleanSearch = (s) => s.replace(/[,()%*\\"]/g, " ").replace(/\s+/g, " ").trim();
