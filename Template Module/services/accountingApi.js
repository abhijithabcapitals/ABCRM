// Server calls for the Accounting quote and agreement. The generate and approve steps in accountingGenerate.js take these as deps.
import { supabase } from "@app/supabase";
import { shapeSharedSignatures } from "@app/replySignature";
import { BUCKET, CLIENT_MODULE_URL, check, openStored } from "./hubApi";
import { fileNameFor } from "../logic/serviceDocs";
import { ACCOUNTING_TEMPLATES, loadAccountingDocs } from "./accountingList.js";

export const loadPackages = async () => check(await supabase.from("hub_accounting_packages").select("*").order("name"));
export const savePackage = async (p) => check(await supabase.rpc("hub_acct_package_save", { p }));
export const saveDefaults = async (p) => check(await supabase.rpc("hub_acct_defaults_save", { p }));
export const saveAdmin = async (p) => check(await supabase.rpc("hub_acct_admin_save", { p }));
export const createQuote = async (p) => check(await supabase.rpc("hub_acct_quote_create", { p }));
export const acceptOption = async (id, i) => check(await supabase.rpc("hub_acct_accept", { p_quote: id, p_option: i }));
export const createAgreement = async (p) => check(await supabase.rpc("hub_acct_agreement_create", { p }));
export const updateAgreement = async (id, a) => check(await supabase.rpc("hub_acct_agreement_update", { p_id: id, p_agreement: a }));
export const approveDoc = async (id, pdf, word, seen) => check(await supabase.rpc("hub_acct_approve", { p_id: id, p_pdf: pdf, p_word: word, p_seen: seen }));
export const attachDoc = async (id, pdf, word) => check(await supabase.rpc("hub_acct_attach", { p_id: id, p_pdf: pdf, p_word: word }));
export const markSaved = async (id, path) => check(await supabase.rpc("hub_acct_saved", { p_id: id, p_path: path }));
export const canApprove = async () => check(await supabase.rpc("hub_acct_can_approve"));
// The mail draft of an Accounting quote or agreement; any staff member may change it. Raises when the draft is not found.
export const updateAccountingMail = async (id, subject, body) => check(await supabase.rpc("hub_acct_mail_update", { p_id: id, p_subject: subject, p_body: body }));

// Removes uploaded files, for example signed files whose approval was refused.
export async function removeDocs(paths) {
  const list = (paths || []).filter(Boolean);
  if (!list.length) return;
  const { error } = await supabase.storage.from(BUCKET).remove(list);
  if (error) throw new Error(error.message);
}

// The Accounting screen's own list: every quote and agreement made here and their mail drafts, filtered on the server.
// The old desk list (listDocuments, 500 rows) stays as it is.
export const listAccountingDocuments = () => loadAccountingDocs({
  readDocs: async (from, to) => check(await supabase.from("hub_documents").select("*").in("library_template", ACCOUNTING_TEMPLATES)
    .order("created_at", { ascending: false }).order("id").range(from, to)),
  readMail: async (ids, from, to) => check(await supabase.from("hub_documents").select("*").eq("doc_type", "mail").in("parent_id", ids)
    .order("created_at", { ascending: false }).order("id").range(from, to)),
});

// The PDF is stored under Accounting/<id>/<uuid>.pdf and the Word file beside it. Returns the storage path.
export async function uploadDoc(doc, blob, ext) {
  const path = `Accounting/${doc.id}/${crypto.randomUUID()}.${ext}`;
  const type = ext === "pdf" ? "application/pdf" : blob.type;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: type });
  if (error) throw new Error(error.message);
  return path;
}

// The countersigned copy, kept beside the draft. The date is the day the client signed.
export async function recordSigned(id, date, file) {
  const ext = String(file.name || "").split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") || "pdf";
  const path = `Accounting/${id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: ext === "pdf" ? "application/pdf" : file.type || undefined });
  if (error) throw new Error(error.message);
  return check(await supabase.rpc("hub_acct_signed", { p_id: id, p_date: date, p_path: path }));
}

// Copies Word and PDF into the client's Proposals folder through the Client Module on this PC. Null when it is off.
export async function saveFolder(doc, wordBlob, pdfBlob) {
  try {
    const name = fileNameFor(doc.document_number, doc.client_name);
    const form = new FormData();
    form.append("word", new File([wordBlob], name, { type: wordBlob.type }));
    form.append("pdf", new File([pdfBlob], name.replace(/\.docx$/, ".pdf"), { type: "application/pdf" }));
    form.append("client", doc.client_name || "");
    form.append("client_id", doc.client_id || "");
    form.append("department", "Accounting");
    const res = await fetch(`${CLIENT_MODULE_URL}/api/proposal-folder`, { method: "POST", body: form, signal: AbortSignal.timeout(15000) });
    return res.ok ? (await res.json()).path || null : null;
  } catch { return null; }
}

export async function sendDoc(id, resend, options = {}) {
  const body = { document_id: id, resend: !!resend, from: options.from, signature_id: options.signature_id || null };
  const { data, error } = await supabase.functions.invoke("accounting-proposal-mail-send", { body });
  if (error) {
    // The function explains a refusal in its response; the client's own message is generic.
    let message = error.message;
    try { message = (await error.context.json()).error || message; } catch { /* keep the client's message */ }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// What the Send dialog offers: the mailboxes this user owns (row-level security limits the list) and the shared signatures.
export async function loadSendOptions() {
  const [boxes, sigs, session] = await Promise.all([
    supabase.schema("email_base").from("mailboxes").select("address, display_name").order("address"),
    supabase.schema("public").from("email_signatures").select("id, user_id, name, body_text, logo_url, is_default, sender_mailbox_address, owner:profiles(full_name, email)").order("created_at"),
    supabase.auth.getSession(),
  ]);
  if (boxes.error) throw new Error(boxes.error.message);
  if (sigs.error) throw new Error(sigs.error.message);
  return { owned: boxes.data || [], signatures: shapeSharedSignatures(sigs.data || [], session?.data?.session?.user?.id) };
}

export const openWord = (path) => openStored(path);
