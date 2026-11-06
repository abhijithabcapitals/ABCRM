// CHANGES MADE card: pure helpers, so they are tested.

// Groups shown as filter buttons. A change belongs to the first group whose fields match.
export const CHANGE_GROUPS = [
  { key: "All", match: () => true },
  { key: "Trade License", match: (f) => /licen[cs]e/i.test(f) },
  { key: "Registration & Dates", match: (f) => /registration|establishment|date|expiry/i.test(f) && !/passport/i.test(f) },
  { key: "Shareholders", match: (f) => /shareholder|partner|ubo|ownership|name|nationality/i.test(f) },
  { key: "Emirates ID", match: (f) => /emirates id/i.test(f) },
  { key: "Passport", match: (f) => /passport/i.test(f) },
];

export function filterChanges(items, group = "All", query = "") {
  const g = CHANGE_GROUPS.find((x) => x.key === group) || CHANGE_GROUPS[0];
  const q = String(query || "").trim().toLowerCase();
  return (items || []).filter((c) => {
    if (!g.match(String(c.field || ""))) return false;
    if (!q) return true;
    return [c.client_name, c.client_id, c.person, c.field, c.changed_by_name, c.old_value, c.new_value]
      .some((v) => String(v ?? "").toLowerCase().includes(q));
  });
}

// "Shareholder Ali: Emirates ID" or just the field.
export const changeWhat = (c) => (c.person && !/added|removed|restored/i.test(c.field) ? `${c.person}: ${c.field}` : c.field);
export const showValue = (v) => (v === null || v === undefined || String(v).trim() === "" ? "(blank)" : String(v));
