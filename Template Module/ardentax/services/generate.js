// Makes a document's Word and PDF files. A number is taken only after a trial fill works, and a failure after that
// can be repeated under the same number. api: ardentaxApi, or fakeApi on the development page.
// deps: { JSZip, parse, serialize, toPdf(wordBlob) -> pdfBlob }.
// Signing is optional and goes through the shared step (Template Module/services/signing.js): the signed files are its own, under
// ArdentTax (ASP)/<id>/signed/, and the row keeps its unsigned files. Filing new files ends a live signature (doc_sign_supersede).
import { computeQuote, fileNameFor, mailTokens, quoteBlockers } from "../logic/quoteModel.js";
import { fillDocx } from "../logic/fillDocx.js";

const WORD_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const requestTotals = (t) => ({ one_time: t.oneTime, annual: t.annualTotal, year1: t.year1 });

function assertReady(details, totals) {
  const missing = quoteBlockers(details, totals);
  if (missing.length) throw new Error(`Fill in before generating: ${missing.join(", ")}.`);
}

// The draft starts from the Email sheet's text, saved in the settings, with this document's figures.
async function mailDraft(api, details, totals) {
  const s = await api.mailSettings();
  return { mail_to: details.client?.email || null, mail_subject: mailTokens(s.subject, details, totals), mail_body: mailTokens(s.body, details, totals) };
}

async function trialFill(api, details, totals, deps) {
  await fillDocx(await api.loadTemplate(details.docType), details, totals, "TRIAL", deps);
}

// The stored document drawn from its saved details: unsigned (signature null) as filed, or with the company signature.
async function render(api, doc, signature, deps) {
  const details = doc.details;
  const bytes = await fillDocx(await api.loadTemplate(details.docType), details, computeQuote(details), doc.document_number, deps, signature);
  return new Blob([bytes], { type: WORD_TYPE });
}

// reason: why a live signature on this row ends. The content trigger (Template Hub 011) already ends it when attach changes the files;
// this says so explicitly, as Accounting does, and a failure here does not undo the filed document.
async function fileDocument(api, doc, deps, reason) {
  const details = doc.details;
  const wordBlob = await render(api, doc, null, deps);
  const pdfBlob = await deps.toPdf(wordBlob);
  const short = details.client?.short || details.client?.legal;
  const version = doc.version || 1;
  // A new folder each time: stored files are never overwritten, so a retry must not reuse a path.
  const folder = `ArdentTax (ASP)/${doc.id}/${globalThis.crypto.randomUUID()}`;
  const wordPath = `${folder}/${fileNameFor(doc.document_number, short, version)}`;
  const pdfPath = `${folder}/${fileNameFor(doc.document_number, short, version, "pdf")}`;
  await api.upload(wordPath, wordBlob);
  await api.upload(pdfPath, pdfBlob);
  await api.attach(doc.id, wordPath, pdfPath);
  try { await api.supersede(doc.id, reason); } catch { /* the trigger has ended it already */ }
  return { doc: { ...doc, word_path: wordPath, pdf_path: pdfPath }, wordBlob, pdfBlob };
}

export async function generateDocument(api, { details, requestId, sourceQuoteId, onCreated }, deps) {
  const totals = computeQuote(details);
  assertReady(details, totals);
  await trialFill(api, details, totals, deps);
  const doc = await api.create({ request_id: requestId, doc_type: details.docType, source_quote_id: sourceQuoteId || null, details, totals: requestTotals(totals), ...(await mailDraft(api, details, totals)) });
  onCreated?.(doc);
  return fileDocument(api, doc, deps, "Generated");
}

export const regenerate = (api, doc, deps) => fileDocument(api, doc, deps, "Generated again");

export async function reviseDocument(api, doc, details, requestId, deps, onCreated) {
  const totals = computeQuote(details);
  assertReady(details, totals);
  await trialFill(api, details, totals, deps);
  const revised = await api.revise(doc.id, { request_id: requestId, details, totals: requestTotals(totals), ...(await mailDraft(api, details, totals)) });
  onCreated?.(revised);
  // A revision is a new row with its own number version. It starts unsigned; the earlier version keeps its signature, which still
  // matches that version's own files.
  return fileDocument(api, revised, deps, "Revised");
}

export function makeLetter(api, quote, requestId, deps, onCreated) {
  const details = { ...quote.details, docType: "letter" };
  return generateDocument(api, { details, requestId, sourceQuoteId: quote.id, onCreated }, deps);
}

// The family's rebuild for the shared signing step: the stored document with the company signature, by the same fill.
// ctx: { api, JSZip, parse, serialize }. Returns the Word blob.
export const rebuildArdentax = (doc, signature, ctx) => render(ctx.api, doc, signature, ctx);

// An approver signs a document. seen is the change stamp the server reads now (doc_changed_at); the server refuses the record if
// the row changed after it. api.sign is signing.js signDocument with its deps. Returns { signature, wordBlob, pdfBlob } or { error }.
export async function signArdentax(api, doc, deps) {
  if (!doc?.pdf_path || !doc?.word_path) return { error: "This document's files are not ready. Use Generate again first." };
  try {
    const seen = await api.changedAt(doc.id);
    if (!seen) return { error: "The document was not found." };
    const r = await api.sign({ table: "ardentax_documents", doc, seen, rebuild: (d, signature) => rebuildArdentax(d, signature, { api, ...deps }) }, { toPdf: deps.toPdf });
    return r && !r.error ? r : { error: r?.error || "Signing failed" };
  } catch (e) {
    return { error: e.message };
  }
}
