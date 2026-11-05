// Map buildAutofill results (OCR) and Client Master rows onto library template tags.
// An allow-list is used on purpose: passport and Emirates ID numbers must never reach a document.

// tag -> source keys in values, tried in order
const TAG_SOURCES = {
  client_name: ["legal_name"],
  contact_email: ["company_email"],
  contact_phone: ["company_phone"],
  client_address: ["registered_address", "office_address"],
  business_activity: ["business_activity"],
  business_name: ["trade_name", "legal_name"],
  trade_name: ["trade_name"],
  license_number: ["license_number"],
  vat_trn: ["vat_trn"],
};

const txt = (v) => (v === null || v === undefined ? "" : String(v).trim());

export function mergeAutofill(values, autofill) {
  const out = { ...(values || {}) };
  const filled = [];
  const av = (autofill && autofill.values) || {};
  const fill = (tag, candidate) => {
    if (txt(out[tag]) || !txt(candidate)) return;
    out[tag] = txt(candidate);
    filled.push(tag);
  };
  for (const [tag, sources] of Object.entries(TAG_SOURCES)) {
    fill(tag, sources.map((s) => av[s]).find((v) => txt(v)));
  }
  const sh = (autofill && autofill.shareholders) || [];
  fill("contact_name", sh[0] && sh[0].full_name);

  const conflicts = {};
  for (const [tag, sources] of Object.entries(TAG_SOURCES)) {
    for (const s of sources) {
      const list = autofill && autofill.conflicts && autofill.conflicts[s];
      if (Array.isArray(list) && list.length) conflicts[tag] = [...(conflicts[tag] || []), ...list];
    }
  }
  return { values: out, filled, conflicts };
}

const MASTER_KEYS = {
  client_name: "Client Legal Name",
  contact_name: "Primary Contact",
  contact_email: "General Email",
  contact_phone: "General Phone",
  client_address: "Registered Address",
};

export function fromClientMaster(row) {
  const data = (row && row.data) || {};
  const out = { client_id: row ? row.client_id : undefined };
  for (const [tag, key] of Object.entries(MASTER_KEYS)) {
    // Primary Contact can hold several names joined with "; ".
    const value = txt(data[key]);
    if (value) out[tag] = tag === "contact_name" ? value.split(";")[0].trim() : value;
  }
  return out;
}

// A document linked to a client shows in that client's login, so the name on it must be that client's.
export function clientLinkProblem(linkedName, clientName) {
  if (!txt(linkedName) || txt(linkedName).toUpperCase() === txt(clientName).toUpperCase()) return null;
  return `This document is linked to ${txt(linkedName)}, but the client name says ${txt(clientName)}. Unlink the client or correct the name.`;
}
