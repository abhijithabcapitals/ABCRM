import { supabase } from "@app/supabase";

const BUCKET = "banking-documents";
const MAX_FILE = 25 * 1024 * 1024;
const ALLOWED = /\.(pdf|png|jpe?g|webp|tiff?|docx?|xlsx?|csv|txt|eml|msg)$/i;
const CLIENT_MODULE_URL = (import.meta.env.VITE_CLIENT_MODULE_URL || "http://127.0.0.1:8792").replace(/\/$/, "");

function check({ data, error }) {
  if (error) throw new Error(error.hint ? `${error.message} (${error.hint})` : error.message);
  return data;
}

export const rpc = async (name, args = {}) => check(await supabase.rpc(name, args));
export const table = (name) => supabase.from(name);
export const run = async (query) => check(await query);

export async function listAll(name, select = "*", order = "created_at", ascending = false) {
  return check(await supabase.from(name).select(select).order(order, { ascending }).limit(2000));
}
export const insertRow = async (name, values) => check(await supabase.from(name).insert(values).select().single());
export const updateRow = async (name, id, values) => check(await supabase.from(name).update(values).eq("id", id).select().single());
export const deleteRow = async (name, id) => check(await supabase.from(name).delete().eq("id", id));
export const profiles = async () => check(await supabase.from("profiles").select("id, full_name, role").order("full_name"));

async function sha256(file) {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Files go to a private bucket under an unguessable path. Stored versions are never replaced.
export async function uploadFile(caseId, area, file) {
  if (file.size > MAX_FILE) throw new Error("File is larger than 25 MB");
  if (!ALLOWED.test(file.name)) throw new Error("This file type is not allowed");
  const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-100);
  const path = `${caseId}/${area}/${crypto.randomUUID()}-${safe}`;
  const digest = await sha256(file);
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) throw new Error(error.message);
  return { path, name: file.name, mime: file.type, size: file.size, sha256: digest };
}

export async function openFile(path) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
  if (error) throw new Error(error.message);
  window.open(data.signedUrl, "_blank", "noopener");
}

// Client Master is the local Client Module (this PC only). Offline: staff type the CL number instead.
export async function searchClientMaster(name) {
  const res = await fetch(`${CLIENT_MODULE_URL}/api/clients`, { signal: AbortSignal.timeout(4000) });
  const body = await res.json();
  const needle = String(name || "").trim().toUpperCase();
  return (body.clients || []).filter((c) => JSON.stringify(c).toUpperCase().includes(needle)).slice(0, 20);
}

// Reads files through the local Document Module (Client Module on this PC), then clears them from its staging area.
export async function readDocuments(files, onProgress) {
  const call = async (path, init) => {
    const res = await fetch(`${CLIENT_MODULE_URL}${path}`, init);
    if (!res.ok && res.status !== 409 && res.status !== 400) throw new Error(`Document Module: ${res.status}`);
    return res.json();
  };
  const batch = await call("/api/batches", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const out = [];
  for (let i = 0; i < files.length; i++) {
    const form = new FormData();
    form.append("file", files[i]);
    const r = await call(`/api/batches/${batch.batch}/files`, { method: "POST", body: form });
    if (r.id) {
      out.push(r);
      await fetch(`${CLIENT_MODULE_URL}/api/batches/${batch.batch}/files/${r.id}`, { method: "DELETE" }).catch(() => {});
    }
    onProgress?.(i + 1);
  }
  return out;
}

// A generated document is kept twice: in private storage and in the office PC's folder. Its number, serial
// and both locations are recorded in the database. The local copy needs the Client Module running.
export async function saveGenerated({ kind, caseId, blob, fileName, number, quotationId, letterId }) {
  const file = new File([blob], fileName, { type: blob.type });
  const stored = await uploadFile(caseId, "generated", file);
  let localPath = null;
  try {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${CLIENT_MODULE_URL}/api/generated/${kind}`, { method: "POST", body: form, signal: AbortSignal.timeout(15000) });
    if (res.ok) localPath = (await res.json()).path;
  } catch { /* Client Module not running on this PC; the storage copy is still kept */ }
  return insertRow("banking_generated_documents", { case_id: caseId, kind, quotation_id: quotationId ?? null, letter_id: letterId ?? null, document_number: number, file_name: fileName, storage_path: stored.path, local_path: localPath });
}

// Batches staged rows so one big workbook does not hit the request size limit.
export async function stageImport(meta, rows, onProgress) {
  const imp = await insertRow("banking_excel_imports", meta);
  const size = 200;
  for (let i = 0; i < rows.length; i += size) {
    const part = rows.slice(i, i + size).map((r) => {
      const { duplicate_of_row: _d, possible_duplicate_of: _p, ...rest } = r;
      return { ...rest, import_id: imp.id };
    });
    check(await supabase.from("banking_excel_import_rows").insert(part));
    onProgress?.(Math.min(i + size, rows.length), rows.length);
  }
  return imp;
}

export async function loadSettings() {
  const rows = check(await supabase.from("banking_settings").select("key, value"));
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
