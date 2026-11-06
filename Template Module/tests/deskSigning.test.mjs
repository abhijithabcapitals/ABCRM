// AB Capital signing on the Service Desk old form (logic/deskSigning.js) and the shared row rules (logic/hubSigning.js), with the
// built-in Service templates. The client is the test client; the signature is a few made-up bytes, never a real image.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  LETTER_TEMPLATE, QUOTE_TEMPLATE, deskDocumentBlob, deskDocumentData, deskLimitations, deskSignState, deskSignable, rebuildDeskDocument, signDeskDocument,
} from "../logic/deskSigning.js";
import { fileAndWithdraw, hubSignState, hubSignStatus, signedCopies, signingById } from "../logic/hubSigning.js";
import { letterData, quoteData } from "../logic/serviceDocs.js";
import { withLineVat } from "../../Business Setup Module/logic/quoteData.js";
import { REL_ID, UNSIGNED_SPACE, renderSigned, signatureXml } from "../logic/signDocx.js";

const require = createRequire(new URL("../../Main Module/package.json", import.meta.url));
const libs = { PizZip: require("pizzip"), Docxtemplater: require("docxtemplater") };
const template = (file) => readFileSync(fileURLToPath(new URL(`../templates/${file}`, import.meta.url)));
// renderTemplate without the network: the built-in template, through the same renderSigned.
const render = async (file, data, { signature = null } = {}) => renderSigned(libs, template(file), data, signature, file).generate({ type: "uint8array" });
const xmlOf = (bytes, part = "word/document.xml") => new libs.PizZip(bytes).file(part)?.asText();

const sig = { bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]), type: "png", width: 400, height: 200 };
const settings = { company: { name: "AB Capital Services FZE", short_name: "AB Capital", bank: { account_name: "Acct" } }, engagement_terms: { payment_terms: ["Pay first. {{vat_statement}}"], limitations: "General" } };
const catalogue = [{ limitation: "Books rules apply.", service_items: [{ name: "Bookkeeping" }] }, { limitation: "Other.", service_items: [{ name: "Audit" }] }];
const base = {
  client_name: "TEST CLIENT - DO NOT USE", contact_name: "Test Contact", created_at: "2026-11-05T08:00:00.123456+00:00", status: "issued",
  vat_mode: "exclusive", vat_rate: 5, vat_amount: 5, total_amount: 105, services: ["Bookkeeping"], lines: [{ description: "Bookkeeping", amount: 100 }],
};
const quote = { ...base, id: "q1", doc_type: "quote", department: "Accounting", document_number: "TEST/AQ/1", valid_until: "2026-12-05", storage_path: "Accounting/q1/a.docx" };
const letter = { ...base, id: "l1", doc_type: "letter", department: "Tax Compliance", document_number: "TEST/TL/1", parent_id: "q1", storage_path: "Tax Compliance/l1/a.docx" };
const setup = { ...base, id: "s1", doc_type: "quote", department: "Business Setup", document_number: "TEST/BSQ/1", services: ["Formation"],
  lines: [{ description: "Formation", service_name: "Formation", amount: 100, vat_rate: 5 }], storage_path: "Business Setup/s1/a.docx" };

// ── the render ────────────────────────────────────────────────────────
test("the desk data is what Generate filled before: quoteData or letterData, with line VAT for Business Setup only", () => {
  assert.deepEqual(deskDocumentData(quote, settings, catalogue), quoteData(quote, settings.company, settings.engagement_terms));
  assert.deepEqual(deskDocumentData(letter, settings, catalogue), letterData(letter, settings.company, settings.engagement_terms, ["Books rules apply."]));
  assert.deepEqual(deskDocumentData(setup, settings, catalogue), withLineVat(setup, quoteData(setup, settings.company, settings.engagement_terms)));
  assert.notDeepEqual(deskDocumentData(setup, settings), quoteData(setup, settings.company, settings.engagement_terms), "Business Setup adds its line VAT rows");
  assert.deepEqual(deskLimitations(letter, catalogue), ["Books rules apply."]);
  assert.deepEqual(deskLimitations({ services: null }, catalogue), []);
});

test("unsigned: blank lines in the signatory place, no picture; signed: the picture, its relationship and content type", async () => {
  for (const doc of [quote, letter, setup]) {
    const xml = xmlOf(await deskDocumentBlob(doc, null, { render, settings, catalogue }));
    assert.ok(xml.includes(UNSIGNED_SPACE), doc.document_number);
    assert.ok(!xml.includes(REL_ID), doc.document_number);
    const signed = await rebuildDeskDocument(doc, sig, { render, settings, catalogue });
    assert.ok(xmlOf(signed).includes(`r:embed="${REL_ID}"`), doc.document_number);
    assert.ok(xmlOf(signed, "word/_rels/document.xml.rels").includes(`Id="${REL_ID}"`));
    assert.ok(/Extension="png"/i.test(xmlOf(signed, "[Content_Types].xml")));
  }
});

test("rebuild matches the normal render (stored number, date, lines and totals) except the signature", async () => {
  for (const doc of [quote, letter, setup]) {
    const plain = xmlOf(await deskDocumentBlob(doc, null, { render, settings, catalogue }));
    const signed = xmlOf(await rebuildDeskDocument(doc, sig, { render, settings, catalogue }));
    assert.notEqual(signed, plain);
    assert.equal(signed.replace(signatureXml(sig), UNSIGNED_SPACE), plain, doc.document_number);
    const text = signed.replace(/<[^>]+>/g, "");
    for (const want of [doc.document_number, "05/11/2026", "TEST CLIENT - DO NOT USE"]) assert.ok(text.includes(want), `${doc.document_number}: ${want}`);
  }
  assert.ok(xmlOf(await rebuildDeskDocument(letter, sig, { render, settings, catalogue })).includes("Books rules apply."));
  assert.equal(QUOTE_TEMPLATE, "Service_Quotation_Template.docx");
  assert.equal(LETTER_TEMPLATE, "Service_Engagement_Template.docx");
});

test("rebuild needs the image", async () => {
  await assert.rejects(rebuildDeskDocument(quote, null, { render, settings }), /signature image is needed/);
});

// ── who sees what ─────────────────────────────────────────────────────
const live = { live: { id: "s1", signer_name: "Test Approver", signed_at: "2026-11-06", word_path: "Accounting/q1/signed/x.docx", pdf_path: "Accounting/q1/signed/x.pdf" }, last: null };
live.last = live.live;

test("Sign shows only for AB Capital approvers, on a filed, current desk quotation or letter without a live signature", () => {
  for (const doc of [quote, letter, setup, { ...quote, department: "Business Banking" }, { ...quote, status: "accepted" }]) {
    assert.equal(deskSignState(doc, { canSign: true }).sign, true, doc.department);
  }
  assert.equal(deskSignState(quote, { canSign: false }).sign, false);
  assert.equal(deskSignState(quote, {}).sign, false);
  assert.equal(deskSignState(quote, { canSign: "true" }).sign, false);
  assert.equal(deskSignState(quote, { canSign: true, signing: live }).sign, false);
  for (const other of [{ storage_path: null }, { status: "superseded" }, { status: "rejected" }, { library_template: "AB Capital/Proposal" },
    { library_template: "AB Capital/Accounting Quote" }, { library_template: "Ardentax/Letters/Master" }, { case_id: "c1" }, { department: "Ardentax Documents" },
    { doc_type: "mail" }, { doc_type: "library" }, { id: null }]) {
    assert.equal(deskSignState({ ...quote, ...other }, { canSign: true }).sign, false, JSON.stringify(other));
    assert.equal(deskSignable({ ...quote, ...other }), false, JSON.stringify(other));
  }
  const proposal = { id: "p1", doc_type: "quote", library_template: "AB Capital/Proposal" };
  assert.equal(deskSignable({ ...letter, parent_id: "p1" }, [proposal]), false, "a proposal's letter signs with its proposal");
  assert.equal(deskSignable(letter, [proposal]), true);
});

test("the signed copies and Unsigned copy show once signed, for everyone who sees the row; the plain file reads View before", () => {
  const s = deskSignState(quote, { canSign: false, signing: live });
  assert.deepEqual(s.copies, [{ label: "Signed copy (Word)", path: live.live.word_path }, { label: "Signed copy (PDF)", path: live.live.pdf_path }]);
  assert.equal(s.openLabel, "Unsigned copy");
  assert.equal(deskSignState(quote, { canSign: true }).openLabel, "View");
  assert.equal(deskSignState(quote, {}).showStatus, true);
  assert.equal(deskSignState({ ...quote, case_id: "c1" }, {}).showStatus, false, "a case document shows its signature in the case");
  assert.equal(deskSignState({ ...quote, case_id: "c1" }, { signing: live }).showStatus, true, "but a signed one still shows it here");
  assert.equal(deskSignState({ ...quote, status: "superseded" }, { signing: live }).showStatus, true, "an old signed version still shows its signature");
});

test("shared row rules: copies, state with any family rule, status line", () => {
  assert.deepEqual(signedCopies(null), []);
  assert.deepEqual(signedCopies({ pdf_path: "x.pdf" }), [{ label: "Signed copy (PDF)", path: "x.pdf" }]);
  assert.equal(hubSignState(quote, { canSign: true }).sign, false, "no family rule, no Sign");
  assert.equal(hubSignState(quote, { canSign: true }, "Open", () => true).sign, true);
  assert.deepEqual(hubSignStatus(live, (d) => `on:${d}`), { label: "Signed by Test Approver on on:2026-11-06", tone: "good" });
  assert.deepEqual(hubSignStatus({ live: null, last: { superseded_at: "x", superseded_reason: "Generated again" } }), { label: "Not signed (signature withdrawn: Generated again)", tone: "warn" });
  assert.deepEqual(hubSignStatus(null), { label: "Not signed", tone: "plain" });
  const older = { id: "o", source_id: "q1", signed_at: "2026-11-01", superseded_at: "2026-11-02", superseded_reason: "Document changed" };
  const now = { id: "n", source_id: "q1", signed_at: "2026-11-03", superseded_at: null, signer: { full_name: "Test Approver" } };
  const by = signingById(["q1", "l1"], [older, now]);
  assert.equal(by.q1.live.id, "n");
  assert.equal(by.q1.live.signer_name, "Test Approver");
  assert.deepEqual(by.l1, { live: null, last: null });
});

// ── signing ───────────────────────────────────────────────────────────
function api(over = {}) {
  const calls = [];
  return {
    calls,
    loadSettings: async () => { calls.push("settings"); return settings; },
    loadCatalogue: async () => { calls.push("catalogue"); return catalogue; },
    render,
    sign: async (args) => { calls.push(["sign", args.table, args.doc.id, args.seen]); const wordBlob = await args.rebuild(args.doc, sig); return { signature: { id: "s1" }, wordBlob }; },
    ...over,
  };
}

test("signing sends the row's own change stamp and draws the row with the signature", async () => {
  const a = api();
  const changed = { ...quote, content_changed_at: "2026-11-06T01:02:03.456789+00:00" };
  const r = await signDeskDocument(changed, a);
  assert.equal(r.error, undefined);
  assert.deepEqual(a.calls, ["settings", ["sign", "hub_documents", "q1", "2026-11-06T01:02:03.456789+00:00"]]);
  assert.equal(xmlOf(r.wordBlob).replace(signatureXml(sig), UNSIGNED_SPACE), xmlOf(await deskDocumentBlob(changed, null, { render, settings, catalogue })));
  const b = api();
  const l = await signDeskDocument(letter, b);
  assert.deepEqual(b.calls.slice(0, 2).sort(), ["catalogue", "settings"]);
  assert.equal(b.calls[2][3], letter.created_at, "an unchanged document's stamp is its created_at");
  assert.ok(xmlOf(l.wordBlob).includes("Books rules apply."));
});

test("signing refuses a row that cannot be signed here, and returns refusals and failures as { error }", async () => {
  const a = api();
  assert.match((await signDeskDocument({ ...quote, storage_path: null }, a)).error, /cannot be signed here/);
  assert.match((await signDeskDocument({ ...quote, case_id: "c1" }, a)).error, /cannot be signed here/);
  assert.match((await signDeskDocument({ ...letter, parent_id: "p1" }, a, [{ id: "p1", library_template: "AB Capital/Proposal" }])).error, /cannot be signed here/);
  assert.match((await signDeskDocument({ ...quote, created_at: null }, a)).error, /not found/);
  assert.deepEqual(a.calls, []);
  assert.equal((await signDeskDocument(quote, api({ sign: async () => ({ error: "You are not an approver of ab_capital" }) }))).error, "You are not an approver of ab_capital");
  assert.equal((await signDeskDocument(quote, api({ sign: async () => { throw new Error("The document changed. Open it again and sign."); } }))).error, "The document changed. Open it again and sign.");
  assert.equal((await signDeskDocument(quote, api({ loadSettings: async () => { throw new Error("offline"); } }))).error, "offline");
  assert.equal((await signDeskDocument(quote, api({ sign: async () => null }))).error, "Signing failed");
});

// ── a new file ends the signature ─────────────────────────────────────
test("Generate and Create file save first, then withdraw the live signature as Generated again; a failed withdrawal only warns", async () => {
  const calls = [];
  const out = await fileAndWithdraw(quote, async () => { calls.push("save"); return { path: "p" }; }, async (t, id, reason) => { calls.push([t, id, reason]); return false; });
  assert.deepEqual(calls, ["save", ["hub_documents", "q1", "Generated again"]]);
  assert.deepEqual(out, { saved: { path: "p" }, warning: null });
  const warned = await fileAndWithdraw(quote, async () => ({ path: "p" }), async () => { throw new Error("offline"); });
  assert.deepEqual(warned.saved, { path: "p" });
  assert.match(warned.warning, /Saved, but the earlier signature could not be withdrawn: offline/);
  let withdrew = false;
  await assert.rejects(fileAndWithdraw(quote, async () => { throw new Error("upload failed"); }, async () => { withdrew = true; }), /upload failed/);
  assert.equal(withdrew, false);
});

test("the Service Desk files every document through deskDocumentBlob and fileAndWithdraw, and shows Sign through deskSignState", () => {
  const src = readFileSync(fileURLToPath(new URL("../components/ServiceDesk.jsx", import.meta.url)), "utf8");
  assert.ok(src.includes("deskDocumentBlob({ ...doc, doc_type: type }, null,"));
  assert.ok(src.includes("fileAndWithdraw(doc, () => saveFile("));
  assert.ok(src.includes("supersedeSignature"));
  assert.ok(src.includes('canSignSafe("ab_capital")'));
  assert.ok(!/renderTemplate\("Service_/.test(src), "no second render path");
});
