// Server calls for document signing: Settings > Signing and the deps the shared signing step (signing.js) needs.
import { supabase } from "@app/supabase";
import { BUCKET, check } from "./hubApi";
import { validateSignatureFile } from "../logic/signingView";

export const loadSigning = async () => {
  const rows = check(await supabase.from("hub_settings").select("value").eq("key", "document_signing"));
  return rows?.[0]?.value || null;
};
export const saveSigning = async (company, { approvers, signature_path } = {}) => {
  const p = { company };
  if (approvers !== undefined) p.approvers = approvers;
  if (signature_path !== undefined) p.signature_path = signature_path;
  return check(await supabase.rpc("doc_sign_admin_save", { p }));
};
export const canSign = async (company) => check(await supabase.rpc("doc_sign_can", { p_company: company })) === true;
export const liveSignature = async (table, id) => check(await supabase.rpc("doc_sign_live", { p_table: table, p_id: id }));
export const recordSignature = async (p) => check(await supabase.rpc("doc_sign_record", { p }));

export async function removeSigned(paths) {
  const list = (paths || []).filter(Boolean);
  if (!list.length) return;
  const { error } = await supabase.storage.from(BUCKET).remove(list);
  if (error) throw new Error(error.message);
}

// Stores the image under signatures/<company>/<uuid>.<ext> and returns the path. The caller then saves it with saveSigning.
export async function uploadSignature(company, file) {
  const v = validateSignatureFile(file);
  if (v.error) throw new Error(v.error);
  const path = `signatures/${company}/${crypto.randomUUID()}.${v.ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
  if (error) throw new Error(error.message);
  return path;
}

// A short-lived link to the private image, for the preview. Null when the caller may not read it.
export async function signatureLink(path) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
  return error ? null : data?.signedUrl || null;
}
