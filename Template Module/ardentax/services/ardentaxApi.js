// The ArdentTax tab's access to the database and file storage. fakeApi.js has the same functions for the development page.
import { supabase } from "@app/supabase";

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
  signedUrl: async (path) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  },
};
