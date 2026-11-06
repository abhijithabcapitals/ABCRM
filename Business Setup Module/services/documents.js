// Word files for quotes, letters and receipts. A failed file keeps its number; the screen offers Create file again.
// Quotes and letters can carry the AB Capital signature (shared signing, Template Hub 011); the rules are in ../logic/caseSigning.js.
import { supabase } from "@app/supabase";
import { createDocument, loadCatalogue, loadHubSettings, renderTemplate, saveFile } from "@template-hub/services/hubApi";
import { fileNameFor, folderKind, mailDraft } from "@template-hub/logic/serviceDocs";
import { canSign, signHubDocument } from "@template-hub/services/signingApi.js";
import { loadAccountingSignatures } from "@template-hub/services/accountingApi.js";
import { withSignatures } from "@template-hub/logic/accountingUi.js";
import { receiptDocx } from "@banking/logic/documents";
import { storeReceipt } from "./businessSetupApi";
import { caseDocumentBlob, fileAndWithdraw, signCaseDocument } from "../logic/caseSigning";

const download = async (blob, name) => { const { saveAs } = await import("file-saver"); saveAs(blob, name); };
const toPdf = async (wordBlob) => (await import("@template-hub/ardentax/logic/docxToPdf.js")).docxToPdf(wordBlob);
const supersede = async (table, id, reason) => { const { error } = await supabase.rpc("doc_sign_supersede", { p_table: table, p_id: id, p_reason: reason }); if (error) throw new Error(error.message); };

// Files the new Word file, then ends any live signature (the database already did when the file changed). The warning, if any, is
// logged: the file is saved and downloaded either way, and signing is optional.
async function fileWithMail(doc, type, blob) {
  const name = fileNameFor(doc.document_number, doc.client_name);
  const { saved, warning } = await fileAndWithdraw(doc, () => saveFile(doc, folderKind(doc.department, type), blob, name), supersede);
  if (warning) console.warn(warning);
  await download(blob, name);
  return saved;
}

export async function fileQuote(doc) {
  if (doc.library_template) throw new Error("This document came from Template Hub. Use Retry there.");
  const settings = await loadHubSettings();
  // Every AB Capital quote uses the same design. The zone stays as a label on the quote. A Business Setup quote with line VAT adds its net and VAT rows.
  const blob = await caseDocumentBlob(doc, null, { render: renderTemplate, settings });
  const saved = await fileWithMail(doc, "quote", blob);
  const draft = mailDraft({ type: "quote", client: doc.client_name, contact: doc.contact_name, services: doc.services, number: doc.document_number, total: doc.total_amount, validUntil: doc.valid_until, company: settings.company });
  await createDocument({ doc_type: "mail", parent_id: doc.id, department: doc.department, client_name: doc.client_name, contact_name: doc.contact_name, contact_email: doc.contact_email, lines: doc.lines, mail_subject: draft.subject, mail_body: draft.body }).catch(() => null);
  return saved;
}

export async function fileLetter(doc) {
  const [settings, catalogue] = await Promise.all([loadHubSettings(), loadCatalogue()]);
  const blob = await caseDocumentBlob(doc, null, { render: renderTemplate, settings, catalogue });
  return fileWithMail(doc, "letter", blob);
}

// ---- AB Capital signing ----
export const canSignCase = () => canSign("ab_capital").catch(() => false);

// The signing state of these quotes and letters, as { [id]: { live, last } }, read under the caller's own rules.
export async function loadCaseSignatures(ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return {};
  return Object.fromEntries(withSignatures(list.map((id) => ({ id })), await loadAccountingSignatures(list)).map((d) => [d.id, d.signing]));
}

// An approver signs a case quote or letter: re-rendered from its row with the signature, stored under Business Setup/<id>/signed/.
export const signCase = (doc) => signCaseDocument(doc, {
  sign: (args) => signHubDocument(args, { toPdf }), render: renderTemplate, loadSettings: loadHubSettings, loadCatalogue,
});

export async function fileReceipt(payment, clientName, quoteNumber) {
  const settings = await loadHubSettings();
  const { blob, fileName } = await receiptDocx(
    { banking_receipts: { receipt_number: payment.receipt_number }, payment_date: payment.paid_on, amount: payment.amount, payment_method: payment.method, transaction_reference: payment.reference, payment_ref: payment.receipt_number, description: payment.note },
    { display_name: clientName }, { case_ref: quoteNumber }, settings.company);
  await storeReceipt(payment.receipt_id, blob, fileName);
  await download(blob, fileName);
}
