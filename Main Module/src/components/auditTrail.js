export const ACTION_LABEL = { INSERT: "Added", UPDATE: "Changed", DELETE: "Deleted", LOGIN: "Logged in", LOGOUT: "Logged out", PAGE: "Opened page", CLICK: "Clicked" };

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

// The short text in the list: fields changed, what was clicked, or where a login came from.
export function auditDetail(r) {
  if (r.changed?.length) return r.changed.join(", ");
  const v = r.new_values || {};
  if (r.action === "CLICK") return [v.element, v.label].filter(Boolean).join(": ") || "–";
  if (r.action === "LOGIN" || r.action === "LOGOUT") return v.ip || "–";
  return "–";
}

// Every person once: staff with or without a login, and logins with no employee record.
export function auditPeople(employees, profiles) {
  const linked = new Set(employees.map((e) => e.profile_id).filter(Boolean));
  const people = [
    ...employees.map((e) => ({ key: `e:${e.id}`, label: e.full_name, employee: e.id, actor: e.profile_id || null })),
    ...profiles.filter((p) => !linked.has(p.id)).map((p) => ({ key: `p:${p.id}`, label: p.full_name || p.email, employee: null, actor: p.id })),
  ];
  return people.sort((a, b) => String(a.label).localeCompare(String(b.label)));
}

// The filter for one person: what they did, and what was done to their employee records.
export function auditPersonFilter(person) {
  return [person.actor && `actor.eq.${person.actor}`, person.employee && `employee_id.eq.${person.employee}`].filter(Boolean).join(",");
}

// Dubai day boundaries for the date filters, and characters that would break the search filter removed.
export const dayStart = (d) => `${d}T00:00:00+04:00`;
export const dayEnd = (d) => `${d}T23:59:59.999+04:00`;
export const cleanSearch = (s) => s.replace(/[,()%*\\"]/g, " ").replace(/\s+/g, " ").trim();
