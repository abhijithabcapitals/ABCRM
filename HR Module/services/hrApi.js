import { supabase } from "@app/supabase";

const BUCKET = "hr-documents";
const MAX_FILE = 25 * 1024 * 1024;
const ALLOWED = /\.(pdf|png|jpe?g|webp|tiff?|docx?|xlsx?|csv|txt)$/i;
const CLIENT_MODULE_URL = (import.meta.env.VITE_CLIENT_MODULE_URL || "http://127.0.0.1:8792").replace(/\/$/, "");

export function check({ data, error }) {
  if (error) throw new Error(error.hint ? `${error.message} (${error.hint})` : error.message);
  return data;
}

export const rpc = async (name, args = {}) => check(await supabase.rpc(name, args));
export const table = (name) => supabase.from(name);
export const run = async (query) => check(await query);
export const insertRow = async (name, values) => check(await supabase.from(name).insert(values).select().single());
export const updateRow = async (name, id, values) => check(await supabase.from(name).update(values).eq("id", id).select().single());

// { role: 'hr' | 'manager' | 'employee' | 'none', employee_id }
export const myAccess = () => rpc("hr_my_access");
export const expiringDocuments = () => rpc("hr_documents_expiring");
export const employeeTasks = () => rpc("hr_employee_tasks");
export const dashboardNumbers = () => rpc("hr_dashboard");

// Stores a file in the private bucket under the employee's folder and returns the path. Stored files are never replaced.
export async function uploadDocument(employeeId, file) {
  if (!employeeId) throw new Error("Choose the employee first");
  if (file.size > MAX_FILE) throw new Error("File is larger than 25 MB");
  if (!ALLOWED.test(file.name)) throw new Error("This file type is not allowed");
  const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-100);
  const path = `${employeeId}/${crypto.randomUUID()}-${safe}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) throw new Error(error.message);
  return path;
}

// Opens a stored file through a short-lived signed link.
export async function openDocument(path) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
  if (error) throw new Error(error.message);
  window.open(data.signedUrl, "_blank", "noopener");
}

// Reads one file through the local Document Module (the Client Module on this PC), then clears it from its staging area.
// Throws when the service is not running: callers treat that as "fill the form by hand".
export async function readDocument(file) {
  const call = async (path, init) => {
    const res = await fetch(`${CLIENT_MODULE_URL}${path}`, { ...init, signal: AbortSignal.timeout(60000) });
    if (!res.ok && res.status !== 409 && res.status !== 400) throw new Error(`Document Module: ${res.status}`);
    return res.json();
  };
  const batch = await call("/api/batches", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const form = new FormData();
  form.append("file", file);
  const r = await call(`/api/batches/${batch.batch}/files`, { method: "POST", body: form });
  if (r.id) await fetch(`${CLIENT_MODULE_URL}/api/batches/${batch.batch}/files/${r.id}`, { method: "DELETE" }).catch(() => {});
  return r.id ? r : null;
}

// Leave. hr_leave_request returns { ids: uuid[], warning: text | null }; a range over a year end becomes one row per year.
export const leaveRequest = (employee, type, from, to, note) => rpc("hr_leave_request", { p_employee: employee, p_type: type, p_from: from, p_to: to, p_note: note || null });
export const leaveDecide = (request, approve, note) => rpc("hr_leave_decide", { p_request: request, p_approve: approve, p_note: note || null });
export const leaveCancel = (request) => rpc("hr_leave_cancel", { p_request: request });
export const leaveBalance = (employee, year) => rpc("hr_leave_balance", { p_employee: employee, p_year: year });
