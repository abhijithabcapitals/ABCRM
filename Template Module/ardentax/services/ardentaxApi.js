// The ArdentTax tab's access to the database and file storage. fakeApi.js has the same functions for the development page.
import { supabase } from "@app/supabase";
import { canSign, signHubDocument } from "../../services/signingApi";

const BUCKET = "hub-documents";
const check = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const TEMPLATE_URL = {
  quote: new URL("../templates/Ardentax_QUOTATION_TEMPLATE.docx", import.meta.url).href,
  letter: new URL("../templates/Ardentax_ENGAGEMENT_LETTER_TEMPLATE.docx", import.meta.url).href,
};

export const ardentaxApi = {
  loadTemplate: async (type) => {
    const res = await fetch(TEMPLATE_URL[type]);
    if (!res.ok) throw new Error(`Could not load the ${type} template.`);
    return new Uint8Array(await res.arrayBuffer());
  },
  mailSettings: async () => check(await supabase.from("hub_settings").select("value").eq("key", "ardentax_mail").single()).value,
  list: async () => check(await supabase.from("ardentax_documents").select("*").order("created_at", { ascending: false }).limit(1000)),
  create: async (p) => check(await supabase.rpc("ardentax_document_create", { p })),
  revise: async (id, p) => check(await supabase.rpc("ardentax_document_revise", { p_id: id, p })),
  attach: async (id, word, pdf) => check(await supabase.rpc("ardentax_document_attach", { p_id: id, p_word: word, p_pdf: pdf })),
  updateMail: async (id, m) => check(await supabase.rpc("ardentax_mail_update", { p_id: id, p_to: m.to, p_cc: m.cc, p_subject: m.subject, p_body: m.body, p_attach_word: m.attachWord })),
  upload: async (path, blob) => {
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: blob.type });
    if (error) throw new Error(error.message);
  },
  // signed: true sends the live signature's files; the function refuses when there is none. Otherwise the unsigned files go, as before.
  sendMail: async (id, resend, { signed = false } = {}) => {
    const { data, error } = await supabase.functions.invoke("ardentax-mail-send", { body: { document_id: id, resend: !!resend, signed: signed === true } });
    if (error) {
      // The function explains a refusal in its response; the client's own message is generic.
      let message = error.message;
      try { message = (await error.context.json()).error || message; } catch { /* keep the client's message */ }
      throw new Error(message);
    }
    return data;
  },
  // ---- Signing (shared step, Template Hub 011). Optional: nothing here is needed to send or download. ----
  canSign: () => canSign("ardentax"),
  // The signatures of these documents, read under the caller's own rules, newest first, with the signer's name.
  signatures: async (ids) => {
    const out = [];
    for (let i = 0; i < ids.length; i += 100) {
      out.push(...(check(await supabase.from("document_signatures")
        .select("id, source_id, signed_at, signed_by, pdf_path, word_path, superseded_at, superseded_reason, signer:profiles!signed_by(full_name)")
        .eq("source_table", "ardentax_documents").in("source_id", ids.slice(i, i + 100)).order("signed_at", { ascending: false })) || []));
    }
    return out;
  },
  changedAt: async (id) => check(await supabase.rpc("doc_changed_at", { p_table: "ardentax_documents", p_id: id })),
  supersede: async (id, reason) => check(await supabase.rpc("doc_sign_supersede", { p_table: "ardentax_documents", p_id: id, p_reason: reason })),
  // signing.js signDocument with the shared deps: the image from Settings > Signing (Ardentax), files under ArdentTax (ASP)/<id>/signed/.
  sign: (args, { toPdf }) => signHubDocument(args, { toPdf }),
  signedUrl: async (path) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  },
};
