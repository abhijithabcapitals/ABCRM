import { supabase } from "@app/supabase";

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
export const clientNames = async () => {
  try { return (check(await supabase.rpc("client_base_list")) || []).map((c) => c.display_name); } catch { return []; }
};

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

export async function openStored(path) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
  if (error) throw new Error(error.message);
  window.open(data.signedUrl, "_blank", "noopener");
}

export async function renderTemplate(templateFile, data) {
  const [{ default: PizZip }, { default: Docxtemplater }] = await Promise.all([import("pizzip"), import("docxtemplater")]);
  const res = await fetch(new URL(`../templates/${templateFile}`, import.meta.url).href);
  if (!res.ok) throw new Error(`Template ${templateFile} not found`);
  const doc = new Docxtemplater(new PizZip(await res.arrayBuffer()), { paragraphLoop: true, linebreaks: true, nullGetter: () => "" });
  doc.render(data);
  return doc.getZip().generate({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}
