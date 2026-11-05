import { supabase } from "@app/supabase";
import { templateBuffer } from "@banking/services/masterTemplates";

export { openInFolder } from "@banking/services/bankingApi";

const BUCKET = "hub-documents";
const CLIENT_MODULE_URL = (import.meta.env.VITE_CLIENT_MODULE_URL || "http://127.0.0.1:8792").replace(/\/$/, "");

const check = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

export const loadCatalogue = async () => {
  const categories = check(await supabase.from("service_categories").select("*, service_items(id, name, sort_order, is_active)").eq("is_active", true).order("sort_order"));
  return categories.map((c) => ({ ...c, service_items: c.service_items.filter((s) => s.is_active).sort((a, b) => a.sort_order - b.sort_order) }));
};
export const loadHubSettings = async () => Object.fromEntries(check(await supabase.from("hub_settings").select("key, value")).map((r) => [r.key, r.value]));
export const createDocument = async (p) => check(await supabase.rpc("hub_document_create", { p }));
export const listDocuments = async (department) => {
  let q = supabase.from("hub_documents").select("*").order("created_at", { ascending: false }).limit(500);
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
