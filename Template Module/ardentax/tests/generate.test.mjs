// node --test "Template Module/ardentax/tests/"
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { defaultDetails } from "../logic/quoteModel.js";
import { generateDocument, makeLetter, rebuildArdentax, regenerate, reviseDocument, signArdentax } from "../services/generate.js";

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
    supersede: async (id, reason) => { calls.push(`supersede:${id}`); (api.superseded ||= []).push({ id, reason }); return false; },
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
  assert.deepEqual(names, ["template", "create", "template", "upload", "upload", "attach", "supersede"]);
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

// ---- Signing (shared step, Template Hub 011) ----
// Invented image bytes; the real Ardentax image is set in Settings > Signing.
const SIG = { bytes: new Uint8Array([137, 80, 78, 71, 9, 9]), type: "png", width: 300, height: 120 };
const partsOf = async (blob) => {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const out = {};
  for (const name of Object.keys(zip.files)) if (!zip.files[name].dir) out[name] = await zip.file(name).async(/\.(xml|rels)$/.test(name) ? "string" : "base64");
  return out;
};

test("regenerate ends the live signature after the new files are attached", async () => {
  const api = fakeApi();
  const doc = { id: "id-9", version: 1, document_number: "Ardentax/2026/11/ADTQ009", details: details() };
  await regenerate(api, doc, deps());
  assert.deepEqual(api.calls.slice(-2), ["attach", "supersede:id-9"]);
  assert.deepEqual(api.superseded, [{ id: "id-9", reason: "Generated again" }]);
});

test("a revision calls supersede on the revised row; the earlier version keeps its own signature", async () => {
  const api = fakeApi();
  await reviseDocument(api, { id: "id-1" }, details(), "req-r", deps());
  assert.deepEqual(api.superseded, [{ id: "id-rev", reason: "Revised" }]);
  assert.ok(!api.calls.includes("supersede:id-1"));
});

test("a new document calls supersede too, and a supersede failure does not undo the filed document", async () => {
  const api = fakeApi({ supersede: async () => { throw new Error("network down"); } });
  const out = await generateDocument(api, { details: details(), requestId: "r" }, deps());
  assert.equal(api.attached.id, out.doc.id);
  assert.ok(out.doc.pdf_path);
});

test("rebuild without a signature is the stored render", async () => {
  const api = fakeApi();
  const stored = await generateDocument(api, { details: details(), requestId: "r" }, deps());
  const again = await rebuildArdentax(stored.doc, null, { api, ...deps() });
  assert.deepEqual(await partsOf(again), await partsOf(stored.wordBlob));
});

for (const docType of ["quote", "letter"]) {
  test(`${docType}: the signed rebuild is the stored render except the signature`, async () => {
    const api = fakeApi();
    const stored = await generateDocument(api, { details: details((d) => { d.docType = docType; }), requestId: "r" }, deps());
    const signed = await rebuildArdentax(stored.doc, SIG, { api, ...deps() });
    assert.equal(signed.type, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const a = await partsOf(stored.wordBlob);
    const b = await partsOf(signed);
    // Only the picture, its relationship and its content type are new.
    assert.deepEqual(Object.keys(b).sort(), [...Object.keys(a), "word/media/signature.png"].sort());
    for (const name of Object.keys(a)) {
      if (["word/document.xml", "word/_rels/document.xml.rels", "[Content_Types].xml"].includes(name)) continue;
      assert.equal(b[name], a[name], name);
    }
    assert.equal(b["word/_rels/document.xml.rels"].replace(/<Relationship Id="rIdAccountingSignature"[^>]*\/>/, ""), a["word/_rels/document.xml.rels"]);
    assert.equal(b["[Content_Types].xml"], a["[Content_Types].xml"], "png is already a known type in the template");
    // document.xml: the blank signature line of the stored render is the picture paragraph in the signed one, and nothing else differs.
    const da = parse(a["word/document.xml"]);
    const db = parse(b["word/document.xml"]);
    const pa = da.getElementsByTagName("w:p");
    const pb = db.getElementsByTagName("w:p");
    assert.equal(pa.length, pb.length);
    const differ = [];
    for (let i = 0; i < pa.length; i += 1) if (serialize(pa.item(i)) !== serialize(pb.item(i))) differ.push(i);
    assert.equal(differ.length, 1);
    const [i] = differ;
    assert.equal(pa.item(i).textContent, "");
    assert.equal(pb.item(i).getElementsByTagName("w:drawing").length, 1);
    const [na, nb] = [pa.item(i), pb.item(i)];
    na.parentNode.removeChild(na);
    nb.parentNode.removeChild(nb);
    assert.equal(serialize(db), serialize(da));
  });
}

test("signing reads the change stamp, then runs the shared step with this table, the row and the rebuild", async () => {
  let args;
  const api = fakeApi({
    changedAt: async (id) => { api.calls.push(`stamp:${id}`); return "2026-11-06T10:00:00.123456+04:00"; },
    sign: async (a, opts) => { args = { ...a, toPdf: opts.toPdf }; return { signature: { id: "sig-1" }, wordBlob: await a.rebuild(a.doc, SIG), pdfBlob: new Blob(["%PDF"]) }; },
  });
  const stored = await generateDocument(api, { details: details(), requestId: "r" }, deps());
  const r = await signArdentax(api, stored.doc, deps());
  assert.equal(r.signature.id, "sig-1");
  assert.equal(args.table, "ardentax_documents");
  assert.equal(args.doc, stored.doc);
  assert.equal(args.seen, "2026-11-06T10:00:00.123456+04:00");
  assert.equal(typeof args.toPdf, "function");
  assert.ok((await JSZip.loadAsync(await r.wordBlob.arrayBuffer())).file("word/media/signature.png"));
  assert.ok(api.calls.indexOf("stamp:" + stored.doc.id) >= 0);
});

test("signing a document the caller cannot read, or one with no files, signs nothing", async () => {
  let signed = 0;
  const api = fakeApi({ changedAt: async () => null, sign: async () => { signed += 1; return {}; } });
  assert.match((await signArdentax(api, { id: "x", pdf_path: "p", word_path: "w", details: details() }, deps())).error, /not found/);
  assert.match((await signArdentax(api, { id: "x", details: details() }, deps())).error, /Generate again/);
  assert.equal(signed, 0);
});

test("a refused or failed signing comes back as an error, never thrown", async () => {
  const doc = { id: "x", pdf_path: "p", word_path: "w", details: details() };
  const refused = fakeApi({ changedAt: async () => "t", sign: async () => ({ error: "You are not an approver of ardentax" }) });
  assert.deepEqual(await signArdentax(refused, doc, deps()), { error: "You are not an approver of ardentax" });
  const broken = fakeApi({ changedAt: async () => { throw new Error("offline"); }, sign: async () => ({}) });
  assert.deepEqual(await signArdentax(broken, doc, deps()), { error: "offline" });
});

test("a blank date is saved as the Dubai day: Generate again and the signed copy print the day it was made", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-05T10:00:00Z") });
  const api = fakeApi();
  const made = await generateDocument(api, { details: details((d) => { d.date = ""; }), requestId: "r" }, deps());
  assert.equal(api.lastCreate.details.date, "2026-11-05", "the date goes to the database with the details");
  t.mock.timers.setTime(Date.parse("2026-11-06T10:00:00Z"));
  const again = await regenerate(api, { ...made.doc, created_at: "2026-11-05T10:00:00Z" }, deps());
  t.mock.timers.setTime(Date.parse("2026-11-07T10:00:00Z"));
  const signed = await rebuildArdentax({ ...again.doc, created_at: "2026-11-05T10:00:00Z" }, SIG, { api, ...deps() });
  for (const blob of [made.wordBlob, again.wordBlob, signed]) {
    const x = await textIn(blob);
    assert.ok(x.includes("05/11/2026"));
    assert.ok(!x.includes("06/11/2026") && !x.includes("07/11/2026"));
  }
});

test("a revision with a blank date saves the day it is made; a set date is kept", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-08T10:00:00Z") });
  const api = fakeApi();
  await reviseDocument(api, { id: "id-1" }, details((d) => { d.date = ""; }), "r", deps());
  assert.equal(api.lastRevise.details.date, "2026-11-08");
  await generateDocument(api, { details: details((d) => { d.date = "2026-10-01"; }), requestId: "r2" }, deps());
  assert.equal(api.lastCreate.details.date, "2026-10-01");
});

test("an older row with a blank saved date: Generate again and the signed copy both print its created_at day", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-06T10:00:00Z") });
  const api = fakeApi();
  const old = { id: "old-1", version: 1, document_number: "Ardentax/2026/11/ADTQ050", created_at: "2026-11-05T10:00:00Z", details: details((d) => { d.date = ""; }) };
  const stored = await regenerate(api, old, deps());
  t.mock.timers.setTime(Date.parse("2026-11-07T10:00:00Z"));
  const signed = await rebuildArdentax(stored.doc, SIG, { api, ...deps() });
  for (const blob of [stored.wordBlob, signed]) {
    const x = await textIn(blob);
    assert.ok(x.includes("05/11/2026"));
    assert.ok(!x.includes("06/11/2026") && !x.includes("07/11/2026"));
  }
  assert.equal(old.details.date, "", "the saved details are not changed");
});

test("a whitespace-only date counts as blank; a missing or invalid created_at falls back to today", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-09T10:00:00Z") });
  const api = fakeApi();
  const base = { id: "old-2", version: 1, document_number: "Ardentax/2026/11/ADTQ051" };
  const spaced = await regenerate(api, { ...base, created_at: "2026-11-05T10:00:00Z", details: details((d) => { d.date = "   "; }) }, deps());
  assert.ok((await textIn(spaced.wordBlob)).includes("05/11/2026"));
  for (const created_at of ["not a date", undefined]) {
    const r = await regenerate(api, { ...base, created_at, details: details((d) => { d.date = ""; }) }, deps());
    assert.ok((await textIn(r.wordBlob)).includes("09/11/2026"));
  }
  await generateDocument(api, { details: details((d) => { d.date = "  "; }), requestId: "r" }, deps());
  assert.equal(api.lastCreate.details.date, "2026-11-09", "a new document gets today");
});
