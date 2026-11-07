// AB Capital signing on the Service Desk old form: the quotation and engagement letter of Accounting, Tax Compliance, Business Setup
// and Business Banking (hub_documents without a library template), through the shared signing (Template Hub 011, ./hubSigning.js).
// Pure, so it is tested. Signing is optional: Generate, Create file, View and the mail drafts work as before for an unsigned document.
// The signed Word and PDF go under <department>/<id>/signed/; the row keeps its unsigned file.
import { DEPARTMENTS, letterData, quoteData } from "./serviceDocs.js";
import { withLineVat } from "../../Business Setup Module/logic/quoteData.js";
import { hubSignState, signHubRow } from "./hubSigning.js";
import { isProposalLetter } from "./proposalLetter.js";

export const QUOTE_TEMPLATE = "Service_Quotation_Template.docx";
export const LETTER_TEMPLATE = "Service_Engagement_Template.docx";

// A letter prints the limitations of the categories its services belong to.
export const deskLimitations = (doc, catalogue) =>
  [...new Set((catalogue || []).filter((c) => (c.service_items || []).some((x) => (doc.services || []).includes(x.name))).map((c) => c.limitation).filter(Boolean))];

// What the quotation or letter is filled with. settings is Template Hub's hub_settings by key (company, engagement_terms). A Business
// Setup document with line VAT adds its net and VAT rows.
export function deskDocumentData(doc, settings, catalogue) {
  const company = settings?.company;
  const base = doc.doc_type === "letter"
    ? letterData(doc, company, settings?.engagement_terms, deskLimitations(doc, catalogue))
    : quoteData(doc, company, settings?.engagement_terms);
  return doc.department === "Business Setup" ? withLineVat(doc, base) : base;
}

// The Word file. render(templateFile, data, { signature }) is Template Hub's renderTemplate. Generate and Create file (signature null)
// and signing (the AB Capital image) draw the same stored row the same way: its number, the date it was made and its lines, so the
// signed copy differs from the filed one only by the signature.
export const deskDocumentBlob = (doc, signature, { render, settings, catalogue }) =>
  render(doc.doc_type === "letter" ? LETTER_TEMPLATE : QUOTE_TEMPLATE, deskDocumentData(doc, settings, catalogue), { signature });

// The family's rebuild for the shared signing step.
export async function rebuildDeskDocument(doc, signature, ctx) {
  if (!signature) throw new Error("The signature image is needed to sign.");
  return deskDocumentBlob(doc, signature, ctx);
}

// Whether a row can be signed on the Service Desk: a quotation or letter of a desk department, made on the old form (not a Template
// Hub library document or proposal, nor a Business Setup case document, which signs in its case), with its file, still current.
// all: every row of the list, to tell a proposal's letter.
export function deskSignable(doc, all = []) {
  return !!doc?.id && ["quote", "letter"].includes(doc.doc_type) && DEPARTMENTS.includes(doc.department) && !doc.library_template && !doc.case_id
    && !!doc.storage_path && !["superseded", "rejected"].includes(doc.status) && !isProposalLetter(doc, all, "AB Capital/Proposal");
}

// What the row shows: Sign (AB Capital approvers only), the signed copies and the status. canSign is doc_sign_can('ab_capital').
export const deskSignState = (doc, opts = {}, all = []) => hubSignState(doc, opts, "View", (d) => deskSignable(d, all));

// An approver signs a desk quotation or letter. api = { sign (signing.js with the hub-documents deps), render, loadSettings(),
// loadCatalogue() }. Returns { signature, wordBlob, pdfBlob } or { error }.
export const signDeskDocument = (doc, api, all = []) => signHubRow(doc, {
  signable: (d) => deskSignable(d, all),
  prepare: async (d) => {
    const [settings, catalogue] = await Promise.all([api.loadSettings(), d.doc_type === "letter" ? api.loadCatalogue() : Promise.resolve([])]);
    return { render: api.render, settings, catalogue };
  },
  rebuild: rebuildDeskDocument,
  sign: api.sign,
});
