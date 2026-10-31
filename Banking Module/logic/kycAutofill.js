// Turns Document Module (docai) results into KYC values for a person to check. Pure, so it is tested.
// A value found in two documents with different readings is left for staff, with both shown.

// docai canonical field -> banking_kyc_profiles column
export const FIELD_MAP = {
  legal_name: "legal_name", trade_name: "trade_name", licence_number: "license_number", licence_authority: "issuing_authority",
  licence_issue_date: "license_issue_date", licence_expiry_date: "license_expiry_date", entity_type: "legal_structure", main_activity: "business_activity",
  registered_address: "registered_address", office_address: "office_address", website: "website", email: "company_email", phone: "company_phone", vat_trn: "vat_trn",
};

// docai document type -> banking_document_types.doc_code. Unlisted types are chosen by staff.
export const DOC_TYPE_MAP = {
  TradeLicence: "TRADE_LICENSE", MOA: "MOA", EmiratesID: "EMIRATES_ID", Passport: "PASSPORT", Visa: "VISA", VATCertificate: "VAT_CERT", ShareCertificate: "SHARE_CERT",
  IncorporationCertificate: "INCORP_CERT", IncumbencyCertificate: "INCUMBENCY", Ejari: "OFFICE_EJARI", CV: "CV", CompanyProfile: "COMPANY_PROFILE",
};

const norm = (v) => String(v ?? "").trim().toUpperCase();

export function buildAutofill(docs) {
  const values = {}, sources = {}, conflicts = {};
  const people = new Map();
  const put = (col, value, source) => {
    if (value === null || value === undefined || value === "") return;
    if (values[col] !== undefined && norm(values[col]) !== norm(value)) {
      conflicts[col] = [...(conflicts[col] || [`${values[col]} (${sources[col]})`]), `${value} (${source})`];
      return;
    }
    if (values[col] === undefined) { values[col] = value; sources[col] = source; }
  };
  for (const d of docs) {
    const ex = d.extraction || {};
    for (const f of ex.fields || []) {
      const key = f.key;
      if (f.confidence === "low") continue;
      if (FIELD_MAP[key]) put(FIELD_MAP[key], f.value, d.name);
      if (key === "vat_registered" && /yes/i.test(String(f.value))) put("vat_registered", true, d.name);
      if (key === "jurisdiction") {
        put("is_free_zone", /free zone/i.test(String(f.value)), d.name);
      }
    }
    for (const p of ex.people || []) {
      if (!p.name) continue;
      const k = norm(p.name);
      people.set(k, { ...(people.get(k) || {}), full_name: p.name, nationality: p.nationality || people.get(k)?.nationality || null, source: d.name });
    }
    for (const r of ex.rows || []) {
      const row = r.item || {};
      if (r.list !== "shareholders" || !row.name || r.confidence === "low") continue;
      const k = norm(row.name);
      const pct = row.ownership != null ? Number(String(row.ownership).replace("%", "")) : null;
      people.set(k, { ...(people.get(k) || {}), full_name: row.name, nationality: row.nationality || people.get(k)?.nationality || null, ownership_percent: Number.isFinite(pct) ? pct : null, source: d.name });
    }
  }
  if (values.vat_trn && values.vat_registered === undefined) values.vat_registered = true;
  return { values, sources, conflicts, shareholders: [...people.values()] };
}

// Rows for the review table on an existing client. "new": field is empty. "differs": a person must decide.
export function compareWithCurrent(auto, current, labels = {}) {
  const rows = [];
  for (const [field, read] of Object.entries(auto.values)) {
    const now = current[field];
    const empty = now === undefined || now === null || now === "";
    if (!empty && norm(now) === norm(read)) continue;
    rows.push({ field, label: labels[field] || field, current: now, read, source: auto.sources[field], state: empty ? "new" : "differs" });
  }
  return rows;
}

// The expiry date a document states, if the Document Module read one with enough confidence.
export function expiryFrom(doc) {
  const f = (doc?.extraction?.fields || []).find((x) => /expiry/i.test(x.key || "") && x.confidence !== "low");
  return /^\d{4}-\d{2}-\d{2}$/.test(f?.value || "") ? f.value : null;
}
