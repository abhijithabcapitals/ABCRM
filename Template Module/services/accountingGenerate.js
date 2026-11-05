// Makes, approves, edits and retries the Accounting quote and agreement files. Everything that touches the server or the browser is passed in as deps:
// { settings, check(kind, a, b), create(p), loadTemplate(kind), loadSignature(), render(buffer, context, signature), toPdf(wordBlob),
//   upload(doc, blob, ext), attach(id, pdf, word), approve(id, pdf, word, seen), update(id, agreement), saveLocal(doc, wordBlob, pdfBlob),
//   markSaved(id, path), createMail(doc, { subject, body }), loadBlobs(doc) for Save now }.
// A document that cannot render uses no number. A failure after the number keeps the row and Ref, and Retry rebuilds from field_values.
// Only approveAgreement loads the signature image. Nothing here adds one option or fee basis to another.
import { quoteContext, toQuotePayload, isAccountingAgreement } from "../logic/accountingQuote.js";
import { agreementContext } from "../logic/accountingAgreement.js";

// The PDF is drawn in the browser by the existing converter, loaded only when needed.
export const toPdf = async (wordBlob) => (await import("../ardentax/logic/docxToPdf.js")).docxToPdf(wordBlob);

const contextFor = (kind, doc, settings, signed) => (kind === "agreement" ? agreementContext(doc, settings, signed) : quoteContext(doc, settings));
const kindOf = (doc) => (isAccountingAgreement(doc) ? "agreement" : "quote");

// Subject and body of the mail draft. Each option shows its own totals; nothing is summed across options or bases.
export function mailText(doc, settings) {
  const ref = doc.document_number;
  const who = doc.contact_name || doc.client_name;
  if (kindOf(doc) === "agreement") {
    return { subject: `Service Agreement ${ref}`, body: `Dear ${who},\n\nPlease find attached our Service Agreement ${ref}.\n\nKind regards,\nAB Capital Services FZE` };
  }
  const ctx = quoteContext(doc, settings);
  const blocks = ctx.options.map((o) => `Option ${o.number}: ${o.name}\n${o.totals.length ? o.totals.map((t) => `- ${t.text}`).join("\n") : "- No fixed fee"}`);
  return {
    subject: `Quotation ${ref}`,
    body: `Dear ${who},\n\nThank you for your interest in AB Capital. Please find attached our Quotation ${ref}.\n\n${blocks.join("\n\n")}\n\nPlease let us know which option you would like to proceed with.\n\nKind regards,\nAB Capital Services FZE`,
  };
}

// Word, then PDF, uploaded as stored files. Returns the blobs and the two storage paths.
async function makeFiles(doc, kind, signed, signature, deps, buffer) {
  const wordBlob = await deps.render(buffer, contextFor(kind, doc, deps.settings, signed), signature);
  const pdfBlob = await deps.toPdf(wordBlob);
  const pdfPath = await deps.upload(doc, pdfBlob, "pdf");
  const wordPath = await deps.upload(doc, wordBlob, "docx");
  return { wordBlob, pdfBlob, pdfPath, wordPath };
}

// Copies the files into the client folder through the Client Module. null when it is off or the copy failed.
async function copyLocal(doc, files, deps) {
  let path = null;
  try { path = (await deps.saveLocal(doc, files.wordBlob, files.pdfBlob)) || null; } catch { path = null; }
  if (path) { try { await deps.markSaved(doc.id, path); } catch { /* the copy exists; Save now can record it again */ } }
  return path;
}

// Rebuilds the unsigned files of a stored draft, attaches them, copies them to the client folder (not after an edit: Save now does that) and, for a first build, creates the mail draft.
async function buildDraft(doc, deps, buffer, { mail, local = true }) {
  const kind = kindOf(doc);
  try {
    const files = await makeFiles(doc, kind, false, null, deps, buffer);
    const attached = await deps.attach(doc.id, files.pdfPath, files.wordPath);
    const row = attached && typeof attached === "object" ? attached : doc;
    const onedrive = local ? await copyLocal(row, files, deps) : null;
    if (mail) await deps.createMail(row, mailText(row, deps.settings));
    return { doc: row, wordBlob: files.wordBlob, pdfBlob: files.pdfBlob, onedrive };
  } catch (e) {
    return { doc, error: e.message };
  }
}

// One run at a time per guard object, so a double click takes one number.
async function once(guard, run) {
  if (guard?.busy) return { error: "Already generating. Wait for it to finish." };
  if (guard) guard.busy = true;
  try { return await run(); } finally { if (guard) guard.busy = false; }
}

export function generateQuote({ form, quote, clientId, guard }, deps) {
  return once(guard, async () => {
    let buffer;
    let doc;
    try {
      const problem = await deps.check("quote", form, quote);
      if (problem) return { error: problem };
      const payload = toQuotePayload(form, quote, clientId);
      buffer = await deps.loadTemplate("quote");
      const trial = { document_number: "", client_name: payload.client_name, contact_name: payload.contact_name, field_values: { quote: payload.quote } };
      await deps.render(buffer, quoteContext(trial, deps.settings), null);
      doc = await deps.create(payload);
    } catch (e) {
      return { error: e.message };
    }
    return buildDraft(doc, deps, buffer, { mail: true });
  });
}

export function generateAgreement({ quoteId, agreement, guard }, deps) {
  return once(guard, async () => {
    let buffer;
    let doc;
    try {
      const problem = await deps.check("agreement", agreement);
      if (problem) return { error: problem };
      buffer = await deps.loadTemplate("agreement");
      await deps.render(buffer, agreementContext({ document_number: "", field_values: { agreement } }, deps.settings, false), null);
      doc = await deps.create({ quote_id: quoteId, agreement });
    } catch (e) {
      return { error: e.message };
    }
    return buildDraft(doc, deps, buffer, { mail: true });
  });
}

// Rebuilds a stored draft from its field_values. It takes no number.
export async function retryDocument(doc, deps) {
  let buffer;
  try {
    buffer = await deps.loadTemplate(kindOf(doc));
  } catch (e) {
    return { doc, error: e.message };
  }
  return buildDraft(doc, deps, buffer, { mail: true });
}

// An approver releases the agreement: the signed files are built first and the server records approval only after that.
export async function approveAgreement(doc, deps) {
  let files;
  try {
    const buffer = await deps.loadTemplate("agreement");
    const signature = await deps.loadSignature();
    files = await makeFiles(doc, "agreement", true, signature, deps, buffer);
  } catch (e) {
    return { error: e.message };
  }
  let approved;
  try {
    approved = await deps.approve(doc.id, files.pdfPath, files.wordPath, doc.agreement_changed_at);
  } catch (e) {
    return { error: e.message };
  }
  const row = approved && typeof approved === "object" ? approved : doc;
  const onedrive = await copyLocal(row, files, deps);
  return { doc: row, wordBlob: files.wordBlob, pdfBlob: files.pdfBlob, onedrive };
}

// Saves the edited agreement (which clears approval and the files on the server), then rebuilds the unsigned draft.
export async function editAgreement(doc, agreement, deps) {
  let buffer;
  let row;
  try {
    const problem = await deps.check("agreement", agreement);
    if (problem) return { error: problem };
    buffer = await deps.loadTemplate("agreement");
    row = await deps.update(doc.id, agreement);
  } catch (e) {
    return { error: e.message };
  }
  return buildDraft(row, deps, buffer, { mail: false, local: false });
}

// Copies the stored files to the client folder again ("Save now"), for a document made while the Client Module was off.
export async function saveToOneDrive(doc, deps) {
  try {
    const { wordBlob, pdfBlob } = await deps.loadBlobs(doc);
    const path = await deps.saveLocal(doc, wordBlob, pdfBlob);
    if (!path) return { doc, onedrive: null, error: "The Client Module is not running on this PC." };
    await deps.markSaved(doc.id, path);
    return { doc, onedrive: path };
  } catch (e) {
    return { doc, error: e.message };
  }
}
