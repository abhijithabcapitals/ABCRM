// Makes a document's Word and PDF files. A number is taken only after a trial fill works, and a failure after that
// can be repeated under the same number. api: ardentaxApi, or fakeApi on the development page.
// deps: { JSZip, parse, serialize, toPdf(wordBlob) -> pdfBlob }.
import { computeQuote, fileNameFor, quoteBlockers } from "../logic/quoteModel.js";
import { fillDocx } from "../logic/fillDocx.js";

const WORD_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const requestTotals = (t) => ({ one_time: t.oneTime, annual: t.annualTotal, year1: t.year1 });

function assertReady(details, totals) {
  const missing = quoteBlockers(details, totals);
  if (missing.length) throw new Error(`Fill in before generating: ${missing.join(", ")}.`);
}

async function trialFill(api, details, totals, deps) {
  await fillDocx(await api.loadTemplate(details.docType), details, totals, "TRIAL", deps);
}

async function fileDocument(api, doc, deps) {
  const details = doc.details;
  const totals = computeQuote(details);
  const bytes = await fillDocx(await api.loadTemplate(details.docType), details, totals, doc.document_number, deps);
  const wordBlob = new Blob([bytes], { type: WORD_TYPE });
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
  return { doc: { ...doc, word_path: wordPath, pdf_path: pdfPath }, wordBlob, pdfBlob };
}

export async function generateDocument(api, { details, requestId, sourceQuoteId, onCreated }, deps) {
  const totals = computeQuote(details);
  assertReady(details, totals);
  await trialFill(api, details, totals, deps);
  const doc = await api.create({ request_id: requestId, doc_type: details.docType, source_quote_id: sourceQuoteId || null, details, totals: requestTotals(totals) });
  onCreated?.(doc);
  return fileDocument(api, doc, deps);
}

export const regenerate = (api, doc, deps) => fileDocument(api, doc, deps);

export async function reviseDocument(api, doc, details, requestId, deps, onCreated) {
  const totals = computeQuote(details);
  assertReady(details, totals);
  await trialFill(api, details, totals, deps);
  const revised = await api.revise(doc.id, { request_id: requestId, details, totals: requestTotals(totals) });
  onCreated?.(revised);
  return fileDocument(api, revised, deps);
}

export function makeLetter(api, quote, requestId, deps, onCreated) {
  const details = { ...quote.details, docType: "letter" };
  return generateDocument(api, { details, requestId, sourceQuoteId: quote.id, onCreated }, deps);
}
