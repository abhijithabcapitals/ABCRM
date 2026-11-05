// Reads {{tags}} from a library .docx and turns them into form fields.
// Pure: JSZip is passed in, nothing is imported.

export const COMPANIES = ["AB Capital", "Ardentax"];

const SYSTEM = new Set(["ref_no", "total", "total_usd"]);
const KNOWN = {
  client_name: { label: "Client name", required: "both" },
  contact_name: { label: "Contact person", required: "ab" },
  contact_email: { label: "Email", required: "ab" },
  contact_phone: { label: "Phone", required: "ab" },
  client_address: { label: "Client address", full: true },
  business_activity: { label: "Business activity", required: "ab" },
  business_name: { label: "Business name", required: "ab" },
  date: { label: "Date", type: "date" },
  // Ardentax Master. Only client_name is required there.
  document_title: { label: "Document title" },
  document_subtitle: { label: "Subtitle or service line" },
  version_status: { label: "Version or status" },
  prepared_by: { label: "Prepared by" },
  approved_by: { label: "Approved by" },
  reviewed_by: { label: "Reviewed by" },
  confidentiality: { label: "Confidentiality" },
  trade_name: { label: "Trade name" },
  signatory: { label: "Authorised signatory" },
  city_country: { label: "City, emirate, country" },
  license_number: { label: "Trade licence or registration no." },
  vat_trn: { label: "TRN" },
  purpose: { label: "Purpose or background", full: true },
  subject_matter: { label: "Services or subject matter", full: true },
  scope: { label: "Scope or deliverables", full: true },
  assumptions: { label: "Assumptions or dependencies", full: true },
  exclusions: { label: "Exclusions or limitations", full: true },
  payment_terms: { label: "Payment terms", full: true },
  validity_term: { label: "Validity, effective date or term", full: true },
  currency_tax: { label: "Currency and tax treatment", full: true },
  terms_conditions: { label: "Terms and conditions", full: true },
  data_protection: { label: "Confidentiality and data protection", full: true },
  attachments: { label: "Attachments or annexures", full: true },
  additional_notes: { label: "Additional notes", full: true },
  declaration: { label: "Declaration or acknowledgement", full: true },
  ardentax_signatory_name: { label: "Ardentax signatory" },
  ardentax_signatory_title: { label: "Ardentax signatory designation" },
  client_signatory_name: { label: "Client signatory" },
  client_signatory_title: { label: "Client signatory designation" },
  prepared_date: { label: "Prepared on", type: "date" },
  reviewed_date: { label: "Reviewed on", type: "date" },
  approved_date: { label: "Approved on", type: "date" },
  acceptance_by: { label: "Client acceptance received from" },
  acceptance_date: { label: "Client acceptance date or status" },
};
const LONG = /(address|scope|terms|notes?|description|summary|section|remarks|conditions|details)/;

const unxml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

// One string per paragraph: every <w:t> in it joined, so tags split across runs rejoin.
function paragraphs(xml) {
  return xml.split("</w:p>").map((p) => unxml([...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("")));
}

export async function readTags(buffer, JSZip) {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).filter((n) => n === "word/document.xml" || /^word\/(header|footer)[^/]*\.xml$/.test(n));
  const fields = new Set();
  const loop = new Set();
  let hasTags = false;
  for (const n of names) {
    const text = paragraphs(await zip.file(n).async("string")).join("\n");
    let inLoop = false;
    for (const m of text.matchAll(/\{\{\s*([#/]?)\s*([A-Za-z_][\w.]*)\s*\}\}/g)) {
      hasTags = true;
      const [, mark, name] = m;
      if (mark === "#") { inLoop = name === "items"; continue; }
      if (mark === "/") { if (name === "items") inLoop = false; continue; }
      if (inLoop) loop.add(name);
      else if (!SYSTEM.has(name)) fields.add(name);
    }
  }
  return { fields: [...fields], loop: [...loop], hasTags };
}

const labelOf = (name) => { const s = name.replace(/_+/g, " ").trim(); return s.charAt(0).toUpperCase() + s.slice(1); };

export function fieldsFor(tags, company) {
  const ab = company === "AB Capital";
  return (tags.fields || []).map((name) => {
    const k = KNOWN[name] || {};
    const required = k.required === "both" || (k.required === "ab" && ab);
    return { name, label: k.label || labelOf(name), required: !!required, type: k.type || "text", full: !!(k.full ?? (!KNOWN[name] && LONG.test(name))) };
  });
}

const filled = (v) => v != null && String(v).trim() !== "";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function checkRequired(fields, values, rows, company) {
  const v = values || {};
  const problems = [];
  const missing = fields.filter((f) => f.required && !filled(v[f.name])).map((f) => f.label);
  if (missing.length) problems.push(`Fill in: ${missing.join(", ")}.`);
  const emailBad = fields.some((f) => f.name === "contact_email" && filled(v[f.name]) && !EMAIL.test(String(v[f.name]).trim()));
  if (emailBad) problems.push("Email is not a valid address.");
  if (company === "AB Capital" && !(rows || []).some((r) => filled(r?.label))) problems.push("Add at least one fee row with a label.");
  return problems.length ? problems.join(" ") : null;
}

// The form for a template. AB Capital documents are Business Setup quotes, which always need these client details
// and keep an address for the engagement letter, whether or not the template prints them.
export function formFields(tags, company) {
  const fields = fieldsFor(tags, company);
  if (company !== "AB Capital") return fields;
  const missing = ["client_name", "contact_name", "contact_email", "contact_phone", "client_address"].filter((n) => !fields.some((f) => f.name === n));
  const extra = fieldsFor({ fields: missing }, company).map((f) => (f.name === "client_address" ? { ...f, label: "Client address (kept on the record, not printed)" } : f));
  return [...fields, ...extra];
}
