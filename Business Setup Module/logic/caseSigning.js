// AB Capital signing on Business Setup case documents (a quote or engagement letter in hub_documents with case_id), through the
// shared signing (Template Hub 011, Template Module/services/signing.js). Pure, so it is tested: every outside call comes in as an
// argument. Signing is optional: nothing here is needed to create, open or download a document unsigned.
// The signed Word and PDF go under Business Setup/<id>/signed/ in hub-documents and are recorded in document_signatures; the row keeps
// its unsigned file. A new file on the row (Create file, hub_document_attach) ends the signature in the database (011 content trigger).
import { quoteData, letterData } from "../../Template Module/logic/serviceDocs.js";
import { SIGN_TABLE, fileAndWithdraw, hubSignState, hubSignStatus, signHubRow } from "../../Template Module/logic/hubSigning.js";
import { withLineVat } from "./quoteData.js";

export { SIGN_TABLE, fileAndWithdraw };

export const QUOTE_TEMPLATE = "Service_Quotation_Template.docx";
export const LETTER_TEMPLATE = "Service_Engagement_Template.docx";

// What each document is filled with. settings is Template Hub's hub_settings by key (company, engagement_terms); catalogue the
// service categories with their items (a letter prints the limitations of the categories its services belong to).
export const caseQuoteData = (doc, settings) => withLineVat(doc, quoteData(doc, settings?.company, settings?.engagement_terms));
export function letterLimitations(doc, catalogue) {
  const names = (doc.lines || []).map((l) => l.service_name || l.description);
  return [...new Set((catalogue || []).filter((c) => (c.service_items || []).some((x) => names.includes(x.name))).map((c) => c.limitation).filter(Boolean))];
}
export const caseLetterData = (doc, settings, catalogue) => withLineVat(doc, letterData(doc, settings?.company, settings?.engagement_terms, letterLimitations(doc, catalogue)));

// The Word file of a case quote or letter. render(templateFile, data, { signature }) is Template Hub's renderTemplate. Create file
// (unsigned, signature null) and signing (the AB Capital image) draw the same stored row the same way: its number, the date it was
// made (created_at) and its lines, so the signed copy differs from the filed one only by the signature.
export function caseDocumentBlob(doc, signature, { render, settings, catalogue }) {
  return doc?.doc_type === "letter"
    ? render(LETTER_TEMPLATE, caseLetterData(doc, settings, catalogue), { signature })
    : render(QUOTE_TEMPLATE, caseQuoteData(doc, settings), { signature });
}

// The family's rebuild for the shared signing step.
export async function rebuildCaseDocument(doc, signature, ctx) {
  if (!signature) throw new Error("The signature image is needed to sign.");
  return caseDocumentBlob(doc, signature, ctx);
}

// Whether a document can be signed here: a Business Setup case quote or letter made from the built-in design (not a Template Hub
// library document or proposal, which sign where they are made), with its file created, and still current.
export function caseSignable(doc) {
  return !!doc?.id && ["quote", "letter"].includes(doc.doc_type) && doc.department === "Business Setup" && !doc.library_template
    && !!doc.storage_path && !["superseded", "rejected"].includes(doc.status);
}

// What the row shows. canSign is doc_sign_can('ab_capital'); signing is { live, last } (withSignatures). sign: the Sign button.
// copies: the signed Word and PDF, once a live signature exists. openLabel: the plain file's button, "Unsigned copy" beside a signed one.
export const caseSignState = (doc, opts = {}, openLabel = "Open") => hubSignState(doc, opts, openLabel, caseSignable);

// The line that says whether AB Capital signed the document. fmt formats a date.
export const caseSignStatus = hubSignStatus;

// An approver signs a case quote or letter. The stamp is the one on the row being drawn, so a change made in another tab is refused
// by the server ("The document changed"). api = { sign({ table, doc, seen, rebuild }) (signing.js with the hub-documents deps),
// render, loadSettings(), loadCatalogue() }. Returns { signature, wordBlob, pdfBlob } or { error }.
export const signCaseDocument = (doc, api) => signHubRow(doc, {
  signable: caseSignable,
  prepare: async (d) => {
    const [settings, catalogue] = await Promise.all([api.loadSettings(), d.doc_type === "letter" ? api.loadCatalogue() : Promise.resolve([])]);
    return { render: api.render, settings, catalogue };
  },
  rebuild: rebuildCaseDocument,
  sign: api.sign,
});
