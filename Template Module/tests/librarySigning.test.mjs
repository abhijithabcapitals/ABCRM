// Signing on Company Templates documents (logic/librarySigning.js): the AB Capital built-in designs (the Service templates) and Company
// Library fills ({{ }} tags). The client is the test client; the signature is a few made-up bytes, never a real image.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  designFileData, designTemplate, isLibraryFill, libraryCompany, libraryDocumentBlob, libraryFillData, librarySignState, librarySignable,
  rebuildLibraryDocument, signLibraryDocument,
} from "../logic/librarySigning.js";
import { retryDesign, retryLibraryDocument } from "../services/libraryGenerate.js";
import { libraryContext } from "../logic/libraryContext.js";
import { designContext } from "../logic/libraryLetter.js";
import { LIBRARY_NO_PLACE, LIBRARY_TAGS } from "../logic/renderDocx.js";
import { REL_ID, UNSIGNED_SPACE, renderSigned, signatureXml } from "../logic/signDocx.js";

const require = createRequire(new URL("../../Main Module/package.json", import.meta.url));
const libs = { PizZip: require("pizzip"), Docxtemplater: require("docxtemplater") };
const template = (file) => readFileSync(fileURLToPath(new URL(`../templates/${file}`, import.meta.url)));
const xmlOf = (bytes, part = "word/document.xml") => new libs.PizZip(bytes).file(part)?.asText();
// renderTemplate and renderDocx without the network or the browser: the same renderSigned, with the same options.
const renderDesign = async (file, data, { signature = null } = {}) => renderSigned(libs, template(file), data, signature, file).generate({ type: "uint8array" });
const renderFill = async (buffer, data, { signature = null } = {}) =>
  renderSigned(libs, buffer, data, signature, "library", { ...LIBRARY_TAGS, missing: LIBRARY_NO_PLACE }).generate({ type: "uint8array" });

// A Company Library file: {{ }} tags, with or without the signatory place {{@signature_xml}} on a line of its own.
function libraryFile(withPlace) {
  const z = new libs.PizZip();
  const body = '<w:p><w:r><w:t xml:space="preserve">{{ ref_no }} {{ client_name }} {{ date }}</w:t></w:r></w:p>'
    + "<w:p><w:r><w:t>{{#items}}{{description}} {{amount}}{{/items}}</w:t></w:r></w:p>"
    + (withPlace ? "<w:p><w:r><w:t>{{@signature_xml}}</w:t></w:r></w:p>" : "")
    + "<w:p><w:r><w:t>Authorized Signatory</w:t></w:r></w:p>";
  z.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  z.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  z.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
  z.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}</w:body></w:document>`);
  return z.generate({ type: "uint8array" });
}

const sig = { bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]), type: "png", width: 400, height: 200 };
const settings = { company: { name: "AB Capital Services FZE", short_name: "AB Capital", bank: { account_name: "Acct" } }, engagement_terms: { payment_terms: ["Pay first. {{vat_statement}}"], limitations: "General" } };
const common = { client_name: "TEST CLIENT - DO NOT USE", contact_name: "Test Contact", created_at: "2026-11-05T08:00:00.123456+00:00", status: "issued", vat_mode: "none", vat_rate: 0 };
const design = { ...common, id: "d1", doc_type: "quote", department: "Business Setup", document_number: "TEST/BSQ/7", library_template: "AB Capital/Formation/IFZA", library_file_id: null,
  storage_path: "Business Setup/d1/a.docx", field_values: { client_name: "TEST CLIENT - DO NOT USE", date: "2026-11-04" }, services: ["Formation"], lines: [{ description: "Formation", amount: 100 }], total_amount: 100 };
const letter = { ...design, id: "d2", doc_type: "letter", document_number: "TEST/BSE/7", library_template: "AB Capital/Engagement Letter", storage_path: "Business Setup/d2/a.docx" };
const fill = { ...common, id: "f1", doc_type: "library", department: "Ardentax Documents", document_number: "TEST/ADTD/1", library_template: "Ardentax/Letters/Master", library_file_id: 7,
  storage_path: "Ardentax Documents/f1/a.docx", field_values: { client_name: "TEST CLIENT - DO NOT USE", date: "2026-11-04", usd_rate: 3.6725 }, lines: [{ description: "Fee", amount: 250, remarks: "", rate: "" }] };
const abFill = { ...fill, id: "f2", doc_type: "quote", department: "Business Setup", document_number: "TEST/BSQ/8", library_template: "AB Capital/Formation/IFZA", storage_path: "Business Setup/f2/a.docx" };

// ── the company and what can be signed ────────────────────────────────
test("the company comes from the row: Ardentax for Ardentax library templates, AB Capital otherwise", () => {
  assert.equal(libraryCompany(fill), "ardentax");
  for (const doc of [design, letter, abFill, { library_template: "AB Capital/Proposal" }, {}]) assert.equal(libraryCompany(doc), "ab_capital");
  assert.equal(isLibraryFill(fill), true);
  assert.equal(isLibraryFill(design), false);
});

test("Sign shows only to an approver of the row's own company, on a filed, current library document", () => {
  const ab = { approvers: { ab_capital: true } };
  const ax = { approvers: { ardentax: true } };
  for (const doc of [design, letter, abFill]) {
    assert.equal(librarySignState(doc, ab).sign, true, doc.document_number);
    assert.equal(librarySignState(doc, ax).sign, false, `${doc.document_number}: an Ardentax approver cannot sign AB Capital`);
  }
  assert.equal(librarySignState(fill, ax).sign, true);
  assert.equal(librarySignState(fill, ab).sign, false, "an AB Capital approver cannot sign Ardentax");
  assert.equal(librarySignState(design, {}).sign, false);
  assert.equal(librarySignState(design, { approvers: { ab_capital: "true" } }).sign, false);
  for (const other of [{ storage_path: null }, { status: "superseded" }, { status: "rejected" }, { library_template: null }, { library_template: "AB Capital/Proposal" },
    { library_template: "AB Capital/Accounting Quote" }, { library_template: "AB Capital/Accounting Agreement" }, { doc_type: "mail" }, { id: null }]) {
    assert.equal(librarySignable({ ...design, ...other }), false, JSON.stringify(other));
    assert.equal(librarySignState({ ...design, ...other }, ab).sign, false, JSON.stringify(other));
  }
});

test("once signed: the signed copies for everyone, Unsigned copy on Open, no second Sign", () => {
  const live = { live: { id: "s", signer_name: "Test Approver", signed_at: "2026-11-06", word_path: "Business Setup/d1/signed/x.docx", pdf_path: "Business Setup/d1/signed/x.pdf" } };
  live.last = live.live;
  const s = librarySignState(design, { approvers: { ab_capital: true }, signing: live });
  assert.equal(s.sign, false);
  assert.deepEqual(s.copies.map((c) => c.path), [live.live.word_path, live.live.pdf_path]);
  assert.equal(s.openLabel, "Unsigned copy");
  assert.equal(librarySignState(design, {}).openLabel, "Open");
  assert.equal(librarySignState({ ...design, status: "superseded" }, { signing: live }).showStatus, true);
  assert.equal(librarySignState({ ...design, library_template: "AB Capital/Proposal" }, {}).showStatus, false);
});

// ── the render ────────────────────────────────────────────────────────
test("a design draws the stored row and its stored date; a fill its stored values, fee rows and Ref", () => {
  assert.deepEqual(designFileData(design, settings), designContext("quote", design, settings.company, settings.engagement_terms, "2026-11-04"));
  assert.deepEqual(designFileData(letter, settings), designContext("letter", letter, settings.company, settings.engagement_terms, "2026-11-04"));
  assert.equal(designTemplate(design), "Service_Quotation_Template.docx");
  assert.equal(designTemplate(letter), "Service_Engagement_Template.docx");
  assert.deepEqual(libraryFillData(fill), libraryContext({ client_name: "TEST CLIENT - DO NOT USE", date: "2026-11-04" }, [{ label: "Fee", amount: 250, remarks: "", rate: "" }], 3.6725, "TEST/ADTD/1"));
});

// Retry's file, captured from its save.
async function retried(doc, buffer) {
  let blob;
  const save = async (_d, b) => { blob = b; return { path: "p" }; };
  const out = isLibraryFill(doc)
    ? await retryLibraryDocument(doc, { loadFile: async () => buffer, render: (buf, data) => renderFill(buf, data), save })
    : await retryDesign(doc, { loadSettings: async () => settings, render: (data) => renderDesign(designTemplate(doc), data), save });
  assert.equal(out.error, undefined);
  return blob;
}

test("designs: unsigned has the blank signatory place; the signed rebuild equals Retry's file except the signature", async () => {
  for (const doc of [design, letter]) {
    const plain = xmlOf(await retried(doc));
    assert.equal(plain, xmlOf(await libraryDocumentBlob(doc, null, { settings, renderDesign })), "Retry and the shared render agree");
    assert.ok(plain.includes(UNSIGNED_SPACE));
    assert.ok(!plain.includes(REL_ID));
    const signed = await rebuildLibraryDocument(doc, sig, { settings, renderDesign });
    assert.ok(xmlOf(signed).includes(`r:embed="${REL_ID}"`));
    assert.ok(xmlOf(signed, "word/_rels/document.xml.rels").includes(`Id="${REL_ID}"`));
    assert.equal(xmlOf(signed).replace(signatureXml(sig), UNSIGNED_SPACE), plain, doc.document_number);
    const text = xmlOf(signed).replace(/<[^>]+>/g, "");
    for (const want of [doc.document_number, "TEST CLIENT - DO NOT USE"]) assert.ok(text.includes(want), `${doc.document_number}: ${want}`);
  }
});

test("fills: a template with {{@signature_xml}} signs and equals Retry's file except the signature", async () => {
  const buffer = libraryFile(true);
  for (const doc of [fill, abFill]) {
    const plain = xmlOf(await retried(doc, buffer));
    assert.ok(plain.includes(UNSIGNED_SPACE));
    assert.ok(plain.replace(/<[^>]+>/g, "").includes(`${doc.document_number} TEST CLIENT - DO NOT USE 04/11/2026`));
    const signed = await rebuildLibraryDocument(doc, sig, { buffer, renderFill });
    assert.ok(xmlOf(signed).includes(`r:embed="${REL_ID}"`));
    assert.equal(xmlOf(signed).replace(signatureXml(sig), UNSIGNED_SPACE), plain, doc.document_number);
  }
});

test("fills: a template without the place fills as before, and signing it is refused with what to do", async () => {
  const buffer = libraryFile(false);
  const plain = xmlOf(await retried(fill, buffer));
  assert.ok(!plain.includes(UNSIGNED_SPACE) && !plain.includes("signature_xml"));
  await assert.rejects(rebuildLibraryDocument(fill, sig, { buffer, renderFill }), (e) => e.message === LIBRARY_NO_PLACE);
  await assert.rejects(rebuildLibraryDocument(fill, null, { buffer, renderFill }), /signature image is needed/);
});

// ── signing ───────────────────────────────────────────────────────────
function api(over = {}) {
  const calls = [];
  return {
    calls,
    loadSettings: async () => { calls.push("settings"); return settings; },
    loadFile: async (id) => { calls.push(["file", id]); return libraryFile(true); },
    renderFill, renderDesign,
    sign: async (args) => { calls.push(["sign", args.table, args.doc.id, args.seen]); const wordBlob = await args.rebuild(args.doc, sig); return { signature: { id: "s1" }, wordBlob }; },
    ...over,
  };
}

test("signing a design loads the settings, a fill its own template file; both send the row's own change stamp", async () => {
  const a = api();
  const r = await signLibraryDocument({ ...design, content_changed_at: "2026-11-06T01:02:03.456789+00:00" }, a);
  assert.equal(r.error, undefined);
  assert.deepEqual(a.calls, ["settings", ["sign", "hub_documents", "d1", "2026-11-06T01:02:03.456789+00:00"]]);
  assert.ok(xmlOf(r.wordBlob).includes(`r:embed="${REL_ID}"`));
  const b = api();
  const f = await signLibraryDocument(fill, b);
  assert.equal(f.error, undefined);
  assert.deepEqual(b.calls, [["file", 7], ["sign", "hub_documents", "f1", fill.created_at]]);
});

test("signing refuses rows signed elsewhere, and returns refusals and failures as { error }", async () => {
  const a = api();
  for (const doc of [{ ...design, library_template: "AB Capital/Proposal" }, { ...design, library_template: "AB Capital/Accounting Agreement" }, { ...design, storage_path: null }]) {
    assert.match((await signLibraryDocument(doc, a)).error, /cannot be signed here/);
  }
  assert.deepEqual(a.calls, []);
  assert.equal((await signLibraryDocument(fill, api({ loadFile: async () => libraryFile(false) }))).error, LIBRARY_NO_PLACE);
  assert.equal((await signLibraryDocument(design, api({ sign: async () => ({ error: "You are not an approver of ab_capital" }) }))).error, "You are not an approver of ab_capital");
  assert.equal((await signLibraryDocument(fill, api({ loadFile: async () => { throw new Error("Template file not found."); } }))).error, "Template file not found.");
});

test("Company Templates files through fileAndWithdraw and signs through librarySignState", () => {
  const form = readFileSync(fileURLToPath(new URL("../components/LibraryForm.jsx", import.meta.url)), "utf8");
  assert.equal(form.split("fileThenWithdraw(doc, () => saveFile(").length - 1, 2, "both library and design saves withdraw after filing");
  const register = readFileSync(fileURLToPath(new URL("../components/LibraryRegister.jsx", import.meta.url)), "utf8");
  assert.ok(register.includes('canSignSafe("ab_capital"), canSignSafe("ardentax")'));
  assert.ok(register.includes("librarySignState(d, signOf(d))"));
});
