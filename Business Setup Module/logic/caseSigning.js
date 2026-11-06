// AB Capital signing on Business Setup case documents (a quote or engagement letter in hub_documents with case_id), through the
// shared signing (Template Hub 011, Template Module/services/signing.js). Pure, so it is tested: every outside call comes in as an
// argument. Signing is optional: nothing here is needed to create, open or download a document unsigned.
// The signed Word and PDF go under Business Setup/<id>/signed/ in hub-documents and are recorded in document_signatures; the row keeps
// its unsigned file. A new file on the row (Create file, hub_document_attach) ends the signature in the database (011 content trigger).
import { quoteData, letterData } from "../../Template Module/logic/serviceDocs.js";
import { signStamp } from "../../Template Module/logic/accountingUi.js";
import { withLineVat } from "./quoteData.js";

export const QUOTE_TEMPLATE = "Service_Quotation_Template.docx";
export const LETTER_TEMPLATE = "Service_Engagement_Template.docx";
export const SIGN_TABLE = "hub_documents";

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
export function caseSignState(doc, { canSign = false, signing = null } = {}, openLabel = "Open") {
  const live = signing?.live || null;
  const copies = live ? [
    ...(live.word_path ? [{ label: "Signed copy (Word)", path: live.word_path }] : []),
    ...(live.pdf_path ? [{ label: "Signed copy (PDF)", path: live.pdf_path }] : []),
  ] : [];
  return {
    sign: canSign === true && !live && caseSignable(doc),
    copies,
    openLabel: copies.length ? "Unsigned copy" : openLabel,
    showStatus: caseSignable(doc) || !!signing?.last,
  };
}

// The line that says whether AB Capital signed the document. fmt formats a date.
export function caseSignStatus(signing, fmt = (d) => d) {
  const live = signing?.live;
  if (live) return { label: `Signed by ${live.signer_name || "an approver"} on ${fmt(live.signed_at)}`, tone: "good" };
  if (signing?.last?.superseded_at) return { label: `Not signed (signature withdrawn: ${signing.last.superseded_reason || "document changed"})`, tone: "warn" };
  return { label: "Not signed", tone: "plain" };
}

// An approver signs a case quote or letter. The stamp is the one on the row being drawn, so a change made in another tab is refused
// by the server ("The document changed"). api = { sign({ table, doc, seen, rebuild }) (signing.js with the hub-documents deps),
// render, loadSettings(), loadCatalogue() }. Returns { signature, wordBlob, pdfBlob } or { error }.
export async function signCaseDocument(doc, api) {
  if (!caseSignable(doc)) return { error: "This document cannot be signed here." };
  const seen = signStamp(doc);
  if (!seen) return { error: "The document was not found." };
  try {
    const [settings, catalogue] = await Promise.all([api.loadSettings(), doc.doc_type === "letter" ? api.loadCatalogue() : Promise.resolve([])]);
    const r = await api.sign({ table: SIGN_TABLE, doc, seen, rebuild: (d, signature) => rebuildCaseDocument(d, signature, { render: api.render, settings, catalogue }) });
    return r && !r.error ? r : { error: r?.error || "Signing failed" };
  } catch (e) {
    return { error: e?.message || String(e) };
  }
}

// A new file on a document (Create file) ends its live signature. The database does it first (011 content trigger on storage_path);
// this is the second line, for a database without that trigger. save() files the document; the file stands even if the withdrawal
// fails, which comes back as warning. supersede is doc_sign_supersede. Returns { saved, warning }.
export async function fileAndWithdraw(doc, save, supersede) {
  const saved = await save();
  if (!doc?.id) return { saved, warning: null };
  try {
    await supersede(SIGN_TABLE, doc.id, "Generated again");
    return { saved, warning: null };
  } catch (e) {
    return { saved, warning: `Saved, but the earlier signature could not be withdrawn: ${e?.message || e}. Ask an approver.` };
  }
}
