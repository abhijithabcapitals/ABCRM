// Server calls for signing Business Banking documents (Template Hub 011): the api that services/bankingSigning.js needs.
// The AB Capital image is read from Settings > Signing (hub-documents, approvers only); the signed Word and PDF are stored in
// banking-documents under <case id>/generated/<document id>/signed/, beside the generated files and under the same read policy.
import { supabase } from "@app/supabase";
import { signDocument } from "@template-hub/services/signing.js";
import { canSign, loadCompanyImage, recordSignature } from "@template-hub/services/signingApi.js";
import { docCompany, signedPrefix } from "@template-hub/logic/signingView.js";
import { withSignatures } from "@template-hub/logic/accountingUi.js";

const BUCKET = "banking-documents";
const check = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const toPdf = async (wordBlob) => (await import("@template-hub/ardentax/logic/docxToPdf.js")).docxToPdf(wordBlob);

async function upload(path, blob, type) {
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { upsert: false, contentType: type });
  if (error) throw new Error(error.message);
  return path;
}

// Clean-up after a failed record. banking-documents has no delete policy (stored files are never removed from the app), so this
// usually fails and is ignored by signing.js; the file is left unreferenced under the signed/ folder.
async function remove(paths) {
  const list = (paths || []).filter(Boolean);
  if (!list.length) return;
  const { error } = await supabase.storage.from(BUCKET).remove(list);
  if (error) throw new Error(error.message);
}

export const bankingSigningApi = {
  canSign: () => canSign("ab_capital"),
  changedAt: async (table, id) => check(await supabase.rpc("doc_changed_at", { p_table: table, p_id: id })),
  supersede: async (table, id, reason) => check(await supabase.rpc("doc_sign_supersede", { p_table: table, p_id: id, p_reason: reason })),
  sign: (args) => signDocument(args, {
    canSign, company: async (table, doc) => docCompany(table, doc), loadImage: loadCompanyImage, toPdf,
    upload, record: recordSignature, remove, bucketPrefix: signedPrefix,
  }),
};

// The signatures of these documents (read under the caller's own rules), newest first, with the signer's name, as
// { [source id]: { live, last } }. ids are the quotation, letter or receipt ids.
export async function loadBankingSignatures(table, ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  const out = [];
  for (let i = 0; i < list.length; i += 100) {
    out.push(...(check(await supabase.from("document_signatures")
      .select("id, source_id, signed_at, signed_by, pdf_path, word_path, superseded_at, superseded_reason, signer:profiles!signed_by(full_name)")
      .eq("source_table", table).in("source_id", list.slice(i, i + 100)).order("signed_at", { ascending: false })) || []));
  }
  return Object.fromEntries(withSignatures(list.map((id) => ({ id })), out).map((d) => [d.id, d.signing]));
}
