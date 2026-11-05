// node --test "Template Module/tests/proposalDocx.test.mjs"
// Resolves pizzip, docxtemplater and jszip through Main Module (run `npm ci` there first), like the other Template Module tests.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { renderProposal } from "../logic/proposalDocx.js";
import { proposalContext } from "../logic/proposalModel.js";

const require = createRequire(new URL("../../Main Module/package.json", import.meta.url));
const JSZip = require("jszip");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const deps = { PizZip, Docxtemplater };
const template = readFileSync(new URL("../templates/AB_Capital_Proposal_Template.docx", import.meta.url));

// Neutral made-up data only.
const settings = {
  company: { bank: { account_name: "Sample Trading LLC", bank: "Sample Bank", account_no: "1234", iban: "AE00 0000", swift: "SAMPAEAD", currency: "AED" } },
  proposal_defaults: { usd_rate: 3.6725, contact: { name: "Sam Sample", phone: "+971 00 000 0000", email: "sam@example.com", website: "www.example.com" } },
};
const option = (over = {}) => ({
  authority_key: "SAMPLE", authority_name: "Sample Free Zone", activity: "Event Management", title: "Sample Zone Package", description: "A sample description.",
  logo_path: null, timeline_path: null, package_includes: ["One licence"], red_notes: ["Sample note"],
  services: [{ name: "Licence", remarks: "", amount: 1000, subs: [] }, { name: "Visa", remarks: "", amount: "", subs: [{ name: "Entry permit", amount: 200 }, { name: "Stamping", amount: 300 }] }],
  ...over,
});
const doc = (options, shared = {}) => ({
  document_number: "ABC/2026/11/BSQ900", created_at: "2026-11-05T08:00:00Z",
  field_values: { proposal: { usd_rate: 3.6725, options, shared: { addons: [{ name: "Sample add-on", amount: 500, text: "" }], documents: ["Passport copy"], payment: ["100% in advance"], scope: ["Incorporation"], notes: ["Sample terms"], ...shared } } },
});
const ctx = (options, shared) => proposalContext(doc(options, shared), settings);
const read = async (blob, name = "word/document.xml") => (await JSZip.loadAsync(await blob.arrayBuffer())).file(name).async("string");
const text = (xml) => xml.replace(/<[^>]+>/g, "");
const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

// Strict enough for our output: tags balance, and every & starts an entity.
function assertWellFormed(xml) {
  const stack = [];
  for (const m of xml.matchAll(/<(\/?)([A-Za-z][\w:.-]*)[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (m[1]) assert.equal(stack.pop(), m[2], `unbalanced </${m[2]}>`);
    else stack.push(m[2]);
  }
  assert.deepEqual(stack, []);
  assert.equal(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(xml), false, "bare &");
  assert.equal(/<[^>]*<|>[^<]*>\s*[^<\s][^<]*>/.test(xml.replace(/<[^>]+>/g, "")), false);
}

test("renders one option", async () => {
  const xml = await read(await renderProposal(template, ctx([option()]), {}, deps));
  const t = text(xml);
  assert.match(t, /Business Formation Proposal/);
  assert.match(t, /Event Management/);
  assert.match(t, /Sample Free Zone/);
  assert.match(t, /Total/);
  assert.match(t, /1,500/);
  assert.match(t, /ABC\/2026\/11\/BSQ900/);
  assert.match(t, /05\/11\/2026/);
  assert.match(t, /Sample Bank/);
  assert.match(t, /sam@example\.com/);
  assert.doesNotMatch(xml, /[{}]/);
  assert.doesNotMatch(t, /Option 1/);
  assertWellFormed(xml);
});

test("sub services print indented under a bold subtotal row", async () => {
  const xml = await read(await renderProposal(template, ctx([option()]), {}, deps));
  const t = text(xml);
  assert.ok(t.indexOf("Visa") < t.indexOf("  Entry permit") && t.indexOf("  Entry permit") < t.indexOf("  Stamping"));
  assert.doesNotMatch(t, /  Licence/);
  assert.match(t, /Visa[^]*500/);
});

test("two options", async () => {
  const xml = await read(await renderProposal(template, ctx([option(), option({ activity: "Second Activity" })]), {}, deps));
  const t = text(xml);
  assert.match(t, /Option 1/);
  assert.match(t, /Option 2/);
  const breaks = xml.match(/<w:br w:type="page"\/>/g) || [];
  assert.equal(breaks.length, 1);
  assert.ok(xml.indexOf('<w:br w:type="page"/>') < xml.indexOf("Option 2"));
  assert.ok(xml.indexOf('<w:br w:type="page"/>') > xml.indexOf("Option 1"));
  for (const once of ["Add-on Services", "Documents Required", "Payment Terms", "Bank Details:", "Scope of work", "Notes:", "Contact: - "]) {
    assert.equal(t.split(once).length - 1, 1, once);
  }
  assert.equal(t.split("Approximate Costing of Company Incorporation").length - 1, 2);
  assertWellFormed(xml);
});

test("escapes", async () => {
  const bad = 'Events & "Co" <A/B>';
  const xml = await read(await renderProposal(template, ctx([option({ activity: bad })], { notes: ["R&D <b>"] }), {}, deps));
  assertWellFormed(xml);
  assert.ok(xml.includes("Events &amp; \"Co\" &lt;A/B&gt;") || xml.includes("Events &amp; &quot;Co&quot; &lt;A/B&gt;"));
  assert.equal(xml.includes("<A/B>"), false);
});

test("no image", async () => {
  const withNone = await renderProposal(template, ctx([option()]), {}, deps);
  const zip = await JSZip.loadAsync(await withNone.arrayBuffer());
  assert.equal((await zip.file("word/document.xml").async("string")).includes("<w:drawing"), false);
  assert.equal(Object.keys(zip.files).some((n) => n.startsWith("word/media/proposal")), false);
  assert.doesNotMatch(await zip.file("word/_rels/document.xml.rels").async("string"), /proposal/i);
  // A path with no matching image gives the same result.
  const orphan = await renderProposal(template, ctx([option({ logo_path: "gone/logo.png", timeline_path: "gone/t.png" })]), {}, deps);
  const z2 = await JSZip.loadAsync(await orphan.arrayBuffer());
  assert.equal((await z2.file("word/document.xml").async("string")).includes("<w:drawing"), false);
  assert.doesNotMatch(await z2.file("word/_rels/document.xml.rels").async("string"), /proposal/i);
});

test("image", async () => {
  const images = { "a/logo.png": { bytes: PNG, type: "png", width: 300, height: 100 } };
  const blob = await renderProposal(template, ctx([option({ logo_path: "a/logo.png" }), option({ logo_path: "a/logo.png" })]), images, deps);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const media = Object.keys(zip.files).filter((n) => n.startsWith("word/media/proposal"));
  assert.equal(media.length, 1, "same image stored once");
  const rels = await zip.file("word/_rels/document.xml.rels").async("string");
  const rel = rels.match(/<Relationship [^>]*Target="media\/proposal[^"]*"[^>]*\/>/g);
  assert.equal(rel.length, 1);
  assert.match(rel[0], /relationships\/image/);
  const id = rel[0].match(/Id="([^"]+)"/)[1];
  assert.ok((await zip.file("[Content_Types].xml").async("string")).includes('Extension="png"'));
  const xml = await zip.file("word/document.xml").async("string");
  const drawings = xml.match(/<w:drawing>[^]*?<\/w:drawing>/g);
  assert.equal(drawings.length, 2);
  for (const d of drawings) {
    assert.ok(d.includes(`r:embed="${id}"`));
    const [cx, cy] = d.match(/<wp:extent cx="(\d+)" cy="(\d+)"/).slice(1).map(Number);
    assert.ok(Math.abs(cx / cy - 3) < 0.01, `aspect ${cx / cy}`);
  }
  const ids = drawings.map((d) => d.match(/<wp:docPr id="(\d+)"/)[1]);
  assert.equal(new Set(ids).size, 2, "unique docPr ids");
  assertWellFormed(xml);
});

test("jpeg and timeline add their content type", async () => {
  const images = { "t.jpg": { bytes: PNG, type: "jpeg", width: 1000, height: 400 } };
  const zip = await JSZip.loadAsync(await (await renderProposal(template, ctx([option({ timeline_path: "t.jpg" })]), images, deps)).arrayBuffer());
  assert.ok((await zip.file("[Content_Types].xml").async("string")).includes('Extension="jpeg"'));
  assert.ok(Object.keys(zip.files).some((n) => /^word\/media\/proposal.*\.jpeg$/.test(n)));
  const d = (await zip.file("word/document.xml").async("string")).match(/<wp:extent cx="(\d+)" cy="(\d+)"/);
  assert.ok(Math.abs(d[1] / d[2] - 2.5) < 0.01);
});

test("no secrets in template", async () => {
  const zip = await JSZip.loadAsync(template);
  for (const name of Object.keys(zip.files).filter((n) => /^(word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml|docProps\/.*\.xml|\[Content_Types\]\.xml|.*\.rels)$/.test(n))) {
    const xml = await zip.file(name).async("string");
    assert.equal(/AE\d{10,}/.test(xml), false, name);
    assert.equal(/\b\d{10,}\b/.test(xml), false, name);
  }
  const media = Object.keys(zip.files).filter((n) => n.startsWith("word/media/") && !zip.files[n].dir);
  const hdr = await zip.file("word/_rels/header1.xml.rels").async("string");
  const logos = [...hdr.matchAll(/Target="(media\/[^"]+)"/g)].map((m) => `word/${m[1]}`).sort();
  assert.deepEqual(media.sort(), logos);
  assert.equal(Object.keys(zip.files).some((n) => n.startsWith("customXml") || n === "docProps/custom.xml"), false);
  const doc = await zip.file("word/document.xml").async("string");
  assert.equal(doc.includes("<w:drawing"), false);
  assert.equal(/\d{4,}/.test(text(doc)), false, "no amounts or numbers typed into the body");
});

test("remarks column", async () => {
  const none = text(await read(await renderProposal(template, ctx([option()]), {}, deps)));
  assert.equal(none.includes("Remarks"), false);
  const noneXml = await read(await renderProposal(template, ctx([option()]), {}, deps));
  assert.equal(noneXml.match(/<w:gridCol /g).length, 3 + 3, "option table 3 columns + add-on table 3");
  const withXml = await read(await renderProposal(template, ctx([option({ services: [{ name: "Licence", remarks: "Sample remark", amount: 1000, subs: [] }] })]), {}, deps));
  assert.match(text(withXml), /Remarks/);
  assert.match(text(withXml), /Sample remark/);
  assert.equal(withXml.match(/<w:gridCol /g).length, 4 + 3);
});

test("mixed options use their own table", async () => {
  const xml = await read(await renderProposal(template, ctx([option(), option({ services: [{ name: "Licence", remarks: "R1", amount: 1, subs: [] }] })]), {}, deps));
  assert.equal(xml.match(/<w:gridCol /g).length, 3 + 4 + 3);
});

// Pale fill of the printed row that holds `label`.
const paleRow = (xml, label) => {
  const tr = xml.split("</w:tr>").find((r) => text(r).includes(label));
  assert.ok(tr, label);
  return /w:fill="F2DCDB"/.test(tr);
};
const plain = (name, amount, remarks = "") => ({ name, remarks, amount, subs: [] });

test("plain rows alternate pale red across printed rows (3 and 4 columns)", async () => {
  for (const remarks of ["", "Sample remark"]) {
    const services = ["Alpha", "Bravo", "Charlie", "Delta"].map((n) => plain(n, 10, remarks));
    const xml = await read(await renderProposal(template, ctx([option({ services })]), {}, deps));
    assert.deepEqual(["Alpha", "Bravo", "Charlie", "Delta"].map((n) => paleRow(xml, n)), [false, true, false, true], remarks);
  }
});

test("bold rows stay pale and the alternation counts sub rows", async () => {
  const services = [plain("Alpha", 10), { name: "Bundle", remarks: "", amount: "", subs: [{ name: "SubOne", amount: 1 }, { name: "SubTwo", amount: 2 }] }, plain("Omega", 5)];
  const xml = await read(await renderProposal(template, ctx([option({ services })]), {}, deps));
  // printed order: Alpha(0) Bundle(1, bold) SubOne(2) SubTwo(3) Omega(4)
  assert.deepEqual(["Alpha", "Bundle", "SubOne", "SubTwo", "Omega"].map((n) => paleRow(xml, n)), [false, true, false, true, false]);
  assert.doesNotMatch(xml, /[{}]/);
});
