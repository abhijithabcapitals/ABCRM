// Makes the Business Formation Proposal: number, Word, PDF, stored copies, office folder, mail draft. Everything that
// touches the server is passed in as deps:
// { checkFirst(form, proposal), create(payload), loadTemplate(), loadImages(proposal), render(buffer, context, images),
//   toPdf(wordBlob), upload(doc, blob, ext), attach(id, pdfPath, wordPath), saveLocal(doc, wordBlob, pdfBlob),
//   markSaved(id, path), createMail(doc, { subject, body }),
//   sign({ table, doc, rebuild, seen }) = the shared signing step (signing.js signDocument with its deps) }.
// render takes a fourth argument, the signature, only when signing.
// The template and a trial render come before the number is taken, so a bad template uses no number. A failure after
// that keeps the document and its Ref, and Retry rebuilds from the proposal stored on it.
// Signing is optional and goes through the shared step only: the signed files are its own, under Business Setup/<id>/signed/,
// and the row keeps its unsigned files. New files on the row end the signature on the server (Template Hub 011).
import { optionTotal, proposalContext, toPayload } from "../logic/proposalModel.js";
import { signStamp } from "../logic/accountingUi.js";

const plain = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
const message = (e) => e?.message || String(e);

// The mail draft: the Ref, then each option with its own total. Options are alternatives, so no sum is shown.
// It is signed with the proposal contact in Settings, the same one the document prints; blank parts are left out.
// The closing sits under the closing mark, which proposal-mail-send never sends (it drops the closing when a mail signature is chosen).
export function proposalMail(doc, settings) {
  const options = doc.field_values?.proposal?.options || [];
  const lines = options.map((o, i) => `Option ${i + 1}: ${o.authority_name || o.authority_key}, AED ${plain(optionTotal(o))}`);
  const contact = settings?.proposal_defaults?.contact || {};
  const signature = contact.name ? [contact.name, settings?.company?.short_name, contact.phone, contact.email, contact.website].map((s) => String(s || "").trim()).filter(Boolean) : [];
  return {
    subject: `Business Formation Proposal ${doc.document_number}`,
    body: [
      `Dear ${doc.contact_name || "Sir/Madam"},`, "",
      `Please find attached our Business Formation Proposal, Ref ${doc.document_number}.`, "",
      ...(lines.length ? ["The options are:", ...lines, "", "Each option is an alternative; the fees of one option are not added to another.", ""] : []),
      "Please let us know which option you would like to take forward.", "", "-- closing --", "Kind regards", ...signature,
    ].join("\n"),
  };
}

// Builds the files for a numbered document. Returns { doc, wordBlob, pdfBlob, onedrive } or { doc, error }.
async function makeFiles(doc, template, images, settings, deps) {
  try {
    const wordBlob = await deps.render(template, proposalContext(doc, settings, images), images);
    const pdfBlob = await deps.toPdf(wordBlob);
    const pdfPath = await deps.upload(doc, pdfBlob, "pdf");
    const wordPath = await deps.upload(doc, wordBlob, "docx");
    const saved = (await deps.attach(doc.id, pdfPath, wordPath)) || doc;
    let onedrive = null;
    try { onedrive = (await deps.saveLocal(saved, wordBlob, pdfBlob)) || null; } catch { onedrive = null; } // the office folder is a copy; the stored files are kept
    if (onedrive) {
      try { await deps.markSaved(doc.id, onedrive); } catch { /* the folder has the files; View still works */ }
    }
    await deps.createMail(saved, proposalMail(saved, settings));
    return { doc: saved, wordBlob, pdfBlob, onedrive };
  } catch (e) {
    return { doc, error: message(e) };
  }
}

export async function generateProposal({ form, proposal, clientId, settings, guard }, deps) {
  if (guard?.busy) return { error: "Already generating." };
  if (guard) guard.busy = true;
  try {
    const problem = await deps.checkFirst(form, proposal);
    if (problem) return { error: problem };
    let template, images, doc;
    try {
      const payload = toPayload(form, proposal, clientId);
      template = await deps.loadTemplate();
      images = await deps.loadImages(payload.proposal);
      // A template that cannot render uses no number.
      await deps.render(template, proposalContext({ document_number: "", created_at: new Date().toISOString(), field_values: { proposal: payload.proposal } }, settings, images), images);
      doc = await deps.create(payload);
    } catch (e) {
      return { error: message(e) };
    }
    return await makeFiles(doc, template, images, settings, deps);
  } finally {
    if (guard) guard.busy = false;
  }
}

export async function retryProposal(doc, deps, settings) {
  let template, images;
  try {
    template = await deps.loadTemplate();
    images = await deps.loadImages(doc.field_values?.proposal || {});
  } catch (e) {
    return { doc, error: message(e) };
  }
  return makeFiles(doc, template, images, settings, deps);
}

// The stored proposal rendered again with the signature: the family's rebuild for the shared signing step. Same context as the
// stored files (Ref, the date it was made, its own USD rate, options and totals), so the signed copy differs only by the signature.
export async function rebuildProposal(doc, signature, deps, settings) {
  if (!signature) throw new Error("The signature image is needed to sign.");
  const template = await deps.loadTemplate();
  const images = await deps.loadImages(doc.field_values?.proposal || {});
  return deps.render(template, proposalContext(doc, settings, images), images, signature);
}

// An approver signs a proposal. The stamp is the one on the row being rendered, so a change made in another tab is refused by the
// server ("The document changed"). On success the signed files are copied to the office folder. Returns { signature, onedrive } or { error }.
export async function signProposal(doc, deps, settings) {
  let r;
  try {
    r = await deps.sign({ table: "hub_documents", doc, seen: signStamp(doc), rebuild: (d, signature) => rebuildProposal(d, signature, deps, settings) });
  } catch (e) {
    return { error: message(e) };
  }
  if (!r || r.error) return { error: r?.error || "Signing failed" };
  let onedrive = null;
  try { onedrive = (await deps.saveLocal(doc, r.wordBlob, r.pdfBlob)) || null; } catch { onedrive = null; }
  if (onedrive) {
    try { await deps.markSaved(doc.id, onedrive); } catch { /* the folder has the files */ }
  }
  return { doc, signature: r.signature, wordBlob: r.wordBlob, pdfBlob: r.pdfBlob, onedrive };
}

// Files an issued proposal into the office folder again. deps: { loadStored(path), saveLocal, markSaved }. Null when the Client Module is off.
export async function saveToOneDrive(doc, deps) {
  const wordBlob = await deps.loadStored(doc.word_path);
  const pdfBlob = await deps.loadStored(doc.storage_path);
  const path = await deps.saveLocal(doc, wordBlob, pdfBlob);
  if (!path) return null;
  await deps.markSaved(doc.id, path);
  return path;
}
