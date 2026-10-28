import { supabase } from "./supabaseClient";
import { slugify, DEFAULT_USD_RATE } from "../logic/helpers";

// Every read/write of templates goes through here, so a host CRM can swap the
// backend (another Supabase project, a REST API, local disk) in one file.

export const TEMPLATES_TABLE = "quotation_templates";
export const HISTORY_TABLE = "quotation_template_history";
export const TEMPLATES_BUCKET = "quotation-templates";

// All live (non-deleted) templates, sorted by freezone.
export async function fetchTemplates() {
  const { data } = await supabase
    .from(TEMPLATES_TABLE)
    .select("*")
    .is("deleted_at", null)
    .order("freezone");
  return data || [];
}

// The template's .docx as an ArrayBuffer.
export async function downloadTemplateBuffer(tpl) {
  const { data, error } = await supabase.storage
    .from(TEMPLATES_BUCKET)
    .download(tpl.storage_path);
  if (error || !data) throw new Error(error?.message || "Could not download the template file.");
  return await data.arrayBuffer();
}

// Newest-first edit history (written by the DB trigger in database/02_*.sql).
export async function fetchTemplateHistory(templateId) {
  const { data } = await supabase
    .from(HISTORY_TABLE)
    .select("*")
    .eq("template_id", templateId)
    .order("changed_at", { ascending: false })
    .limit(50);
  return data || [];
}

// Save a template. `template` is the existing row ({} when new); `file` is an
// optional new .docx. Each upload gets its own path
// (<freezone-slug>/<timestamp>_<name>.docx), so every version of the file is kept.
export async function saveTemplate({ template, freezone, fields, usdRate, file, profile }) {
  const isNew = !template.id;
  let storage_path = template.storage_path;
  let file_name = template.file_name;
  if (file) {
    storage_path = `${slugify(freezone)}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    file_name = file.name;
    const { error: upErr } = await supabase.storage
      .from(TEMPLATES_BUCKET)
      .upload(storage_path, file, { upsert: false });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
  }

  const payload = {
    freezone: freezone.trim(),
    fields,
    usd_rate: Number(usdRate) > 0 ? Number(usdRate) : DEFAULT_USD_RATE,
    storage_path,
    file_name,
    updated_by: profile?.full_name || "Unknown",
    updated_at: new Date().toISOString(),
  };

  const res = isNew
    ? await supabase.from(TEMPLATES_TABLE).insert(payload)
    : await supabase.from(TEMPLATES_TABLE).update(payload).eq("id", template.id);
  if (res.error) throw new Error(res.error.message);
}

// Soft delete (sets deleted_at; the row and its history are kept).
export async function deleteTemplate(templateId) {
  await supabase
    .from(TEMPLATES_TABLE)
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", templateId);
}
