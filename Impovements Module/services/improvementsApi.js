import { supabase } from "@app/supabase";
import { storagePath } from "../logic/improvements.js";

const BUCKET = "improvements";

function check({ data, error }) {
  if (error) throw new Error(error.hint ? `${error.message} (${error.hint})` : error.message);
  return data;
}

// The database returns only the caller's own rows, or every row for an admin.
export const listImprovements = async () =>
  check(await supabase.from("improvement_requests").select("*").order("created_at", { ascending: false }).limit(500));

// Uploads the screenshots into this improvement's folder first, then saves the row that lists them.
// If the row cannot be saved, the uploaded files are removed again.
export async function createImprovement(userId, { category, title, details, files }) {
  const id = crypto.randomUUID();
  const attachments = [];
  try {
    for (const file of files) {
      const path = storagePath(userId, id, crypto.randomUUID(), file.name);
      check(await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false }));
      attachments.push({ path, name: file.name, type: file.type, size: file.size });
    }
    return check(await supabase.from("improvement_requests")
      .insert({ id, category, title: title.trim(), details, attachments }).select("*").single());
  } catch (e) {
    if (attachments.length) await supabase.storage.from(BUCKET).remove(attachments.map((a) => a.path));
    throw e;
  }
}

// Admin only: the database refuses anyone else.
export const reviewImprovement = async (id, { status, admin_reply }) =>
  check(await supabase.from("improvement_requests").update({ status, admin_reply: admin_reply?.trim() || null }).eq("id", id).select("*").single());

// The writer may withdraw an improvement while it is still New; an admin may remove any.
export async function deleteImprovement(row) {
  const gone = check(await supabase.from("improvement_requests").delete().eq("id", row.id).select("id"));
  if (!gone?.length) throw new Error("This improvement can no longer be withdrawn: the admin has already looked at it.");
  const paths = (row.attachments || []).map((a) => a.path);
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
}

// Short-lived links for the private screenshots, keyed by path.
export async function signedUrls(paths) {
  if (!paths.length) return {};
  const data = check(await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600));
  return Object.fromEntries((data || []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
}
