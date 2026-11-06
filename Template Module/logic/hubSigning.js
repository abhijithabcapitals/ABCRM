// Shared rules for signing a Template Hub document (a hub_documents row) on a screen without a Send dialog: Business Setup cases,
// the Service Desk old form and Company Templates. Pure, so it is tested: every outside call comes in as an argument. Signing is
// optional: nothing here is needed to create, open or download a document unsigned.
// The signed Word and PDF go under <department>/<id>/signed/ (Template Hub 011 doc_sign_prefix) and are recorded in
// document_signatures; the row keeps its unsigned file. A new file on the row (hub_document_attach) ends the signature in the
// database (011 content trigger); fileAndWithdraw is the screen's second line.
import { signStamp, withSignatures } from "./accountingUi.js";

export const SIGN_TABLE = "hub_documents";

// The signed Word and PDF of a live signature, as buttons.
export function signedCopies(live) {
  if (!live) return [];
  return [
    ...(live.word_path ? [{ label: "Signed copy (Word)", path: live.word_path }] : []),
    ...(live.pdf_path ? [{ label: "Signed copy (PDF)", path: live.pdf_path }] : []),
  ];
}

// What a row shows. signable(doc) is the family's own rule; canSign is doc_sign_can(<the row's company>); signing is { live, last }
// (withSignatures). sign: the Sign button. copies: the signed Word and PDF, once a live signature exists, for everyone who sees the
// row. openLabel: the plain file's button, "Unsigned copy" beside a signed one. showStatus: the status line.
export function hubSignState(doc, { canSign = false, signing = null } = {}, openLabel = "Open", signable = () => false) {
  const ok = !!signable(doc);
  const copies = signedCopies(signing?.live || null);
  return {
    sign: canSign === true && !signing?.live && ok,
    copies,
    openLabel: copies.length ? "Unsigned copy" : openLabel,
    showStatus: ok || !!signing?.last,
  };
}

// The line that says whether the company signed the document. fmt formats a date.
export function hubSignStatus(signing, fmt = (d) => d) {
  const live = signing?.live;
  if (live) return { label: `Signed by ${live.signer_name || "an approver"} on ${fmt(live.signed_at)}`, tone: "good" };
  if (signing?.last?.superseded_at) return { label: `Not signed (signature withdrawn: ${signing.last.superseded_reason || "document changed"})`, tone: "warn" };
  return { label: "Not signed", tone: "plain" };
}

// An approver signs a row. The stamp is the one on the row being drawn, so a change made in another tab is refused by the server
// ("The document changed"). prepare() loads what the rebuild needs (settings, catalogue, template file); rebuild(doc, signature, ctx)
// draws the row with the signature; sign({ table, doc, seen, rebuild }) is signing.js with the hub-documents deps.
// Returns { signature, wordBlob, pdfBlob } or { error }.
export async function signHubRow(doc, { signable, prepare = async () => null, rebuild, sign }) {
  if (!signable(doc)) return { error: "This document cannot be signed here." };
  const seen = signStamp(doc);
  if (!seen) return { error: "The document was not found." };
  try {
    const ctx = await prepare(doc);
    const r = await sign({ table: SIGN_TABLE, doc, seen, rebuild: (d, signature) => rebuild(d, signature, ctx) });
    return r && !r.error ? r : { error: r?.error || "Signing failed" };
  } catch (e) {
    return { error: e?.message || String(e) };
  }
}

// A new file on a document ends its live signature. The database does it first (011 content trigger on storage_path); this is the
// second line, for a database without that trigger. save() files the document; the file stands even if the withdrawal fails, which
// comes back as warning. supersede is doc_sign_supersede. Returns { saved, warning }.
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

// The signing state of these rows, as { [id]: { live, last } }. sigs are document_signatures rows (see withSignatures).
export function signingById(ids, sigs) {
  return Object.fromEntries(withSignatures((ids || []).map((id) => ({ id })), sigs).map((d) => [d.id, d.signing]));
}
