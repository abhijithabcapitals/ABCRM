// node --test "Template Module/tests/accountingDocx.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { quoteContext } from "../logic/accountingQuote.js";
import { agreementContext } from "../logic/accountingAgreement.js";
import { renderAccountingDoc } from "../logic/accountingDocx.js";

const require = createRequire(new URL("../../Main Module/package.json", import.meta.url));
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const JSZip = require("jszip");
const deps = { PizZip, Docxtemplater };

const QUOTE_T = readFileSync(new URL("../templates/AB_Capital_Accounting_Quote_Template.docx", import.meta.url));
const AGR_T = readFileSync(new URL("../templates/AB_Capital_Accounting_Agreement_Template.docx", import.meta.url));

const settings = {
  company: { bank: { account_name: "Test Account Name", bank: "Test Bank", account_no: "TESTACC-1", iban: "TESTIBAN-1", swift: "TESTSWIFT", currency: "AED" } },
  accounting_proposal_defaults: { contact: { name: "Test Contact", phone: "TESTPHONE", email: "test@example.com", website: "example.test" }, standard: { billing: { monthly: ["Billed monthly in test."] } } },
};
const svc = (name, basis, amount, subs = []) => ({ name, basis, amount, subs });
const opt = (name, services) => ({ package_key: null, name, description: "", notes: [], services });
const quoteDoc = (options, shared = {}) => ({
  document_number: "ABC/TEST/ACQ1", created_at: "2030-01-15T08:00:00Z", client_name: "TEST CLIENT - DO NOT USE", contact_name: "Test Person",
  field_values: { quote: { accepted_option: null, options, shared: { scope: [], payment: [], notes: [], ...shared } } },
});
const agrDoc = (over = {}) => ({
  document_number: "ABC/TEST/ACE1", created_at: "2030-01-15T08:00:00Z", client_name: "TEST CLIENT - DO NOT USE",
  field_values: {
    agreement: {
      address: ["Test Line 1", "Test Line 2"], attention: "", signatory_name: "Test Signatory", signatory_title: "Test Title", notices_email: "client@example.com",
      scope_sentence: 'Based on the requirement discussed, we will be providing the services mentioned under "Schedule 1: Scope of Services" relating to Testing.',
      schedule1: [{ name: "Test Service", description: "Test description." }], scope_notes: ["Test scope note."],
      schedule2: [{ description: "Test Service", fee: "AED 100/- + VAT per month starting from the month of January 2030" }, { description: "Test Sub", fee: "AED 40/- + VAT per month", sub: true }],
      billing: "monthly", billing_notes: [], effective_months: 12, notice_days: 30, ...over,
    },
  },
});
const PNG = Buffer.from("89504e470d0a1a0a", "hex");
const sig = { bytes: new Uint8Array(PNG), type: "png", width: 300, height: 100 };

async function open(blob) {
  const z = await JSZip.loadAsync(await blob.arrayBuffer());
  return { z, xml: await z.file("word/document.xml").async("string") };
}
const text = (xml) => xml.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "");
const count = (s, sub) => s.split(sub).length - 1;

test("quote one and two options", async () => {
  const one = quoteDoc([opt("Only Plan", [svc("Test Service", "month", 1000, [{ name: "Sub A", amount: 400 }, { name: "Sub B", amount: 600 }]), svc("Setup", "once", 250), svc("Extra", "separate", null)])], { scope: ["Shared scope line"], payment: ["Shared payment line"], notes: ["Shared note line"] });
  const { xml: x1 } = await open(await renderAccountingDoc(QUOTE_T, quoteContext(one, settings), null, deps));
  assert.doesNotMatch(x1, /[{}]/);
  assert.doesNotMatch(text(x1), /Option 1/);
  assert.equal(count(x1, 'w:type="page"'), 0);
  assert.match(text(x1), /1,000/);
  assert.match(x1, /w:left="360"/, "sub rows are indented");
  assert.match(text(x1), /Will be charged separately/);
  assert.equal(count(text(x1), "Shared scope line"), 1);
  assert.doesNotMatch(text(x1), /TEST CLIENT|Test Person/);
  assert.equal(count(text(x1), "TESTIBAN-1"), 1);

  const two = quoteDoc([opt("Plan A", [svc("Test Service", "month", 1000)]), opt("Plan B", [svc("Test Service", "year", 9000)])], { scope: ["Shared scope line"], payment: ["Shared payment line"] });
  const { xml: x2 } = await open(await renderAccountingDoc(QUOTE_T, quoteContext(two, settings), null, deps));
  assert.doesNotMatch(x2, /[{}]/);
  assert.match(text(x2), /Option 1: Plan A/);
  assert.match(text(x2), /Option 2: Plan B/);
  assert.equal(count(x2, 'w:type="page"'), 1);
  assert.ok(x2.indexOf('w:type="page"') < x2.indexOf("Option 2"));
  assert.ok(x2.indexOf('w:type="page"') > x2.indexOf("Option 1"));
  assert.equal(count(text(x2), "Shared scope line"), 1);
  assert.equal(count(text(x2), "Shared payment line"), 1);
  assert.equal(count(text(x2), "TESTIBAN-1"), 1);
  assert.doesNotMatch(text(x2), /10,000/);
});

test("agreement unsigned: sendable, so no draft mark, an empty signatory line", async () => {
  const { z, xml } = await open(await renderAccountingDoc(AGR_T, agreementContext(agrDoc(), settings, false), null, deps));
  assert.doesNotMatch(xml, /[{}]/);
  assert.doesNotMatch(text(xml), /Draft, not approved/);
  assert.match(text(xml), /Authorized Signatory/);
  assert.match(text(xml), /_{10,}/);
  assert.doesNotMatch(xml, /<w:drawing/);
  assert.equal(Object.keys(z.files).filter((n) => n.startsWith("word/media/")).some((n) => /signature/i.test(n)), false);
  assert.match(text(xml), /Test Signatory/);
  assert.match(text(xml), /Data Entry: Accurate/);
  assert.doesNotMatch(text(xml), /:[A-Z]/);
});

test("agreement signed", async () => {
  const { z, xml } = await open(await renderAccountingDoc(AGR_T, agreementContext(agrDoc(), settings, true), sig, deps));
  assert.doesNotMatch(xml, /[{}]/);
  assert.doesNotMatch(text(xml), /Draft, not approved/);
  const media = Object.keys(z.files).filter((n) => /^word\/media\/signature/i.test(n));
  assert.equal(media.length, 1);
  const rels = await z.file("word/_rels/document.xml.rels").async("string");
  const id = rels.match(new RegExp(`Id="([^"]+)"[^>]*Target="media/${media[0].split("/").pop()}"`))?.[1] ?? rels.match(new RegExp(`Target="media/${media[0].split("/").pop()}"[^>]*Id="([^"]+)"`))?.[1];
  assert.ok(id, "relationship for the signature");
  assert.match(xml, new RegExp(`r:embed="${id}"`));
  const ext = xml.match(/<wp:extent cx="(\d+)" cy="(\d+)"/);
  assert.ok(Math.abs(Number(ext[1]) / Number(ext[2]) - 3) < 0.01, "aspect ratio kept");
  assert.equal(count(xml, "<w:drawing"), 1);
  assert.match(await z.file("[Content_Types].xml").async("string"), /Extension="png"/);
});

test("quote unsigned: an empty Authorized Signatory block, no picture", async () => {
  const doc = quoteDoc([opt("Only Plan", [svc("Test Service", "month", 1000)])]);
  const { z, xml } = await open(await renderAccountingDoc(QUOTE_T, { ...quoteContext(doc, settings), has_signature: false }, null, deps));
  assert.doesNotMatch(xml, /[{}]/);
  assert.match(text(xml), /For AB CAPITAL SERVICES \(FZE\)/);
  assert.match(text(xml), /Authorized Signatory/);
  assert.match(text(xml), /_{10,}/);
  assert.doesNotMatch(xml, /<w:drawing/);
  assert.equal(Object.keys(z.files).some((n) => /^word\/media\/signature/i.test(n)), false);
  assert.ok(text(xml).indexOf("Authorized Signatory") > text(xml).indexOf("Website:"), "the block comes after the contact details");
});

test("quote signed: the picture sits in the signatory block, the rest is as unsigned", async () => {
  const doc = quoteDoc([opt("Only Plan", [svc("Test Service", "month", 1000)])]);
  const plainX = (await open(await renderAccountingDoc(QUOTE_T, { ...quoteContext(doc, settings), has_signature: false }, null, deps))).xml;
  const { z, xml } = await open(await renderAccountingDoc(QUOTE_T, { ...quoteContext(doc, settings), has_signature: true }, sig, deps));
  assert.doesNotMatch(xml, /[{}]/);
  assert.equal(count(xml, "<w:drawing"), 1);
  assert.equal(Object.keys(z.files).filter((n) => /^word\/media\/signature/i.test(n)).length, 1);
  const words = (x) => text(x).replace(/\n+/g, "\n");
  assert.equal(words(xml), words(plainX), "same words; only the picture paragraph is added");
  assert.ok(xml.indexOf("<w:drawing") > xml.indexOf("For AB CAPITAL SERVICES (FZE)") && xml.indexOf("<w:drawing") < xml.indexOf("Authorized Signatory"));
});

test("signed but null image", async () => {
  await assert.rejects(renderAccountingDoc(AGR_T, agreementContext(agrDoc(), settings, true), null, deps), /Signature image is missing/);
});

test("escapes", async () => {
  const doc = { ...agrDoc({ address: ["L1", "L2", "L3", "L4", "L5", "L6 & <x>"] }), client_name: 'A & "B" <C/D>' };
  const { xml } = await open(await renderAccountingDoc(AGR_T, agreementContext(doc, settings, false), null, deps));
  assert.match(xml, /A &amp; "B" &lt;C\/D&gt;|A &amp; &quot;B&quot; &lt;C\/D&gt;/);
  assert.equal(count(text(xml), "L6 & <x>".replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")), 1);
  assert.equal(new DOMParserLike(xml).ok, true);
  const q = quoteDoc([opt('A & "B" <C/D>', [svc("S & T", "month", 5)])]);
  const { xml: qx } = await open(await renderAccountingDoc(QUOTE_T, quoteContext(q, settings), null, deps));
  assert.equal(new DOMParserLike(qx).ok, true);
});

// A small well-formedness check: tags balance and no bare & or < inside text.
class DOMParserLike {
  constructor(xml) {
    const body = xml.replace(/<\?xml[^>]*\?>/, "");
    const stack = [];
    let ok = !/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(body.replace(/<[^>]+>/g, ""));
    for (const m of body.matchAll(/<(\/?)([\w:.-]+)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g)) {
      if (m[4]) continue;
      if (m[1]) { if (stack.pop() !== m[2]) ok = false; } else stack.push(m[2]);
    }
    const leftover = body.replace(/<(\/?)([\w:.-]+)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g, "").replace(/<!--.*?-->/gs, "");
    this.ok = ok && stack.length === 0 && !leftover.includes("<");
  }
}

test("no secrets in templates", async () => {
  for (const buf of [QUOTE_T, AGR_T]) {
    const z = await JSZip.loadAsync(buf);
    for (const name of Object.keys(z.files).filter((n) => /^word\/[^/]+\.xml$/.test(n) && !/numbering|styles|theme|fontTable|settings|webSettings/.test(n))) {
      const x = await z.file(name).async("string");
      assert.doesNotMatch(x, /AE\d{10,}/, name);
      assert.doesNotMatch(x, /\b\d{10,}\b/, name);
      assert.doesNotMatch(x, /AED\s*\d/, name);
    }
    const headerRels = (await Promise.all(Object.keys(z.files).filter((n) => /^word\/_rels\/header\d*\.xml\.rels$/.test(n)).map((n) => z.file(n).async("string")))).join("");
    const media = Object.keys(z.files).filter((n) => n.startsWith("word/media/") && !z.files[n].dir);
    for (const m of media) {
      assert.ok(headerRels.includes(m.replace("word/", "")), `${m} is a header logo`);
      assert.ok((await z.file(m).async("uint8array")).length < 15 * 1024, `${m} under 15 KB`);
    }
  }
});

test("wording fixes", async () => {
  const z = await JSZip.loadAsync(AGR_T);
  const t = text(await z.file("word/document.xml").async("string")).replace(/\s+/g, " ");
  assert.match(t, /compliant/);
  assert.doesNotMatch(t, /complaint/i);
  assert.match(t, /Schedule 1: Scope of Services/);
  assert.match(t, /Schedule 2: Fees for Services/);
  assert.doesNotMatch(t, /Schedule\s+(I\b|II\b|–|-)/);
  assert.doesNotMatch(t, /the all accounting/i);
  assert.doesNotMatch(t, /Schedule\s*\d?\s*[-–—]\s*[12]/);
});
