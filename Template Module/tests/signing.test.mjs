// node --test "Template Module/tests/signing.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { signDocument } from "../services/signing.js";
import { addSignature, signatureXml } from "../logic/signDocx.js";

const require = createRequire(new URL("../../Main Module/package.json", import.meta.url));
const PizZip = require("pizzip");

const IMG = { bytes: new Uint8Array([1, 2, 3]), type: "png", width: 200, height: 100 };
const DOC = { id: "11111111-1111-4111-8111-111111111111" };
const PREFIX = "Test Family/11111111-1111-4111-8111-111111111111/signed/";

function make(over = {}) {
  const calls = [];
  const log = (n, v) => async (...a) => { calls.push(n); return typeof v === "function" ? v(...a) : v; };
  const deps = {
    canSign: log("canSign", true),
    company: () => "test_co",
    loadImage: log("loadImage", IMG),
    toPdf: log("toPdf", new Blob(["pdf"])),
    upload: log("upload", (p) => ({ path: p })),
    record: log("record", { id: "sig1" }),
    remove: log("remove", undefined),
    bucketPrefix: () => PREFIX,
    ...over,
  };
  const rebuild = over.rebuild || log("rebuild", new Blob(["word"]));
  return { calls, deps, rebuild };
}
const run = (t, rebuild = t.rebuild) => signDocument({ table: "hub_documents", doc: DOC, rebuild, seen: "2030-01-01T00:00:00.000Z" }, t.deps);

test("happy path order and result", async () => {
  const uploads = [];
  const t = make({ upload: async (p, b, ty) => { uploads.push([p, ty]); t.calls.push("upload"); } });
  const r = await run(t);
  assert.deepEqual(t.calls, ["canSign", "loadImage", "rebuild", "toPdf", "upload", "upload", "record"]);
  assert.equal(r.signature.id, "sig1");
  assert.ok(r.wordBlob && r.pdfBlob);
  assert.match(uploads[0][0], /\.pdf$/);
  assert.match(uploads[1][0], /\.docx$/);
  assert.ok(uploads.every(([p]) => p.startsWith(PREFIX)));
  assert.equal(uploads[0][1], "application/pdf");
});

test("record gets paths, seen and source", async () => {
  let rec;
  const t = make({ record: async (p) => { rec = p; return {}; } });
  await run(t);
  assert.equal(rec.source_table, "hub_documents");
  assert.equal(rec.source_id, DOC.id);
  assert.equal(rec.seen, "2030-01-01T00:00:00.000Z");
  assert.match(rec.pdf_path, /\.pdf$/);
  assert.match(rec.word_path, /\.docx$/);
});

test("not an approver: nothing else called", async () => {
  const t = make({ canSign: async () => { t.calls.push("canSign"); return false; } });
  const r = await run(t);
  assert.deepEqual(t.calls, ["canSign"]);
  assert.ok(r.error);
});

test("image missing names the company", async () => {
  const t = make({ loadImage: async () => { t.calls.push("loadImage"); return null; }, company: () => "Test Company FZE" });
  const r = await run(t);
  assert.match(r.error, /Test Company FZE/);
  assert.deepEqual(t.calls, ["canSign", "loadImage"]);
});

test("rebuild failure: nothing uploaded or recorded", async () => {
  const t = make();
  const r = await run(t, async () => { throw new Error("rebuild broke"); });
  assert.equal(r.error, "rebuild broke");
  assert.ok(!t.calls.some((c) => ["upload", "record", "remove"].includes(c)));
});

test("pdf failure: nothing uploaded or recorded", async () => {
  const t = make({ toPdf: async () => { throw new Error("pdf broke"); } });
  const r = await run(t);
  assert.equal(r.error, "pdf broke");
  assert.ok(!t.calls.includes("upload") && !t.calls.includes("record"));
});

test("record failure removes both paths and returns the original error", async () => {
  let removed;
  const t = make({ record: async () => { throw new Error("The document changed. Open it again and sign."); }, remove: async (p) => { removed = p; } });
  const r = await run(t);
  assert.equal(r.error, "The document changed. Open it again and sign.");
  assert.equal(removed.length, 2);
  assert.ok(removed.some((p) => p.endsWith(".pdf")) && removed.some((p) => p.endsWith(".docx")));
});

test("record failure survives a failing remove", async () => {
  const t = make({ record: async () => { throw new Error("orig"); }, remove: async () => { throw new Error("cleanup"); } });
  assert.equal((await run(t)).error, "orig");
});

test("addSignature adds media, relationship and content type", () => {
  const zip = new PizZip();
  zip.file("word/_rels/document.xml.rels", "<Relationships></Relationships>");
  zip.file("[Content_Types].xml", '<Types><Default Extension="xml" ContentType="x"/></Types>');
  addSignature(zip, "", IMG);
  assert.ok(zip.file("word/media/signature.png"));
  assert.match(zip.file("word/_rels/document.xml.rels").asText(), /rIdAccountingSignature/);
  assert.match(zip.file("[Content_Types].xml").asText(), /Extension="png"/);
  assert.match(signatureXml(IMG), /rIdAccountingSignature/);
});
