// node --test "Template Module/ardentax/tests/"
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { defaultDetails } from "../logic/quoteModel.js";
import { generateDocument, makeLetter, regenerate, reviseDocument } from "../services/generate.js";

const require = createRequire(new URL("../../../Main Module/package.json", import.meta.url));
const JSZip = require("jszip");
const { DOMParser, XMLSerializer } = require("@xmldom/xmldom");
const parse = (s) => new DOMParser().parseFromString(s, "application/xml");
const serialize = (d) => new XMLSerializer().serializeToString(d);
const toPdf = async () => new Blob(["%PDF"], { type: "application/pdf" });
const deps = (over = {}) => ({ JSZip, parse, serialize, toPdf, ...over });
const FILES = { quote: "Ardentax_QUOTATION_TEMPLATE.docx", letter: "Ardentax_ENGAGEMENT_LETTER_TEMPLATE.docx" };

function details(edit = () => {}) {
  const d = defaultDetails("2026-11-05");
  Object.assign(d.client, { legal: "Sample Trading LLC", short: "Sample Trading", poc: "Pat Doe", email: "pat@sample.example" });
  Object.assign(d.tiers.S, { docs: 3600, year: 4199 });
  d.rows.ONB.fee = 1500;
  edit(d);
  return d;
}

// Records the calls in order; the real templates and the real fill run through it.
function fakeApi(over = {}) {
  const calls = [];
  let serial = 0;
  const api = {
    calls,
    loadTemplate: async (type) => { calls.push(`template:${type}`); return readFileSync(new URL(`../templates/${FILES[type]}`, import.meta.url)); },
    mailSettings: async () => ({ subject: "Proposal - {CLIENT}", body: "Dear {POC_FIRST}, total {TOTAL}", signature_html: "<p>Regards</p>" }),
    create: async (p) => { calls.push("create"); api.lastCreate = p; serial += 1; const tag = p.doc_type === "quote" ? "ADTQ" : "ADTE"; return { id: `id-${serial}`, version: 1, doc_type: p.doc_type, document_number: `Ardentax/2026/11/${tag}00${serial}`, details: p.details, ...(p.mail_to ? { mail_to: p.mail_to, mail_subject: p.mail_subject, mail_body: p.mail_body } : {}) }; },
    revise: async (id, p) => { calls.push(`revise:${id}`); api.lastRevise = p; return { id: "id-rev", version: 2, doc_type: p.details.docType, document_number: "Ardentax/2026/11/ADTQ001", details: p.details, mail_to: p.mail_to, mail_subject: p.mail_subject, mail_body: p.mail_body }; },
    upload: async (path, blob) => { calls.push(`upload:${path}`); (api.uploads ||= []).push({ path, blob }); },
    attach: async (id, word, pdf) => { calls.push("attach"); api.attached = { id, word, pdf }; },
    ...over,
  };
  return api;
}

const textIn = async (blob) => {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return zip.file("word/document.xml").async("string");
};

test("order: trial fill, create, final fill, PDF, upload, attach", async () => {
  const api = fakeApi();
  const steps = [];
  const out = await generateDocument(api, { details: details(), requestId: "req-1" }, deps({ toPdf: async (b) => { steps.push(api.calls.includes("create") ? "pdf after create" : "pdf before create"); return new Blob([b.size ? "%PDF" : ""]); } }));
  assert.deepEqual(steps, ["pdf after create"]);
  const names = api.calls.map((c) => c.split(":")[0]);
  assert.deepEqual(names, ["template", "create", "template", "upload", "upload", "attach"]);
  assert.ok((await textIn(out.wordBlob)).includes("Ardentax/2026/11/ADTQ001"));
  assert.equal(out.doc.document_number, "Ardentax/2026/11/ADTQ001");
});

test("request id and totals go to the database", async () => {
  const api = fakeApi();
  await generateDocument(api, { details: details(), requestId: "req-7" }, deps());
  assert.equal(api.lastCreate.request_id, "req-7");
  assert.equal(api.lastCreate.doc_type, "quote");
  assert.deepEqual(api.lastCreate.totals, { one_time: 1500, annual: 4199, year1: 5699 });
});

test("a template problem is found before any number is used", async () => {
  const api = fakeApi({ loadTemplate: async () => new Uint8Array([1, 2, 3]) });
  await assert.rejects(generateDocument(api, { details: details(), requestId: "r" }, deps()));
  assert.ok(!api.calls.includes("create"));
});

test("missing required fields stop before any number is used", async () => {
  const api = fakeApi();
  await assert.rejects(generateDocument(api, { details: details((d) => { d.client.legal = ""; }), requestId: "r" }, deps()), /Client legal name/);
  assert.ok(!api.calls.includes("create"));
});

test("a PDF failure leaves the document unattached, and Generate again keeps its number", async () => {
  const api = fakeApi();
  let doc;
  await assert.rejects(
    generateDocument(api, { details: details(), requestId: "r", onCreated: (d) => { doc = d; } }, deps({ toPdf: async () => { throw new Error("no canvas"); } })),
    /no canvas/,
  );
  assert.ok(!api.calls.includes("attach"));
  assert.ok(doc.id);
  const creates = api.calls.filter((c) => c === "create").length;
  const again = await regenerate(api, doc, deps());
  assert.equal(api.calls.filter((c) => c === "create").length, creates);
  assert.equal(api.attached.id, doc.id);
  assert.ok((await textIn(again.wordBlob)).includes(doc.document_number));
});

test("an upload failure leaves the document unattached", async () => {
  const api = fakeApi({ upload: async () => { throw new Error("storage down"); } });
  await assert.rejects(generateDocument(api, { details: details(), requestId: "r" }, deps()), /storage down/);
  assert.ok(!api.calls.includes("attach"));
});

test("files go under the document's folder, with a fresh path on retry so storage does not refuse them", async () => {
  const api = fakeApi();
  const { doc } = await generateDocument(api, { details: details(), requestId: "r" }, deps());
  const [word, pdf] = api.uploads;
  assert.ok(word.path.startsWith(`ArdentTax (ASP)/${doc.id}/`));
  assert.ok(word.path.endsWith("/Ardentax-2026-11-ADTQ001 Sample Trading.docx"));
  assert.ok(pdf.path.endsWith("/Ardentax-2026-11-ADTQ001 Sample Trading.pdf"));
  await regenerate(api, doc, deps());
  assert.notEqual(api.uploads[2].path, word.path);
});

test("revision keeps the number and marks the file version", async () => {
  const api = fakeApi();
  const { doc } = await reviseDocument(api, { id: "id-1" }, details(), "req-r", deps());
  assert.equal(doc.version, 2);
  assert.equal(api.lastRevise.request_id, "req-r");
  assert.ok(api.calls.includes("revise:id-1"));
  assert.ok(api.uploads[0].path.endsWith("/Ardentax-2026-11-ADTQ001 Sample Trading v2.docx"));
});

test("letter from a quote uses the letter template and links the quote", async () => {
  const api = fakeApi();
  const quote = { id: "q-1", details: details() };
  const { wordBlob } = await makeLetter(api, quote, "req-l", deps());
  assert.equal(api.lastCreate.source_quote_id, "q-1");
  assert.equal(api.lastCreate.doc_type, "letter");
  assert.equal(api.lastCreate.details.docType, "letter");
  assert.equal(quote.details.docType, "quote");
  assert.ok(api.calls.includes("template:letter"));
  assert.ok((await textIn(wordBlob)).includes("Engagement Letter"));
});

test("the mail draft is filled from the settings, with the tokens replaced", async () => {
  const api = fakeApi();
  await generateDocument(api, { details: details(), requestId: "r" }, deps());
  assert.equal(api.lastCreate.mail_to, "pat@sample.example");
  assert.equal(api.lastCreate.mail_subject, "Proposal - Sample Trading LLC");
  assert.equal(api.lastCreate.mail_body, "Dear Pat, total 5,699 AED");
});

test("a revision gets a fresh draft with its new figures", async () => {
  const api = fakeApi();
  await reviseDocument(api, { id: "id-1" }, details((d) => { d.rows.ONB.fee = 2000; }), "r", deps());
  assert.equal(api.lastRevise.mail_body, "Dear Pat, total 6,199 AED");
  assert.equal(api.lastRevise.mail_to, "pat@sample.example");
});

test("a letter from a quote gets its own draft", async () => {
  const api = fakeApi();
  await makeLetter(api, { id: "q-1", details: details() }, "r", deps());
  assert.equal(api.lastCreate.mail_subject, "Proposal - Sample Trading LLC");
});
