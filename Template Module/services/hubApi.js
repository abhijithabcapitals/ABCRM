import { supabase } from "@app/supabase";
import { oldDeskRows } from "../logic/serviceDocs";
import { templateBuffer } from "@banking/services/masterTemplates";
import { withoutProposals } from "../logic/proposalModel";

export { openInFolder } from "@banking/services/bankingApi";

export const BUCKET = "hub-documents";
export const CLIENT_MODULE_URL = (import.meta.env.VITE_CLIENT_MODULE_URL || "http://127.0.0.1:8792").replace(/\/$/, "");

export const check = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

export const loadCatalogue = async () => {
  const categories = check(await supabase.from("service_categories").select("*, service_items(id, name, sort_order, is_active)").eq("is_active", true).order("sort_order"));
  return categories.map((c) => ({ ...c, service_items: c.service_items.filter((s) => s.is_active).sort((a, b) => a.sort_order - b.sort_order) }));
};
export const loadHubSettings = async () => Object.fromEntries(check(await supabase.from("hub_settings").select("key, value")).map((r) => [r.key, r.value]));
export const createDocument = async (p) => check(await supabase.rpc("hub_document_create", { p }));
export const listDocuments = async (department) => {
  let q = supabase.from("hub_documents").select("*").neq("doc_type", "library").order("created_at", { ascending: false }).limit(500);
  if (department) q = q.eq("department", department);
  return check(await q);
};
export const updateMail = async (id, subject, body) => check(await supabase.rpc("hub_mail_update", { p_id: id, p_subject: subject, p_body: body }));
export const isHubAdmin = async () => check(await supabase.rpc("hub_is_admin"));
export const numberingStatus = async () => check(await supabase.rpc("hub_numbering_status"));
export const saveNumbering = async (department, kind, v) => check(await supabase.rpc("hub_numbering_save", { p_department: department, p_kind: kind, p_format: v.format, p_digits: v.digits, p_restart: v.restart, p_next: v.next_serial }));
export const loadVouchers = async () => check(await supabase.from("voucher_register").select("*").order("created_at", { ascending: false }).limit(5000));
// Keeps the file in private storage and, where the Client Module runs, in the office folder.
export async function saveFile(doc, kind, blob, fileName) {
  const file = new File([blob], fileName, { type: blob.type });
  const path = `${doc.department}/${doc.id}/${crypto.randomUUID()}.docx`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file);
  if (error) throw new Error(error.message);
  let local = null;
  try {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${CLIENT_MODULE_URL}/api/generated/${kind}`, { method: "POST", body: form, signal: AbortSignal.timeout(15000) });
    if (res.ok) local = (await res.json()).path;
  } catch { /* Client Module not running on this PC; the storage copy is still kept */ }
  check(await supabase.rpc("hub_document_attach", { p_id: doc.id, p_storage: path, p_local: local }));
  return { path, local };
}

// Puts a file into its Generated Documents folder through the Client Module on this PC. Null when it is off.
async function savePc(kind, file) {
  try {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${CLIENT_MODULE_URL}/api/generated/${kind}`, { method: "POST", body: form, signal: AbortSignal.timeout(15000) });
    return res.ok ? (await res.json()).path : null;
  } catch { return null; }
}

// A document generated from a Word template: kept, filed and recorded in the Voucher Register under its file name.
export async function recordTemplateDocument(blob, fileName, clientName, department = "Business Setup") {
  const file = new File([blob], fileName, { type: blob.type });
  const path = `${department}/templates/${crypto.randomUUID()}.docx`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file);
  if (error) throw new Error(error.message);
  const local = await savePc("setup_quote", file);
  check(await supabase.rpc("voucher_template_record", { p: { file_name: fileName, client_name: clientName || null, department, storage_path: path, local_path: local } }));
  return { path, local };
}

// Files the documents created while the Client Module was off. Returns how many were saved, or null if it is still off.
export async function savePendingToPc(rows) {
  try { const h = await fetch(`${CLIENT_MODULE_URL}/api/health`, { signal: AbortSignal.timeout(4000) }); if (!h.ok) return null; } catch { return null; }
  let saved = 0;
  for (const r of rows) {
    const bucket = r.source === "banking" ? "banking-documents" : BUCKET;
    const { data, error } = await supabase.storage.from(bucket).download(r.storage_path);
    if (error) throw new Error(`${r.voucher_number}: ${error.message}`);
    const name = r.file_name || `${String(r.voucher_number).replace(/[/\\]+/g, "-")} ${String(r.client_name || "").replace(/[^A-Za-z0-9 _-]+/g, "").trim()}.docx`;
    const local = await savePc(pcKind(r), new File([data], name, { type: data.type }));
    if (!local) continue;
    check(await supabase.rpc("voucher_set_local", { p_id: r.id, p_path: local }));
    saved += 1;
  }
  return saved;
}

export const pcKind = (r) => {
  const type = { Quotation: "quote", "Engagement Letter": "letter", Receipt: "receipt" }[r.voucher_type];
  return r.department === "Business Banking" ? type : `${{ "Business Setup": "setup", Accounting: "accounting", "Tax Compliance": "tax" }[r.department]}_${type}`;
};

export async function openStored(path, bucket = BUCKET) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
  if (error) throw new Error(error.message);
  window.open(data.signedUrl, "_blank", "noopener");
}

export async function renderTemplate(templateFile, data, { builtIn = true } = {}) {
  const [{ default: PizZip }, { default: Docxtemplater }] = await Promise.all([import("pizzip"), import("docxtemplater")]);
  const buffer = await templateBuffer(templateFile, builtIn ? new URL(`../templates/${templateFile}`, import.meta.url).href : null);
  const doc = new Docxtemplater(new PizZip(buffer), { paragraphLoop: true, linebreaks: true, nullGetter: () => "" });
  doc.render(data);
  return doc.getZip().generate({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

// ── Company Library: Word templates filled by staff ──
export async function storedBlob(path) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) throw new Error(error.message);
  return data;
}
export const libraryAccess = async () => check(await supabase.rpc("hub_library_my_access"));
export async function listLibraryTemplates() {
  const templates = check(await supabase.from("hub_library_templates").select("*").order("template_key"));
  const files = check(await supabase.from("hub_library_template_files").select("*").order("id", { ascending: false }));
  const latest = new Map();
  for (const f of files) if (!latest.has(f.template_key)) latest.set(f.template_key, f);
  return templates.map((t) => ({ ...t, file: latest.get(t.template_key) || null }));
}
export const saveLibraryTemplate = async (p) => check(await supabase.rpc("hub_library_template_save", { p }));
export async function uploadLibraryFile(templateKey, company, file) {
  const path = `library-templates/${company}/${crypto.randomUUID()}.docx`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file);
  if (error) throw new Error(error.message);
  return check(await supabase.rpc("hub_library_template_upload", { p_key: templateKey, p_name: file.name, p_path: path }));
}
async function libraryPath(fileId) {
  const row = check(await supabase.from("hub_library_template_files").select("storage_path").eq("id", fileId).maybeSingle());
  if (!row) throw new Error("Template file not found.");
  return row.storage_path;
}
export async function libraryFileBuffer(fileId) {
  const { data, error } = await supabase.storage.from(BUCKET).download(await libraryPath(fileId));
  if (error || !data) throw new Error(`Could not download the template file: ${error?.message || "no data"}`);
  return data.arrayBuffer();
}
export async function libraryFileUrl(fileId) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(await libraryPath(fileId), 300);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}
export const createLibraryLetter = async (p) => check(await supabase.rpc("hub_library_letter_create", { p }));
// Quotes a letter can start from: not in a case, and with no letter yet.
export async function listLetterableQuotes() {
  const quotes = check(await supabase.from("hub_documents").select("*").eq("doc_type", "quote").eq("department", "Business Setup").in("status", ["issued", "accepted"]).is("case_id", null).order("created_at", { ascending: false }).limit(500));
  const letters = check(await supabase.from("hub_documents").select("parent_id").eq("doc_type", "letter").not("parent_id", "is", null));
  const taken = new Set(letters.map((l) => l.parent_id));
  return withoutProposals(oldDeskRows(quotes)).filter((q) => !taken.has(q.id));
}
export const createLibraryDocument = async (p) => check(await supabase.rpc("hub_library_create", { p }));
export const listLibraryDocuments = async () => withoutProposals(oldDeskRows(check(await supabase.from("hub_documents").select("*").not("library_template", "is", null).order("created_at", { ascending: false }).limit(500))));
export async function searchClients(name) {
  const rows = check(await supabase.from("client_master").select("client_id, data").limit(5000));
  const needle = String(name || "").trim().toUpperCase();
  return rows.filter((r) => JSON.stringify(r.data).toUpperCase().includes(needle)).slice(0, 20);
}
