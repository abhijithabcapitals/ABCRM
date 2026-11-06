// node --test "Banking Module/tests/signing.test.mjs"
// Business Banking on the shared signing (Template Hub 011): the Authorized Signatory place in the three templates, the rebuild of a
// stored quotation, letter or receipt with the AB Capital signature, the signing and filing steps, and what the screens show.
// People, clients and numbers are invented.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { REL_ID } from "../../Template Module/logic/signDocx.js";
import { letterDocx, quoteDocx, quoteMerge, rebuildBankingLetter, rebuildBankingQuote, rebuildBankingReceipt, receiptDocx, UNSIGNED_SPACE } from "../logic/documents.js";
import { SIGN_TABLES, fileGenerated, signBanking, signDoc } from "../services/bankingSigning.js";
import { bankingSignState, bankingSignStatus } from "../logic/signingUi.js";

const require = createRequire(new URL("../../Main Module/package.json", import.meta.url));
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const here = fileURLToPath(new URL("..", import.meta.url));
const FILES = ["Quotation_Template.docx", "Engagement_Letter_Template.docx", "Fee_Receipt_Voucher_Template.docx"];
const templateBuffer = async (file) => readFileSync(join(here, "templates", file));
const deps = { PizZip, Docxtemplater, templateBuffer };
const IMG = { bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3]), type: "png", width: 400, height: 200 };

const company = { name: "SAMPLE CO", short_name: "Sample Co FZE", website: "w", email: "e", mobile: "m", bank: { account_name: "A", bank: "B", account_no: "1", iban: "I", swift: "S", currency: "AED" } };
const client = { display_name: "Client LLC", registered_address: "Road 9, Dubai" };
const kase = { id: "c1", case_ref: "BC-1" };
const quote = { id: "q1", case_id: "c1", quotation_number: "BQ-1", version: 2, status: "Issued", quotation_date: "2026-01-15", valid_until: "2026-02-15", vat_mode: "inclusive", vat_rate: 5, vat_amount: 95.24, discount_total: 0, total_amount: 2000,
  banking_partners: { bank_name: "Sample Bank" }, banking_quotation_items: [{ item_type: "Service Fee", description: "Svc", amount: 2000, sort_order: 1 }] };
const letter = { id: "l1", case_id: "c1", letter_number: "EL-1", version: 1, letter_date: "2026-01-20", content: { client: "Client LLC", case_ref: "BC-1", bank: "Sample Bank", total: 2000, vat_mode: "none", vat_rate: 0, quotation_number: "BQ-1", quotation_version: 2, company,
  items: [{ type: "Service Fee", description: "Business Bank Account", amount: 2000, collected: true }], terms: { understanding: "Open with {{bank}}.", scope_title: "Best Effort", scope: ["Process"], fee_intro: "Fees", payment_terms: ["Pay"], ab_responsibilities: ["Prepare"], client_responsibilities: ["Provide"], limitations: "None", reps: "Reps" } } };
const payment = { id: "p1", case_id: "c1", payment_date: "2026-01-25", amount: 500, payment_method: "Cash", payment_ref: "BP-1", banking_receipts: { id: "r1", receipt_number: "RC-000001" } };
const quoteCtx = { client, c: kase, company, preparedBy: "Sam Sample", deps };

const zipOf = async (blob) => new PizZip(new Uint8Array(await blob.arrayBuffer()));
const xmlOf = async (blob) => (await zipOf(blob)).file("word/document.xml").asText();
const textOf = (xml) => xml.replace(/<w:drawing>.*?<\/w:drawing>/gs, "").replace(/<[^>]+>/g, "");
const unsignedOf = (xml) => xml.replace(/<w:p><w:pPr><w:keepNext\/><w:spacing w:before="120" w:after="0"\/><\/w:pPr><w:r><w:drawing>.*?<\/w:drawing><\/w:r><\/w:p>/s, UNSIGNED_SPACE);

// ── templates ────────────────────────────────────────────────────────
test("each template has the Authorized Signatory place: {@signature_xml} alone in its paragraph", () => {
  for (const f of FILES) {
    const xml = new PizZip(readFileSync(join(here, "templates", f))).file("word/document.xml").asText();
    const paras = xml.match(/<w:p[ >](?:(?!<w:p[ >]).)*?<\/w:p>/gs) || [];
    const holding = paras.filter((p) => p.includes("{@signature_xml}"));
    assert.equal(holding.length, 1, `${f}: one signature place`);
    assert.equal(holding[0].replace(/<[^>]+>/g, ""), "{@signature_xml}", `${f}: the tag is alone in its paragraph`);
    assert.ok(/Authorized Signatory/.test(xml.replace(/<[^>]+>/g, "")), `${f}: an Authorized Signatory line`);
  }
});

test("unsigned: a blank signing space, no picture, no tag left", async () => {
  const docs = [(await quoteDocx(quoteMerge(quote, client, kase, company, "Sam Sample"), null, deps)).blob, (await letterDocx(letter, null, deps)).blob,
    (await receiptDocx(payment, client, kase, company, null, deps)).blob];
  for (const blob of docs) {
    const zip = await zipOf(blob);
    const xml = zip.file("word/document.xml").asText();
    assert.ok(xml.includes(UNSIGNED_SPACE), "blank space for a hand signature");
    assert.ok(!xml.includes(REL_ID) && !zip.file("word/media/signature.png"), "no signature picture");
    assert.ok(!/\{[@#/]?\w+\}/.test(textOf(xml)), "no tag left");
  }
});

test("signed: the picture in the signatory place; everything else as the unsigned render", async () => {
  const pairs = [
    [await rebuildBankingQuote(quote, null, quoteCtx), await rebuildBankingQuote(quote, IMG, quoteCtx)],
    [await rebuildBankingLetter(letter, null, { deps }), await rebuildBankingLetter(letter, IMG, { deps })],
    [await rebuildBankingReceipt(payment, null, { client, c: kase, company, deps }), await rebuildBankingReceipt(payment, IMG, { client, c: kase, company, deps })],
  ];
  for (const [plain, signed] of pairs) {
    const zip = await zipOf(signed);
    const xml = zip.file("word/document.xml").asText();
    assert.ok(xml.includes(`r:embed="${REL_ID}"`), "the picture is placed");
    assert.ok(zip.file("word/media/signature.png"), "the image file is in the Word file");
    assert.ok(zip.file("word/_rels/document.xml.rels").asText().includes(REL_ID), "with its relationship");
    assert.ok(!xml.includes(UNSIGNED_SPACE), "the blank space gives way to the picture");
    assert.equal(unsignedOf(xml), await xmlOf(plain), "only the signature differs");
  }
});

test("the rebuild prints the stored number, version and date, never today", async () => {
  const q = textOf(await xmlOf(await rebuildBankingQuote(quote, IMG, quoteCtx)));
  assert.ok(q.includes("BQ-1 v2") && q.includes("15/01/2026") && q.includes("Sam Sample"), "quote");
  const l = textOf(await xmlOf(await rebuildBankingLetter({ ...letter, version: 3 }, IMG, { deps })));
  assert.ok(l.includes("EL-1") && l.includes("20/01/2026"), "letter");
  const r = textOf(await xmlOf(await rebuildBankingReceipt(payment, IMG, { client, c: kase, company, deps })));
  assert.ok(r.includes("RC-000001") && r.includes("25/01/2026"), "receipt");
  const today = new Date().toLocaleDateString("en-GB");
  for (const t of [q, l, r]) assert.ok(!t.includes(today), "not today's date");
});

test("a master template with no signature place is refused for signing, and still renders unsigned", async () => {
  const old = new PizZip(readFileSync(join(here, "templates", "Quotation_Template.docx")));
  old.file("word/document.xml", old.file("word/document.xml").asText().replace("{@signature_xml}", ""));
  const bytes = old.generate({ type: "uint8array" });
  const d = { ...deps, templateBuffer: async () => bytes };
  await assert.rejects(rebuildBankingQuote(quote, IMG, { ...quoteCtx, deps: d }), /no place for the signature/);
  assert.ok((await rebuildBankingQuote(quote, null, { ...quoteCtx, deps: d })) instanceof Blob);
});

test("a broken signature image is refused", async () => {
  await assert.rejects(rebuildBankingLetter(letter, { ...IMG, bytes: new Uint8Array() }, { deps }), /Signature image is missing/);
  await assert.rejects(rebuildBankingLetter(letter, { ...IMG, type: "gif" }, { deps }), /png or jpg/);
});

// ── signing and filing ───────────────────────────────────────────────
function fakeApi(over = {}) {
  const calls = [];
  const api = {
    changedAt: async (table, id) => { calls.push(["changedAt", table, id]); return "2026-01-01T00:00:00.123Z"; },
    sign: async (args) => { calls.push(["sign", args.table, args.doc, args.seen]); return { signature: { id: "s1" }, wordBlob: await args.rebuild(args.doc, IMG), pdfBlob: new Blob(["pdf"]) }; },
    supersede: async (table, id, reason) => { calls.push(["supersede", table, id, reason]); return true; },
    ...over,
  };
  return { api, calls };
}

test("each kind signs against its own table, as 011 names them", () => {
  assert.deepEqual(SIGN_TABLES, { quote: "banking_quotations", letter: "banking_engagement_letters", receipt: "banking_receipts" });
  assert.deepEqual(signDoc("quote", quote), { id: "q1", case_id: "c1" });
  assert.deepEqual(signDoc("letter", letter), { id: "l1", case_id: "c1" });
  // A receipt is signed as its banking_receipts row, in its payment's case.
  assert.deepEqual(signDoc("receipt", payment), { id: "r1", case_id: "c1" });
  assert.equal(signDoc("receipt", { ...payment, banking_receipts: null }), null);
});

test("signing reads the change stamp, then runs the shared step with the family's rebuild", async () => {
  const { api, calls } = fakeApi();
  const rebuild = (row, sig) => rebuildBankingReceipt(row, sig, { client, c: kase, company, deps });
  const r = await signBanking(api, { kind: "receipt", row: payment, rebuild });
  assert.equal(r.signature.id, "s1");
  assert.deepEqual(calls[0], ["changedAt", "banking_receipts", "r1"]);
  assert.deepEqual(calls[1], ["sign", "banking_receipts", { id: "r1", case_id: "c1" }, "2026-01-01T00:00:00.123Z"]);
  // The rebuild is given the payment row (what the receipt is drawn from), not the signing id.
  assert.ok(textOf(await xmlOf(r.wordBlob)).includes("RC-000001"));
});

test("signing refusals come back as an error and nothing else is called", async () => {
  const none = fakeApi({ changedAt: async () => null });
  assert.deepEqual(await signBanking(none.api, { kind: "quote", row: quote, rebuild: () => null }), { error: "The document was not found." });
  assert.equal(none.calls.length, 0);
  const refused = fakeApi({ sign: async () => ({ error: "You are not an approver of ab_capital" }) });
  assert.deepEqual(await signBanking(refused.api, { kind: "quote", row: quote, rebuild: () => null }), { error: "You are not an approver of ab_capital" });
  const thrown = fakeApi({ changedAt: async () => { throw new Error("offline"); } });
  assert.deepEqual(await signBanking(thrown.api, { kind: "letter", row: letter, rebuild: () => null }), { error: "offline" });
  assert.deepEqual(await signBanking(fakeApi().api, { kind: "receipt", row: { ...payment, banking_receipts: null }, rebuild: () => null }), { error: "This payment has no receipt voucher to sign." });
});

test("every regenerate ends the live signature of that document, after the file is saved", async () => {
  for (const [kind, row, table, id] of [["quote", quote, "banking_quotations", "q1"], ["letter", letter, "banking_engagement_letters", "l1"], ["receipt", payment, "banking_receipts", "r1"]]) {
    const { api, calls } = fakeApi();
    const order = [];
    const saved = await fileGenerated(api, kind, row, async () => { order.push("save"); return { id: "g1", local_path: null }; });
    assert.deepEqual(saved, { row: { id: "g1", local_path: null }, warning: null });
    assert.deepEqual(calls, [["supersede", table, id, "Generated again"]]);
    assert.deepEqual(order, ["save"]);
  }
});

test("a failed withdrawal does not undo the saved file; it is reported", async () => {
  const { api } = fakeApi({ supersede: async () => { throw new Error("offline"); } });
  const saved = await fileGenerated(api, "quote", quote, async () => ({ id: "g1" }));
  assert.equal(saved.row.id, "g1");
  assert.match(saved.warning, /signature could not be withdrawn: offline/);
  // A failed save stops before any withdrawal.
  const second = fakeApi();
  await assert.rejects(fileGenerated(second.api, "quote", quote, async () => { throw new Error("upload failed"); }), /upload failed/);
  assert.equal(second.calls.length, 0);
});

test("a voucher with no receipt row is saved without a withdrawal", async () => {
  const { api, calls } = fakeApi();
  const saved = await fileGenerated(api, "receipt", { ...payment, banking_receipts: null }, async () => ({ id: "g1" }));
  assert.equal(saved.row.id, "g1");
  assert.equal(calls.length, 0);
});

// ── what the screens show ────────────────────────────────────────────
const live = { id: "s1", signer_name: "Pat Approver", signed_at: "2026-01-02T08:00:00Z", word_path: "c1/generated/q1/signed/a.docx", pdf_path: "c1/generated/q1/signed/a.pdf" };

test("Sign shows only for an AB Capital approver who may file that document, on a document that can be filed, not yet signed", () => {
  const yes = { canSign: true, canFile: true, signing: { live: null, last: null } };
  assert.equal(bankingSignState("quote", quote, yes).sign, true);
  assert.equal(bankingSignState("quote", quote, { ...yes, canSign: false }).sign, false, "not an approver");
  assert.equal(bankingSignState("quote", quote, { ...yes, canFile: false }).sign, false, "cannot store files for quotes");
  assert.equal(bankingSignState("quote", quote, { ...yes, signing: { live } }).sign, false, "already signed");
  for (const status of ["Draft", "Approval Required", "Superseded"]) assert.equal(bankingSignState("quote", { ...quote, status }, yes).sign, false, status);
  assert.equal(bankingSignState("quote", { ...quote, is_imported: true }, yes).sign, false, "imported quotes are not drawn here");
  assert.equal(bankingSignState("letter", letter, yes).sign, true);
  assert.equal(bankingSignState("letter", { ...letter, status: "Cancelled" }, yes).sign, false, "cancelled letter");
  assert.equal(bankingSignState("receipt", payment, yes).sign, true);
  assert.equal(bankingSignState("receipt", { ...payment, banking_receipts: null }, yes).sign, false, "no receipt");
  assert.equal(bankingSignState("quote", quote, { ...yes, canSign: "yes" }).sign, false, "only a true answer counts");
});

test("the copies: Signed copy (Word and PDF) once signed; the plain Word is the Unsigned copy", () => {
  const signed = bankingSignState("quote", quote, { canSign: false, canFile: false, signing: { live } });
  assert.deepEqual(signed.copies, [{ label: "Signed copy (Word)", path: live.word_path }, { label: "Signed copy (PDF)", path: live.pdf_path }]);
  assert.equal(signed.unsignedLabel, "Unsigned copy");
  const plain = bankingSignState("quote", quote, { canSign: true, canFile: true, signing: null });
  assert.deepEqual(plain.copies, []);
  assert.equal(plain.unsignedLabel, "Word");
});

test("the status line", () => {
  const fmt = (d) => String(d).slice(0, 10);
  assert.deepEqual(bankingSignStatus({ live }, fmt), { label: "Signed by Pat Approver on 2026-01-02", tone: "good" });
  assert.deepEqual(bankingSignStatus({ live: { ...live, signer_name: "" } }, fmt), { label: "Signed by an approver on 2026-01-02", tone: "good" });
  assert.deepEqual(bankingSignStatus({ live: null, last: { superseded_at: "2026-01-03", superseded_reason: "Generated again" } }, fmt), { label: "Not signed (signature withdrawn: Generated again)", tone: "warn" });
  assert.deepEqual(bankingSignStatus(null, fmt), { label: "Not signed", tone: "plain" });
});
