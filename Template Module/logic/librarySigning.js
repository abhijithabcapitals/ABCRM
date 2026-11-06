// Signing on Company Templates documents (hub_documents with a library template): the AB Capital quote and engagement letter on the
// built-in designs, and Company Library fills of uploaded Word templates. Pure, so it is tested; every outside call comes in as an
// argument. Signing is optional: generate, Retry, Open and Download work as before for an unsigned document.
// The company comes from the row, as Template Hub 011 doc_company: Ardentax for Ardentax library templates, AB Capital otherwise. The
// Accounting quote and agreement and the Business Setup proposal also carry a library template, but sign on their own screens.
// The signed Word and PDF go under <department>/<id>/signed/ (Business Setup/ or Ardentax Documents/); the row keeps its unsigned file.
import { isAccountingAgreement, isAccountingQuote } from "./accountingQuote.js";
import { libraryContext } from "./libraryContext.js";
import { LETTER_TEMPLATE, QUOTE_TEMPLATE, designContext } from "./libraryLetter.js";
import { isProposal } from "./proposalModel.js";
import { docCompany } from "./signingView.js";
import { SIGN_TABLE, hubSignState, signHubRow } from "./hubSigning.js";

export const libraryCompany = (doc) => docCompany(SIGN_TABLE, doc);
// A fill of an uploaded Word template (Company Library), rather than an AB Capital built-in design.
export const isLibraryFill = (doc) => doc?.library_file_id !== null && doc?.library_file_id !== undefined;
export const designKind = (doc) => (doc?.doc_type === "letter" ? "letter" : "quote");

// What a fill is drawn with, from the stored row: its values (without the stored dollar rate), its fee rows and its Ref.
export function libraryFillData(doc) {
  const { usd_rate: usdRate, ...values } = doc.field_values || {};
  const rows = (doc.lines || []).map((l) => ({ label: l.description, amount: l.amount, remarks: l.remarks, rate: l.rate }));
  return libraryContext(values, rows, usdRate, doc.document_number);
}

// What a built-in design is drawn with: the stored row, the current company details and terms, and the date stored on it.
export const designFileData = (doc, settings) => designContext(designKind(doc), doc, settings?.company, settings?.engagement_terms, doc.field_values?.date);
export const designTemplate = (doc) => (designKind(doc) === "letter" ? LETTER_TEMPLATE : QUOTE_TEMPLATE);

// The Word file. ctx = { buffer (a fill's template file), settings (hub_settings by key), renderFill(buffer, data, { signature })
// (renderDocx), renderDesign(templateFile, data, { signature }) (renderTemplate) }. Retry (unsigned) and signing draw the same row the
// same way, so the signed copy differs from the filed one only by the signature.
export function libraryDocumentBlob(doc, signature, ctx) {
  return isLibraryFill(doc)
    ? ctx.renderFill(ctx.buffer, libraryFillData(doc), { signature })
    : ctx.renderDesign(designTemplate(doc), designFileData(doc, ctx.settings), { signature });
}

// The family's rebuild for the shared signing step.
export async function rebuildLibraryDocument(doc, signature, ctx) {
  if (!signature) throw new Error("The signature image is needed to sign.");
  return libraryDocumentBlob(doc, signature, ctx);
}

// Whether a row can be signed in Company Templates: a library document that is not an Accounting or proposal row, with its file, still current.
export function librarySignable(doc) {
  return !!doc?.id && !!doc.library_template && ["quote", "letter", "library"].includes(doc.doc_type)
    && !isProposal(doc) && !isAccountingQuote(doc) && !isAccountingAgreement(doc)
    && !!doc.storage_path && !["superseded", "rejected"].includes(doc.status);
}

// What the row shows. approvers is { ab_capital, ardentax }: doc_sign_can for each company. Sign shows only to an approver of the
// row's own company.
export const librarySignState = (doc, { approvers = {}, signing = null } = {}) =>
  hubSignState(doc, { canSign: approvers?.[libraryCompany(doc)] === true, signing }, "Open", librarySignable);

// An approver signs a library document. api = { sign (signing.js with the hub-documents deps), loadFile(fileId), loadSettings(),
// renderFill, renderDesign }. A fill loads its own template file; a design loads the settings. Returns { signature, wordBlob, pdfBlob } or { error }.
export const signLibraryDocument = (doc, api) => signHubRow(doc, {
  signable: librarySignable,
  prepare: async (d) => (isLibraryFill(d)
    ? { buffer: await api.loadFile(d.library_file_id), renderFill: api.renderFill }
    : { settings: await api.loadSettings(), renderDesign: api.renderDesign }),
  rebuild: rebuildLibraryDocument,
  sign: api.sign,
});
