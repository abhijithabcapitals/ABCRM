// AB Capital signing on Business Setup case quotes and letters (logic/caseSigning.js), with the built-in Service templates.
// The client is the test client; the signature is a few made-up bytes, never a real image.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  LETTER_TEMPLATE, QUOTE_TEMPLATE, caseDocumentBlob, caseSignState, caseSignStatus, caseSignable, fileAndWithdraw, letterLimitations,
  rebuildCaseDocument, signCaseDocument,
} from "../logic/caseSigning.js";
import { REL_ID, UNSIGNED_SPACE, renderSigned, signatureXml } from "../../Template Module/logic/signDocx.js";

const require = createRequire(new URL("../../Main Module/package.json", import.meta.url));
const libs = { PizZip: require("pizzip"), Docxtemplater: require("docxtemplater") };
const template = (file) => readFileSync(fileURLToPath(new URL(`../../Template Module/templates/${file}`, import.meta.url)));
// renderTemplate without the network: the built-in template, through the same renderSigned.
const render = async (file, data, { signature = null } = {}) => renderSigned(libs, template(file), data, signature, file).generate({ type: "uint8array" });
const xmlOf = (bytes, part = "word/document.xml") => new libs.PizZip(bytes).file(part)?.asText();

const sig = { bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]), type: "png", width: 400, height: 200 };
const settings = { company: { name: "AB Capital Services FZE", short_name: "AB Capital", bank: { account_name: "Acct" } }, engagement_terms: { payment_terms: ["Pay first. {{vat_statement}}"], limitations: "General" } };
const catalogue = [{ limitation: "Zone rules apply.", service_items: [{ name: "Formation" }] }, { limitation: "Other.", service_items: [{ name: "Audit" }] }];
const base = {
  department: "Business Setup", client_name: "TEST CLIENT - DO NOT USE", contact_name: "Test Contact", created_at: "2026-11-05T08:00:00.123456+00:00",
  vat_mode: "exclusive", vat_rate: 5, vat_amount: 50, total_amount: 1050, services: ["Formation"],
  lines: [{ description: "Formation", service_name: "Formation", amount: 1000, vat_rate: 5 }], storage_path: "Business Setup/q1/a.docx", status: "issued",
};
const quote = { ...base, id: "q1", doc_type: "quote", document_number: "TEST/Q/1", case_id: "c1", valid_until: "2026-12-05" };
const letter = { ...base, id: "l1", doc_type: "letter", document_number: "TEST/L/1", case_id: "c1", parent_id: "q1", storage_path: "Business Setup/l1/a.docx" };

// ── template ──────────────────────────────────────────────────────────
test("both Service templates have one AB Capital signatory place, alone in its paragraph", () => {
  for (const file of [QUOTE_TEMPLATE, LETTER_TEMPLATE]) {
    const xml = new libs.PizZip(template(file)).file("word/document.xml").asText();
    assert.equal(xml.split("{@signature_xml}").length - 1, 1, file);
    assert.ok(xml.includes("<w:p><w:r><w:t>{@signature_xml}</w:t></w:r></w:p>"), file);
    assert.ok(xml.includes("For AB CAPITAL SERVICES (FZE)"), file);
  }
  assert.ok(new libs.PizZip(template(QUOTE_TEMPLATE)).file("word/document.xml").asText().includes("Authorized Signatory"));
});

test("unsigned: blank lines in the signatory place, no picture; signed: the picture, its relationship and content type", async () => {
  for (const doc of [quote, letter]) {
    const plain = await caseDocumentBlob(doc, null, { render, settings, catalogue });
    const xml = xmlOf(plain);
    assert.ok(xml.includes(UNSIGNED_SPACE), doc.doc_type);
    assert.ok(!xml.includes(REL_ID), doc.doc_type);
    assert.ok(!/\{[a-z_#/@]+\}/.test(xml.replace(/<[^>]+>/g, "")), "no tag left");
    const signed = await rebuildCaseDocument(doc, sig, { render, settings, catalogue });
    assert.ok(xmlOf(signed).includes(`r:embed="${REL_ID}"`), doc.doc_type);
    assert.ok(xmlOf(signed, "word/_rels/document.xml.rels").includes(`Id="${REL_ID}"`));
    assert.ok(/Extension="png"/i.test(xmlOf(signed, "[Content_Types].xml")));
    assert.ok(new libs.PizZip(signed).file("word/media/signature.png"));
  }
});

test("rebuild matches the normal render (stored number, date, lines and totals) except the signature", async () => {
  for (const doc of [quote, letter]) {
    const plain = xmlOf(await caseDocumentBlob(doc, null, { render, settings, catalogue }));
    const signed = xmlOf(await rebuildCaseDocument(doc, sig, { render, settings, catalogue }));
    assert.notEqual(signed, plain);
    assert.equal(signed.replace(signatureXml(sig), UNSIGNED_SPACE), plain, doc.doc_type);
    const text = signed.replace(/<[^>]+>/g, "");
    for (const want of [doc.document_number, "05/11/2026", "TEST CLIENT - DO NOT USE", "1,050"]) assert.ok(text.includes(want), `${doc.doc_type}: ${want}`);
  }
  assert.ok(xmlOf(await rebuildCaseDocument(letter, sig, { render, settings, catalogue })).includes("Zone rules apply."));
});

test("rebuild needs the image, and a master template without the signatory place renders unsigned but is refused for signing", async () => {
  await assert.rejects(rebuildCaseDocument(quote, null, { render, settings }), /signature image is needed/);
  const strip = (file) => { const z = new libs.PizZip(template(file)); z.file("word/document.xml", z.file("word/document.xml").asText().replace("<w:p><w:r><w:t>{@signature_xml}</w:t></w:r></w:p>", "")); return z.generate({ type: "uint8array" }); };
  const old = async (file, data, { signature = null } = {}) => renderSigned(libs, strip(file), data, signature, file).generate({ type: "uint8array" });
  assert.ok(xmlOf(await caseDocumentBlob(quote, null, { render: old, settings })).includes("TEST/Q/1"));
  await assert.rejects(rebuildCaseDocument(quote, sig, { render: old, settings }), /has no place for the signature/);
});

test("a letter prints the limitations of its services' categories only", () => {
  assert.deepEqual(letterLimitations(letter, catalogue), ["Zone rules apply."]);
  assert.deepEqual(letterLimitations({ lines: [] }, catalogue), []);
});

// ── who sees what ─────────────────────────────────────────────────────
const live = { live: { id: "s1", signer_name: "Test Approver", signed_at: "2026-11-06", word_path: "Business Setup/q1/signed/x.docx", pdf_path: "Business Setup/q1/signed/x.pdf" }, last: null };
live.last = live.live;

test("Sign shows only for AB Capital approvers, on a filed, current case quote or letter without a live signature", () => {
  assert.equal(caseSignState(quote, { canSign: true }).sign, true);
  assert.equal(caseSignState(letter, { canSign: true }).sign, true);
  assert.equal(caseSignState(quote, { canSign: false }).sign, false);
  assert.equal(caseSignState(quote, {}).sign, false);
  assert.equal(caseSignState(quote, { canSign: "true" }).sign, false);
  assert.equal(caseSignState(quote, { canSign: true, signing: live }).sign, false);
  for (const other of [{ storage_path: null }, { status: "superseded" }, { status: "rejected" }, { library_template: "AB Capital/Proposal" }, { library_template: "AB Capital/Work types/IFZA" },
    { department: "Accounting" }, { doc_type: "mail" }, { id: null }]) {
    assert.equal(caseSignState({ ...quote, ...other }, { canSign: true }).sign, false, JSON.stringify(other));
    assert.equal(caseSignable({ ...quote, ...other }), false, JSON.stringify(other));
  }
  assert.equal(caseSignState({ ...quote, status: "accepted" }, { canSign: true }).sign, true);
});

test("the signed copies and Unsigned copy show once signed, for everyone who sees the row", () => {
  const s = caseSignState(quote, { canSign: false, signing: live }, "Open quote");
  assert.deepEqual(s.copies.map((c) => c.label), ["Signed copy (Word)", "Signed copy (PDF)"]);
  assert.equal(s.openLabel, "Unsigned copy");
  assert.equal(caseSignState(quote, { canSign: true }, "Open quote").openLabel, "Open quote");
  assert.deepEqual(caseSignState(quote, { canSign: true }).copies, []);
  assert.equal(caseSignState(quote, {}).showStatus, true);
  assert.equal(caseSignState({ ...quote, library_template: "AB Capital/Proposal" }, {}).showStatus, false);
  assert.equal(caseSignState({ ...quote, status: "superseded" }, { signing: live }).showStatus, true, "an old signed version still shows its signature");
});

test("the status line: signed by whom and when, withdrawn with its reason, or not signed", () => {
  assert.deepEqual(caseSignStatus(live, (d) => `on:${d}`), { label: "Signed by Test Approver on on:2026-11-06", tone: "good" });
  assert.deepEqual(caseSignStatus({ live: null, last: { superseded_at: "x", superseded_reason: "Generated again" } }), { label: "Not signed (signature withdrawn: Generated again)", tone: "warn" });
  assert.deepEqual(caseSignStatus(null), { label: "Not signed", tone: "plain" });
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
  const r = await signCaseDocument(changed, a);
  assert.equal(r.error, undefined);
  assert.deepEqual(a.calls, ["settings", ["sign", "hub_documents", "q1", "2026-11-06T01:02:03.456789+00:00"]]);
  assert.ok(xmlOf(r.wordBlob).includes(`r:embed="${REL_ID}"`));
  const b = api();
  await signCaseDocument(letter, b);
  assert.deepEqual(b.calls.slice(0, 2).sort(), ["catalogue", "settings"]);
  assert.equal(b.calls[2][3], letter.created_at, "an unchanged document's stamp is its created_at");
});

test("signing refuses a document that cannot be signed here, and returns refusals and failures as { error }", async () => {
  const a = api();
  assert.match((await signCaseDocument({ ...quote, storage_path: null }, a)).error, /cannot be signed here/);
  assert.match((await signCaseDocument({ ...quote, library_template: "AB Capital/Proposal" }, a)).error, /cannot be signed here/);
  assert.deepEqual(a.calls, []);
  assert.equal((await signCaseDocument(quote, api({ sign: async () => ({ error: "You are not an approver of ab_capital" }) }))).error, "You are not an approver of ab_capital");
  assert.equal((await signCaseDocument(quote, api({ sign: async () => { throw new Error("The document changed. Open it again and sign."); } }))).error, "The document changed. Open it again and sign.");
  assert.equal((await signCaseDocument(quote, api({ loadSettings: async () => { throw new Error("offline"); } }))).error, "offline");
  assert.equal((await signCaseDocument(quote, api({ sign: async () => null }))).error, "Signing failed");
});

// ── a new file ends the signature ─────────────────────────────────────
test("Create file saves first, then withdraws the live signature as Generated again", async () => {
  const calls = [];
  const out = await fileAndWithdraw(quote, async () => { calls.push("save"); return { path: "p" }; }, async (t, id, reason) => { calls.push([t, id, reason]); return true; });
  assert.deepEqual(calls, ["save", ["hub_documents", "q1", "Generated again"]]);
  assert.deepEqual(out, { saved: { path: "p" }, warning: null });
});

test("a failed withdrawal never blocks the save; a failed save withdraws nothing", async () => {
  const out = await fileAndWithdraw(quote, async () => ({ path: "p" }), async () => { throw new Error("offline"); });
  assert.deepEqual(out.saved, { path: "p" });
  assert.match(out.warning, /Saved, but the earlier signature could not be withdrawn: offline/);
  let withdrew = false;
  await assert.rejects(fileAndWithdraw(quote, async () => { throw new Error("upload failed"); }, async () => { withdrew = true; }), /upload failed/);
  assert.equal(withdrew, false);
});
