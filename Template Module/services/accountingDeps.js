// Wires the deps that accountingGenerate.js asks for: the server calls, the Word and PDF makers, the template and the signature image.
// One shared guard covers every generate call on screen, so a double click takes one number.
import { supabase } from "@app/supabase";
import { BUCKET, createDocument, storedBlob } from "./hubApi";
import { approveDoc, attachDoc, createAgreement, createQuote, markSaved, saveFolder, updateAgreement, uploadDoc } from "./accountingApi";
import { checkQuote } from "../logic/accountingQuote.js";
import { mailRowLines } from "../logic/accountingUi.js";
import { checkAgreement } from "../logic/accountingAgreement.js";
import { renderAccountingDoc } from "../logic/accountingDocx.js";

export const generateGuard = { busy: false };

const TEMPLATES = {
  quote: () => new URL("../templates/AB_Capital_Accounting_Quote_Template.docx", import.meta.url).href,
  agreement: () => new URL("../templates/AB_Capital_Accounting_Agreement_Template.docx", import.meta.url).href,
};

async function loadTemplate(kind) {
  const url = TEMPLATES[kind]?.();
  if (!url) throw new Error(`No template for ${kind}.`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`The ${kind} template could not be loaded (${res.status}).`);
  return res.arrayBuffer();
}

// The approver's browser reads the image from private storage; the storage policy refuses everyone else.
const signatureLoader = (settings) => async () => {
  const path = settings?.accounting_proposal_defaults?.signature_path;
  if (!path) throw new Error("No signature image has been uploaded in Settings.");
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) throw new Error(error.message);
  const bitmap = await createImageBitmap(data);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close?.();
  return { bytes: new Uint8Array(await data.arrayBuffer()), type: path.split(".").pop().toLowerCase(), ...size };
};

async function render(buffer, context, signature) {
  const [{ default: PizZip }, { default: Docxtemplater }] = await Promise.all([import("pizzip"), import("docxtemplater")]);
  return renderAccountingDoc(buffer, context, signature, { PizZip, Docxtemplater });
}

const toPdf = async (wordBlob) => (await import("../ardentax/logic/docxToPdf.js")).docxToPdf(wordBlob);

// The mail draft sits beside its document, as in the other Service Documents.
const createMail = (doc, { subject, body }) => createDocument({
  doc_type: "mail", parent_id: doc.id, department: doc.department, client_name: doc.client_name, contact_name: doc.contact_name, contact_email: doc.contact_email,
  services: doc.services, lines: mailRowLines(doc.lines), vat_mode: doc.vat_mode, vat_rate: doc.vat_rate, mail_subject: subject, mail_body: body,
});

export function accountingDeps(settings) {
  return {
    settings,
    check: (kind, a, b) => (kind === "agreement" ? checkAgreement(a) : checkQuote(a, b)),
    create: (p) => ("quote_id" in p ? createAgreement(p) : createQuote(p)),
    loadTemplate,
    loadSignature: signatureLoader(settings),
    render,
    toPdf,
    upload: uploadDoc,
    attach: attachDoc,
    approve: approveDoc,
    update: updateAgreement,
    saveLocal: saveFolder,
    markSaved,
    createMail,
    loadBlobs: async (doc) => ({ wordBlob: await storedBlob(doc.word_path), pdfBlob: await storedBlob(doc.storage_path) }),
  };
}

