import { computeQuote } from "../logic/quoteModel";

// In-memory stand-in for ardentaxApi, for the development page only. It makes no database or storage calls,
// so trying the tab never uses a real number. Set failUpload to try the "File pending" path.
const TEMPLATE_URL = {
  quote: new URL("../templates/Ardentax_QUOTATION_TEMPLATE.docx", import.meta.url).href,
  letter: new URL("../templates/Ardentax_ENGAGEMENT_LETTER_TEMPLATE.docx", import.meta.url).href,
};

export function createFakeApi() {
  const docs = [];
  const files = new Map();
  const serial = { quote: 0, letter: 0 };
  const figures = (d) => {
    const custom = d.quoteType === "Custom";
    return { quote_type: custom ? "Custom" : "Standard", client_name: d.client.legal, selected_package: custom ? "Custom" : d.selected, volume: computeQuote(d).volume, created_by_name: "Dev" };
  };
  const add = (doc) => { docs.unshift(doc); return doc; };
  const api = {
    failUpload: false,
    files,
    loadTemplate: async (type) => new Uint8Array(await (await fetch(TEMPLATE_URL[type])).arrayBuffer()),
    mailSettings: async () => ({ subject: "Ardentax E-Invoicing (ASP) Proposal - {CLIENT}", body: "Dear {POC_FIRST},\n\nPlease find attached our proposal for {CLIENT}. The Year 1 total is {TOTAL} (excluding VAT).", signature_html: "<p>Regards</p>" }),
    list: async () => docs.map((d) => ({ ...d })),
    create: async (p) => {
      const found = docs.find((d) => d.request_id === p.request_id);
      if (found) return { ...found };
      if (p.source_quote_id && docs.some((d) => { const s = docs.find((x) => x.id === p.source_quote_id); return d.doc_type === "letter" && docs.some((x) => x.id === d.source_quote_id && x.document_number === s?.document_number); })) throw new Error("This quote already has its engagement letter");
      serial[p.doc_type] += 1;
      const tag = p.doc_type === "quote" ? "ADTQ" : "ADTE";
      return { ...add({ ...p, ...figures(p.details), id: crypto.randomUUID(), version: 1, document_number: `Ardentax/2026/11/${tag}${String(serial[p.doc_type]).padStart(3, "0")}`, one_time: p.totals.one_time, annual: p.totals.annual, year1_total: p.totals.year1, created_at: new Date().toISOString() }) };
    },
    revise: async (id, p) => {
      const found = docs.find((d) => d.request_id === p.request_id);
      if (found) return { ...found };
      const base = docs.find((d) => d.id === id);
      const version = Math.max(...docs.filter((d) => d.document_number === base.document_number).map((d) => d.version)) + 1;
      return { ...add({ ...p, ...figures(p.details), id: crypto.randomUUID(), doc_type: base.doc_type, version, revision_of: id, source_quote_id: base.source_quote_id, document_number: base.document_number, one_time: p.totals.one_time, annual: p.totals.annual, year1_total: p.totals.year1, created_at: new Date().toISOString() }) };
    },
    attach: async (id, word, pdf) => { Object.assign(docs.find((d) => d.id === id), { word_path: word, pdf_path: pdf }); },
    updateMail: async (id, m) => { Object.assign(docs.find((d) => d.id === id), { mail_to: m.to, mail_cc: m.cc, mail_subject: m.subject, mail_body: m.body, mail_attach_word: m.attachWord }); },
    upload: async (path, blob) => { if (api.failUpload) throw new Error("Storage is not available (test)."); files.set(path, blob); },
    failSend: false,
    sent: [],
    sendMail: async (id, _resend, { signed = false } = {}) => {
      if (api.failSend) throw new Error("The mail was not sent: server down (test).");
      const d = docs.find((x) => x.id === id);
      api.sent.push({ to: d.mail_to, subject: d.mail_subject, signed });
      d.mail_sent_at = new Date().toISOString();
      return { ok: true, sent_at: d.mail_sent_at, warnings: [] };
    },
    signedUrl: async (path) => URL.createObjectURL(files.get(path)),
    // Signing is not tried on the development page: nobody is an approver, so the Sign controls stay hidden.
    canSign: async () => false,
    signatures: async () => [],
    changedAt: async (id) => docs.find((d) => d.id === id)?.created_at || null,
    supersede: async () => false,
    sign: async () => ({ error: "Signing is not available on the development page." }),
  };
  return api;
}
