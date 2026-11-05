// AB Capital engagement letters made from Company Templates: the form's fields, a quote as a starting point, and the letter's data.
// Pure, so it is tested. The wording comes from the engagement terms in Template Hub settings.
import { formFields } from "./libraryFields.js";
import { letterData, vatStatement } from "./serviceDocs.js";

export const LETTER_TEMPLATE = "Service_Engagement_Template.docx";
const TAX_NOTE = "The fees are plus applicable taxes.";

const displayDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso || "";
};

export function letterFields() {
  const fields = formFields({ fields: ["client_name", "contact_name", "contact_email", "contact_phone", "client_address", "license_number", "vat_trn", "date"] }, "AB Capital");
  return fields.map((f) => (f.name === "client_address" ? { ...f, label: "Client address" } : f));
}

// What a letter copies from the quote it starts from. The date stays today's.
export function quoteToForm(q) {
  const values = {};
  for (const k of ["client_name", "contact_name", "contact_email", "contact_phone", "client_address", "license_number", "vat_trn"]) if (q[k]) values[k] = q[k];
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
  return { ...data, payment_terms: payment, vat_statement: TAX_NOTE, document_number: doc.document_number || "", document_date: displayDate(date) };
}
