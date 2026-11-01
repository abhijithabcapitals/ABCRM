// The Word file a document is generated from: the uploaded master if there is one, otherwise the built-in template.
import { supabase } from "@app/supabase";

const BUCKET = "hub-documents";

async function latest(file) {
  const { data, error } = await supabase.from("hub_master_templates").select("storage_path").eq("template_file", file).order("id", { ascending: false }).limit(1).maybeSingle();
  return error ? null : data;
}

export async function templateBuffer(file, builtInUrl) {
  const row = await latest(file);
  if (row?.storage_path) {
    // A failed download stops here: quietly using another template would produce the wrong document.
    const { data, error } = await supabase.storage.from(BUCKET).download(row.storage_path);
    if (error) throw new Error(`Could not load the master template for ${file}: ${error.message}`);
    return data.arrayBuffer();
  }
  const res = await fetch(builtInUrl);
  if (!res.ok) throw new Error(`Template ${file} not found`);
  return res.arrayBuffer();
}

const check = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

export async function loadMasterTemplates() {
  const rows = check(await supabase.from("hub_master_templates").select("*").order("id", { ascending: false }).limit(500));
  const current = {};
  for (const r of rows) current[r.template_file] ||= r;
  return current;
}

export async function uploadMasterTemplate(templateFile, file) {
  const path = `master-templates/${templateFile.replace(".docx", "")}/${crypto.randomUUID()}.docx`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file);
  if (error) throw new Error(error.message);
  check(await supabase.rpc("hub_master_template_set", { p_file: templateFile, p_name: file.name, p_path: path }));
}

export const useBuiltInTemplate = async (templateFile) => check(await supabase.rpc("hub_master_template_set", { p_file: templateFile, p_name: null, p_path: null }));
