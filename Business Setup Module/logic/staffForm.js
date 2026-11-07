// What staff can add to a client's form while it is In review. Pure, so it is tested against the form definition (migration 009).
// DOC_KINDS are the document types the form asks for. FIELDS are the plain answers the form requires (the same keys
// business_setup_form_missing_items reads). Services wanted and the first partner are kept apart because they are stored as a list.
export const DOC_KINDS = ["Passport", "Emirates visa", "Emirates ID", "Ejari", "Bank statement", "Utility bill", "Old visa", "Old Emirates ID", "Other"];
export const FIELDS = [
  ["client_name", "Client name"], ["phone", "Phone"], ["email", "Email"], ["company_status", "Company status"], ["activity", "Business activity"], ["zone", "Preferred zone"],
  ["licence_number", "Licence number"], ["licence_expiry", "Licence expiry"], ["issuing_authority", "Issuing authority"],
];
export const SERVICES_FIELD = "services_text";
// The client's own identity details. Not required by the form, but staff can fill them; validation copies them to the KYC details.
export const ID_FIELDS = [
  ["emirates_id", "Emirates ID number"], ["emirates_id_expiry", "Emirates ID expiry"], ["passport_number", "Passport number"], ["passport_expiry", "Passport expiry"],
  ["nationality", "Nationality"], ["date_of_birth", "Date of birth"], ["address", "Residential address"],
];
export const DATE_FIELDS = new Set(["licence_expiry", "emirates_id_expiry", "passport_expiry", "date_of_birth"]);
// One shareholder row. The keys are the ones the client form stores (migration 009) plus the ID numbers KYC partners hold.
export const PARTNER_KEYS = ["name", "nationality", "share", "ubo", "emirates_id", "passport_number"];

const text = (v) => String(v ?? "");
const blankPartner = () => ({ name: "", nationality: "", share: "", ubo: false, emirates_id: "", passport_number: "" });

// A shareholder as the dialog edits it: every key present, text for text, a boolean for UBO.
const editPartner = (p = {}) => ({ ...p, ...Object.fromEntries(PARTNER_KEYS.map((k) => [k, k === "ubo" ? !!p.ubo : text(p[k])])) });

// A shareholder as the form stores it: trimmed, share as a number, empty ID numbers left out. Other keys the client sent stay.
function storedPartner(p) {
  const out = { ...p, name: text(p.name).trim(), nationality: text(p.nationality).trim(), ubo: !!p.ubo };
  const share = text(p.share).trim();
  if (share === "") delete out.share; else out.share = Number(share);
  for (const k of ["emirates_id", "passport_number"]) { const v = text(p[k]).trim(); if (v) out[k] = v; else delete out[k]; }
  return out;
}

const isBlank = (p) => !text(p.name).trim() && !text(p.nationality).trim() && !text(p.share).trim() && !p.ubo && !text(p.emirates_id).trim() && !text(p.passport_number).trim();

// The values shown in the dialog. partners is a list the dialog edits row by row.
export function formValues(a = {}) {
  const partners = (a.partners || []).map(editPartner);
  return {
    ...Object.fromEntries([...FIELDS, ...ID_FIELDS].map(([k]) => [k, a[k] ?? ""])),
    [SERVICES_FIELD]: (a.services || []).join(", "),
    partners: partners.length ? partners : [blankPartner()],
  };
}

export const newPartner = blankPartner;

// What is wrong with the shareholders, or null. Blank rows are ignored.
export function partnerProblem(partners = []) {
  const rows = partners.filter((p) => !isBlank(p));
  if (rows.some((p) => !text(p.name).trim())) return "Every shareholder needs a name";
  let total = 0;
  for (const p of rows) {
    const s = text(p.share).trim();
    if (s === "") continue;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0 || n > 100) return `The share of ${text(p.name).trim()} must be a number from 0 to 100`;
    total += n;
  }
  if (total > 100.0001) return `The shares add up to ${Math.round(total * 100) / 100}%, more than 100%`;
  return null;
}

// The total share entered, for the dialog to show.
export const shareTotal = (partners = []) => Math.round(partners.reduce((t, p) => t + (Number(text(p.share).trim()) || 0), 0) * 100) / 100;

// Only what changed, in the shape the form stores.
export function changedAnswers(v, a = {}) {
  const out = {};
  for (const [k] of [...FIELDS, ...ID_FIELDS]) if (text(v[k]) !== text(a[k])) out[k] = v[k] === "" ? null : v[k];
  const services = text(v[SERVICES_FIELD]).split(",").map((s) => s.trim()).filter(Boolean);
  if (services.join("|") !== (a.services || []).join("|")) out.services = services;
  if (v.partners) {
    const next = v.partners.filter((p) => !isBlank(p)).map(storedPartner);
    const old = (a.partners || []).map(storedPartner);
    if (JSON.stringify(next) !== JSON.stringify(old)) out.partners = next;
  }
  return out;
}
