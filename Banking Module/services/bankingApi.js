import { supabase } from "@app/supabase";

const BUCKET = "banking-documents";
const MAX_FILE = 25 * 1024 * 1024;
const ALLOWED = /\.(pdf|png|jpe?g|webp|tiff?|docx?|xlsx?|csv|txt|eml|msg)$/i;
const CLIENT_MODULE_URL = (import.meta.env.VITE_CLIENT_MODULE_URL || "http://127.0.0.1:8792").replace(/\/$/, "");
const DOCUMENT_MODULE_URL = (import.meta.env.VITE_DOCUMENT_MODULE_URL || "").replace(/\/$/, "");

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
  const rows = await run(table("client_master").select("data").limit(5000));
  const needle = String(name || "").trim().toUpperCase();
  return rows.map((r) => r.data).filter((c) => JSON.stringify(c).toUpperCase().includes(needle)).slice(0, 20);
}

// Shows a generated file in Explorer on this PC, through the Client Module.
export async function openInFolder(path) {
  let res;
  try { res = await fetch(`${CLIENT_MODULE_URL}/api/generated-open`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }), signal: AbortSignal.timeout(8000) }); }
  catch { throw new Error("Open in Folder works on the office PC with the Client Module running. Use View here."); }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not open the folder.");
}

// Reads files with DOC OCR Module in this browser, so it needs no server and no PC left on.
// With VITE_DOCUMENT_MODULE_URL set, a hosted Document Module does the reading instead.
// onProgress gets the files finished; onPercent gets the whole read from 0 to 100, including the current page.
export async function readDocuments(files, onProgress, onPercent) {
  const percent = (done) => onPercent?.((done / files.length) * 100);
  if (DOCUMENT_MODULE_URL) return readDocumentsRemotely(files, (n) => { onProgress?.(n); percent(n); });
  const { readDocument } = await import("../../DOC OCR Module/browser/readDocument.js");
  const out = [];
  for (let i = 0; i < files.length; i++) {
    out.push(await readDocument(files[i], `${import.meta.env.BASE_URL}ocr/`, (p) => percent(i + p)));
    onProgress?.(i + 1);
    percent(i + 1);
  }
  return out;
}

async function readDocumentsRemotely(files, onProgress) {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw new Error(`Could not read the CRM session: ${error.message}`);
  if (!session?.access_token) throw new Error("Sign in to the CRM before reading documents.");
  const authHeaders = { Authorization: `Bearer ${session.access_token}` };
  const call = async (path, init) => {
    let res;
    try {
      res = await fetch(`${DOCUMENT_MODULE_URL}${path}`, {
        ...init,
        headers: { ...authHeaders, ...(init.headers || {}) },
      });
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error(`Could not connect to the Document Module at ${DOCUMENT_MODULE_URL}. Check the office server and VPN, or start Client Module\\Start-ClientModule.cmd on this PC.`);
      }
      throw error;
    }

    let body;
    try {
      body = await res.json();
    } catch {
      throw new Error(`Document Module returned an invalid response (${res.status}).`);
    }
    if (!res.ok) throw new Error(body.error || body.detail || `Document Module: ${res.status}`);
    return body;
  };
  const batch = await call("/api/batches", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (!batch.batch) throw new Error("Document Module did not create an upload batch.");
  const out = [];
  for (let i = 0; i < files.length; i++) {
    const form = new FormData();
    form.append("file", files[i]);
    const r = await call(`/api/batches/${batch.batch}/files`, { method: "POST", body: form });
    if (!r.id) throw new Error(`Document Module did not return a result for ${files[i].name}.`);
    out.push(r);
    await fetch(`${DOCUMENT_MODULE_URL}/api/batches/${batch.batch}/files/${r.id}`, {
      method: "DELETE",
      headers: authHeaders,
    }).catch((error) => {
      console.error(`Could not clear staged document ${files[i].name}:`, error);
    });
    onProgress?.(i + 1);
  }
  return out;
}

// A generated document is kept twice: in private storage and in the office PC's folder. Its number, serial
// and both locations are recorded in the database. The local copy needs the Client Module running.
export async function saveGenerated({ kind, caseId, blob, fileName, number, quotationId, letterId, paymentId }) {
  const file = new File([blob], fileName, { type: blob.type });
  const stored = await uploadFile(caseId, "generated", file);
  let localPath = null;
  try {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${CLIENT_MODULE_URL}/api/generated/${kind}`, { method: "POST", body: form, signal: AbortSignal.timeout(15000) });
    if (res.ok) localPath = (await res.json()).path;
  } catch { /* Client Module not running on this PC; the storage copy is still kept */ }
  return insertRow("banking_generated_documents", { case_id: caseId, kind, quotation_id: quotationId ?? null, letter_id: letterId ?? null, payment_id: paymentId ?? null, document_number: number, file_name: fileName, storage_path: stored.path, local_path: localPath });
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
