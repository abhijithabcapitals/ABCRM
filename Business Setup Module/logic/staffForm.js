// What staff can add to a client's form while it is In review. Pure, so it is tested against the form definition (migration 009).
// DOC_KINDS are the document types the form asks for. FIELDS are the plain answers the form requires (the same keys
// business_setup_form_missing_items reads). Services wanted and the first partner are kept apart because they are stored as a list.
export const DOC_KINDS = ["Passport", "Emirates visa", "Emirates ID", "Ejari", "Bank statement", "Utility bill", "Old visa", "Old Emirates ID", "Other"];
export const FIELDS = [
  ["client_name", "Client name"], ["phone", "Phone"], ["email", "Email"], ["company_status", "Company status"], ["activity", "Business activity"], ["zone", "Preferred zone"],
  ["licence_number", "Licence number"], ["licence_expiry", "Licence expiry"], ["issuing_authority", "Issuing authority"],
];
export const SERVICES_FIELD = "services_text";
export const PARTNER_FIELDS = ["partner_name", "partner_nationality"];

const text = (v) => String(v ?? "");

// The values shown in the dialog.
export function formValues(a = {}) {
  const p = (a.partners || [])[0] || {};
  return { ...Object.fromEntries(FIELDS.map(([k]) => [k, a[k] ?? ""])), [SERVICES_FIELD]: (a.services || []).join(", "), partner_name: p.name ?? "", partner_nationality: p.nationality ?? "" };
}

// Only what changed, in the shape the form stores.
export function changedAnswers(v, a = {}) {
  const out = {};
  for (const [k] of FIELDS) if (text(v[k]) !== text(a[k])) out[k] = v[k];
  const services = text(v[SERVICES_FIELD]).split(",").map((s) => s.trim()).filter(Boolean);
  if (services.join("|") !== (a.services || []).join("|")) out.services = services;
  const p = (a.partners || [])[0] || {};
  if (text(v.partner_name) !== text(p.name) || text(v.partner_nationality) !== text(p.nationality)) {
    out.partners = [{ ...p, name: text(v.partner_name).trim(), nationality: text(v.partner_nationality).trim() }, ...(a.partners || []).slice(1)];
  }
  return out;
}
