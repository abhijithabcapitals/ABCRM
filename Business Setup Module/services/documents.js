// Word files for quotes, letters and receipts. A failed file keeps its number; the screen offers Create file again.
import { createDocument, loadCatalogue, loadHubSettings, renderTemplate, saveFile } from "@template-hub/services/hubApi";
import { fileNameFor, folderKind, letterData, mailDraft, quoteData } from "@template-hub/logic/serviceDocs";
import { receiptDocx } from "@banking/logic/documents";
import { listQuoteTemplates, storeReceipt, usdRate } from "./businessSetupApi";
import { quoteContext } from "../logic/quoteData";

const download = async (blob, name) => { const { saveAs } = await import("file-saver"); saveAs(blob, name); };

async function fileWithMail(doc, type, blob) {
  const name = fileNameFor(doc.document_number, doc.client_name);
  const saved = await saveFile(doc, folderKind(doc.department, type), blob, name);
  await download(blob, name);
  return saved;
}

// The service template holds the company's letterhead text; the zone templates carry their own wording and USD columns.
export async function fileQuote(doc, activity) {
  const [settings, templates, rate] = await Promise.all([loadHubSettings(), listQuoteTemplates(), usdRate()]);
  const tpl = templates.find((t) => t.key === doc.template_key) || templates.find((t) => t.key === "service");
  const generic = tpl.key === "service";
  const data = generic ? quoteData(doc, settings.company) : quoteContext({ ...doc, business_activity: activity || doc.notes || "" }, tpl, rate);
  const blob = await renderTemplate(tpl.storage_file, data, { builtIn: generic });
  const saved = await fileWithMail(doc, "quote", blob);
  const draft = mailDraft({ type: "quote", client: doc.client_name, contact: doc.contact_name, services: doc.services, number: doc.document_number, total: doc.total_amount, validUntil: doc.valid_until, company: settings.company });
  await createDocument({ doc_type: "mail", parent_id: doc.id, department: doc.department, client_name: doc.client_name, contact_name: doc.contact_name, contact_email: doc.contact_email, mail_subject: draft.subject, mail_body: draft.body }).catch(() => null);
  return saved;
}

export async function fileLetter(doc) {
  const [settings, catalogue] = await Promise.all([loadHubSettings(), loadCatalogue()]);
  const names = (doc.lines || []).map((l) => l.service_name || l.description);
  const limitations = [...new Set(catalogue.filter((c) => c.service_items.some((x) => names.includes(x.name))).map((c) => c.limitation).filter(Boolean))];
  const blob = await renderTemplate("Service_Engagement_Template.docx", letterData(doc, settings.company, settings.engagement_terms, limitations));
  return fileWithMail(doc, "letter", blob);
}

export async function fileReceipt(payment, clientName, quoteNumber) {
  const settings = await loadHubSettings();
  const { blob, fileName } = await receiptDocx(
    { banking_receipts: { receipt_number: payment.receipt_number }, payment_date: payment.paid_on, amount: payment.amount, payment_method: payment.method, transaction_reference: payment.reference, payment_ref: payment.receipt_number, description: payment.note },
    { display_name: clientName }, { case_ref: quoteNumber }, settings.company);
  await storeReceipt(payment.receipt_id, blob, fileName);
  await download(blob, fileName);
}
