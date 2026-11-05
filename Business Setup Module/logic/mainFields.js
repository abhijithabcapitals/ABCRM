// The department's main client fields, and what a client still lacks. The database lists what is missing (business_setup_client_main_fields).
export const MAIN_FIELDS = [
  { name: "service", label: "Service" },
  { name: "zone", label: "Zone" },
  { name: "licence_number", label: "Licence number" },
  { name: "licence_date", label: "Issue date", type: "date" },
  { name: "licence_expiry", label: "Expiry date", type: "date" },
  { name: "shareholder", label: "Shareholder" },
  { name: "manager", label: "Manager" },
  { name: "visa", label: "Visa" },
];

export function mergeMainFields(rows, main) {
  const byId = new Map((main || []).map((m) => [m.client_id, m]));
  return (rows || []).map((r) => {
    const m = byId.get(r.client_id);
    return { ...r, ...(m || {}), missing: m ? m.missing || [] : MAIN_FIELDS.map((f) => f.label), dates_to_check: Boolean(m?.dates_to_check) };
  });
}

// True when the client needs someone to complete or check something.
export const needsAttention = (r) => (r.missing || []).length > 0 || Boolean(r.dates_to_check);

export const isExpired = (date, today = new Date().toISOString().slice(0, 10)) => Boolean(date) && date < today;

// Every field goes back, so a value someone cleared is cleared. An untouched blank stays blank.
export function mainFieldsPayload(values) {
  return Object.fromEntries(MAIN_FIELDS.map((f) => [f.name, String(values?.[f.name] ?? "").trim()]));
}

// A field the client lacks says so in its label, so staff can see what to fill.
export function mainFieldsForm(row) {
  const missing = new Set(row?.missing || []);
  return MAIN_FIELDS.map((f) => ({ ...f, label: missing.has(f.label) ? `${f.label} (missing)` : f.label }));
}
