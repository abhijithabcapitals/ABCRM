// AB Capital engagement letters made from Company Templates: the form's fields, a quote as a starting point, and the letter's data.
// Pure, so it is tested. The wording comes from the engagement terms in Template Hub settings.
import { formFields } from "./libraryFields.js";
import { letterData, quoteData, vatStatement } from "./serviceDocs.js";

export const LETTER_TEMPLATE = "Service_Engagement_Template.docx";
export const QUOTE_TEMPLATE = "Service_Quotation_Template.docx";
const section = (name, label) => ({ name, label, type: "textarea", full: true, rows: 4 });
// The wording boxes of each design. Saved per work type under these names, and on each document in field_values.sections.
export const SECTIONS = {
  quote: [section("intro", "Introductory message"), section("understanding", "A. Understanding of requirements"), section("scope", "B. Scope of services"),
    section("payment", "D. Payment terms"), section("additional", "E. Additional terms or notes")],
  letter: [section("understanding", "A. Our understanding of your requirements"), section("scope", "B. Scope of service"), section("fee_intro", "C. Our fees: wording"),
    section("payment", "D. Payment terms"), section("reps", "E. Representations and warranties"), section("other", "F. Other terms and conditions")],
};
// An empty box means the saved default, so it is not stored.
export const cleanSections = (sections) => Object.fromEntries(Object.entries(sections || {}).filter(([, v]) => String(v ?? "").trim() !== ""));
const TAX_NOTE = "The fees are plus applicable taxes.";

const displayDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso || "";
};

export function letterFields() {
  const fields = formFields({ fields: ["client_name", "contact_name", "contact_email", "contact_phone", "client_address", "license_number", "vat_trn", "date"] }, "AB Capital");
  return fields.map((f) => (f.name === "client_address" ? { ...f, label: "Client address" } : f.name === "date" ? { ...f, required: true } : f));
}

// What a letter copies from the quote it starts from. The date stays today's.
export function quoteToForm(q) {
  const values = {};
  for (const k of ["client_name", "contact_name", "contact_email", "contact_phone", "client_address", "license_number", "vat_trn"]) { const v = q[k] || q.field_values?.[k]; if (v) values[k] = v; }
  return {
    values,
    clientId: q.client_id || null,
    parentId: q.id,
    rows: (q.lines || []).map((l) => ({ label: l.description, amount: l.amount, remarks: l.remarks || "", rate: l.rate || "" })),
  };
}

// doc is the created row, or the same shape before a number exists for the trial render.
export function letterContext(doc, company, terms, date) {
  const data = letterData(doc, company, terms, []);
  const none = vatStatement("none");
  const payment = (data.payment_terms || []).map((p) => ({ ...p, text: p.text.split(none).join(TAX_NOTE) }));
  const paymentText = data.payment_text.split(none).join(TAX_NOTE);
  return { ...data, payment_terms: payment, payment_text: paymentText, vat_statement: TAX_NOTE, document_number: doc.document_number || "", document_date: displayDate(date) };
}

export function designContext(kind, doc, company, terms, date) {
  if (kind === "letter") return letterContext(doc, company, terms, date);
  const data = quoteData(doc, company, terms);
  return { ...data, payment_text: data.payment_text.split(vatStatement("none")).join(TAX_NOTE), document_number: doc.document_number || "", document_date: displayDate(date) };
}
