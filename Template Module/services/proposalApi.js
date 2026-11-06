// Server calls of the Business Formation Proposal. The screen wires them into the deps of proposalGenerate.js.
import { supabase } from "@app/supabase";
import { createDocument, listDocuments, openStored, storedBlob } from "./hubApi";
import { loadAccountingSignatures } from "./accountingApi";
import { withSignatures } from "../logic/accountingUi.js";
import { fileNameFor } from "../logic/serviceDocs";

export { openStored, storedBlob };
const BUCKET = "hub-documents";
const CLIENT_MODULE_URL = (import.meta.env.VITE_CLIENT_MODULE_URL || "http://127.0.0.1:8792").replace(/\/$/, "");
const check = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

export const loadAuthorities = async () => check(await supabase.from("hub_proposal_authorities").select("*").order("name"));
export const saveAuthority = async (p) => check(await supabase.rpc("hub_proposal_authority_save", { p }));
export const saveDefaults = async (p) => check(await supabase.rpc("hub_proposal_defaults_save", { p }));
export const createProposal = async (p) => check(await supabase.rpc("hub_proposal_create", { p }));
export const attachProposal = async (id, pdf, word) => check(await supabase.rpc("hub_proposal_attach", { p_id: id, p_pdf: pdf, p_word: word }));
export const markProposalSaved = async (id, path) => check(await supabase.rpc("hub_proposal_saved", { p_id: id, p_path: path }));
export const chooseProposalOption = async (id, option) => check(await supabase.rpc("hub_proposal_choose", { p: { quote_id: id, option } }));
export const createProposalLetter = async (p) => check(await supabase.rpc("hub_proposal_letter_create", { p }));

// Stores one file of a proposal. The PDF carries its content type so the signed link opens in the browser.
export async function uploadProposalFile(doc, blob, ext) {
  const path = `Business Setup/${doc.id}/${crypto.randomUUID()}.${ext}`;
  const type = ext === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: type });
  if (error) throw new Error(error.message);
  return path;
}

// Stores one logo or timeline image of an authority set under proposal-assets/ and returns its path. Only PNG and JPEG print in the Word file.
export async function uploadProposalAsset(authorityKey, kind, file) {
  const ext = file?.type === "image/png" ? "png" : file?.type === "image/jpeg" ? "jpg" : null;
  if (!ext) throw new Error("The image must be a PNG or JPEG file.");
  if (!/^[a-z0-9_-]+$/.test(authorityKey || "")) throw new Error("Save the set with a key of lower case letters, digits, - or _ first.");
  const path = `proposal-assets/${authorityKey}/${kind}-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
  if (error) throw new Error(error.message);
  return path;
}

// Images of a proposal's options by their storage path: { [path]: { bytes, type, width, height } }. One that cannot be read is left out.
export async function loadProposalImages(proposal) {
  const paths = [...new Set((proposal?.options || []).flatMap((o) => [o.logo_path, o.timeline_path]).filter(Boolean))];
  const out = {};
  await Promise.all(paths.map(async (path) => {
    try {
      const blob = await storedBlob(path);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const type = /\.jpe?g$/i.test(path) ? "jpeg" : "png";
      const bitmap = await createImageBitmap(blob);
      out[path] = { bytes, type, width: bitmap.width, height: bitmap.height };
      bitmap.close?.();
    } catch { /* the document prints without it */ }
  }));
  return out;
}

// Puts the Word and PDF into the proposal's office folder through the Client Module on this PC.
// Returns the saved Word file's path, or null when the module is off or errors.
export async function saveProposalFolder(doc, wordBlob, pdfBlob) {
  try {
    const name = fileNameFor(doc.document_number, doc.client_name);
    const form = new FormData();
    form.append("word", new File([wordBlob], name, { type: wordBlob.type }));
    form.append("pdf", new File([pdfBlob], name.replace(/\.docx$/i, ".pdf"), { type: "application/pdf" }));
    form.append("client", doc.client_name || "");
    form.append("client_id", doc.client_id || "");
    form.append("department", "Business Setup"); // the route is shared with Accounting, which is its default
    const res = await fetch(`${CLIENT_MODULE_URL}/api/proposal-folder`, { method: "POST", body: form, signal: AbortSignal.timeout(15000) });
    return res.ok ? (await res.json()).path || null : null;
  } catch { return null; }
}

// The mail draft beside the proposal. A proposal keeps one, so Retry does not make a second.
export async function createProposalMail(doc, mail) {
  const existing = check(await supabase.from("hub_documents").select("id").eq("doc_type", "mail").eq("parent_id", doc.id).limit(1));
  if (existing.length) return existing[0];
  return createDocument({
    doc_type: "mail", parent_id: doc.id, department: doc.department, client_name: doc.client_name, contact_name: doc.contact_name, contact_email: doc.contact_email,
    services: doc.services, lines: doc.lines, vat_mode: doc.vat_mode, vat_rate: doc.vat_rate, mail_subject: mail.subject, mail_body: mail.body,
  });
}

// The Business Setup documents, each proposal with its signing state ({ live, last }, see accountingUi withSignatures).
// loadAccountingSignatures reads any hub_documents rows' signatures, under the caller's own rules.
export async function listProposalsWithSignatures() {
  const docs = await listDocuments("Business Setup");
  const ids = docs.filter((d) => d.doc_type === "quote" && d.library_template === "AB Capital/Proposal").map((d) => d.id);
  return withSignatures(docs, ids.length ? await loadAccountingSignatures(ids) : []);
}

// signed: true sends the live signature's PDF (refused when there is none); false sends the unsigned PDF as before.
export async function sendProposal(id, resend, signed = false) {
  const { data, error } = await supabase.functions.invoke("proposal-mail-send", { body: { document_id: id, resend: !!resend, signed: !!signed } });
  if (error) {
    // The function explains a refusal in its response; the client's own message is generic.
    let message = error.message;
    try { message = (await error.context.json()).error || message; } catch { /* keep the client's message */ }
    throw new Error(message);
  }
  return data;
}

// Opens the proposal's Word file: the signed link downloads it.
export const openWord = (path) => openStored(path);
