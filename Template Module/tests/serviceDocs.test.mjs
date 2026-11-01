// node --test "Template Module/tests/"
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { addLine, checkReady, fileNameFor, folderKind, letterData, listWords, mailDraft, quoteData, serviceTotals } from "../logic/serviceDocs.js";

const require = createRequire(new URL("../../Main Module/package.json", import.meta.url));
const render = (file, data) => {
  const PizZip = require("pizzip");
  const Docxtemplater = require("docxtemplater");
  const doc = new Docxtemplater(new PizZip(readFileSync(fileURLToPath(new URL(`../templates/${file}`, import.meta.url)))), { paragraphLoop: true, linebreaks: true, nullGetter: () => "" });
  doc.render(data);
  return doc.getZip().file("word/document.xml").asText().replace(/<[^>]+>/g, " ");
};
const doc = { client_name: "Client LLC", contact_name: "Asha", contact_email: "a@b.c", contact_phone: "0501", client_address: "Dubai Road", license_number: "L77", vat_trn: "100", document_number: "ABC/2026/11/TCQ001", created_at: "2026-11-01T10:00:00Z", department: "Tax Compliance", services: ["VAT Registration", "VAT Return Filing"], lines: [{ description: "VAT Registration", amount: 1000 }, { description: "VAT Return Filing", amount: 500 }], total_amount: 1500, vat_mode: "inclusive", vat_rate: 5, vat_amount: 71.43, valid_until: "2026-11-16" };
const company = { name: "AB", short_name: "AB FZE", bank: { iban: "I" } };

test("totals match the database", () => {
  const l = [{ amount: 2000 }, { amount: 500 }];
  assert.deepEqual(serviceTotals(l, "inclusive"), { net: 2500, vat: 119.05, total: 2500 });
  assert.deepEqual(serviceTotals(l, "exclusive"), { net: 2500, vat: 125, total: 2625 });
  assert.deepEqual(serviceTotals(l, "none"), { net: 2500, vat: 0, total: 2500 });
});
test("files go to their department's folder", () => {
  assert.equal(folderKind("Tax Compliance", "quote"), "tax_quote");
  assert.equal(folderKind("Business Setup", "letter"), "setup_letter");
  assert.equal(folderKind("Business Banking", "quote"), "quote");
  assert.equal(fileNameFor("ABC/2026/11/TCQ001", "Client L.L.C"), "ABC-2026-11-TCQ001 Client LLC.docx");
});
test("quotation template renders every line", () => {
  const t = render("Service_Quotation_Template.docx", quoteData(doc, company));
  for (const s of ["Dubai Road", "L77", "0501", "a@b.c", "ABC/2026/11/TCQ001", "Client LLC", "VAT Return Filing", "1,500", "inclusive", "16/11/2026"]) assert.ok(t.includes(s), s);
  assert.ok(!/\{[#/]?\w+\}/.test(t));
});
test("letter carries services, terms and the category's limitation", () => {
  const t = render("Service_Engagement_Template.docx", letterData(doc, company, { fee_intro: "Fees", payment_terms: ["{{vat_statement}}"], ab_responsibilities: ["Do"], client_responsibilities: ["Give"], limitations: "General", reps: "FATF" }, ["Audit signed by licensed auditors."]));
  for (const s of ["VAT Registration and VAT Return Filing", "inclusive of applicable UAE VAT", "General Audit signed by licensed auditors.", "FATF", "Client Signature"]) assert.ok(t.includes(s), s);
  assert.ok(!/\{[#/]?\w+\}/.test(t));
});
test("mail drafts address the contact and fit the document", () => {
  const q = mailDraft({ type: "quote", client: "C", contact: "Asha", services: ["A", "B", "C"], number: "N1", total: 1500, validUntil: "2026-11-16", sender: "Me", company: "AB FZE" });
  assert.match(q.subject, /^Quotation N1: A and B and more$/);
  assert.match(q.body, /^Dear Asha,/);
  assert.match(q.body, /AED 1,500, valid until 16\/11\/2026/);
  const l = mailDraft({ type: "letter", client: "C", services: ["A"], number: "E1" });
  assert.match(l.subject, /^Engagement Letter E1: A$/);
  assert.match(l.body, /^Dear C,/);
  assert.match(l.body, /sign it/);
  assert.equal(listWords(["A", "B", "C"]), "A, B and C");
});

test("client details come before generating", () => {
  const full = { client: "C", contact: "A", email: "a@b.c", phone: "050", address: "Dubai" };
  const line = [{ description: "S", amount: 1 }];
  assert.match(checkReady({ ...full, phone: "", address: " " }, line), /client details first: phone, address/);
  assert.match(checkReady({ ...full, email: "nope" }, line), /valid email/);
  assert.match(checkReady(full, []), /at least one service/);
  assert.equal(checkReady(full, line), null);
});
test("services are added one by one with a fee", () => {
  assert.match(addLine([], "", "5").error, /Choose/);
  assert.match(addLine([], "S", "").error, /fee/);
  assert.match(addLine([], "S", "-1").error, /fee/);
  const a = addLine([], "S", "1000").lines;
  assert.deepEqual(a, [{ description: "S", amount: 1000 }]);
  assert.match(addLine(a, "S", "5").error, /already/);
  assert.equal(addLine(a, "T", "0").lines.length, 2);
});

test("master templates are compared by their tags, even when Word splits them", async () => {
  const { compareTags, tagsIn } = await import("../../Banking Module/logic/templateTags.js");
  assert.deepEqual(tagsIn("<w:t>{client</w:t><w:t>_name}</w:t> {#lines}{no}{/lines} {notes}"), ["client_name", "lines", "no", "notes"]);
  assert.deepEqual(compareTags("{a}{b}", "{a}{c}"), { missing: ["b"], unknown: ["c"] });
  assert.deepEqual(compareTags("{a}", "<x/>{a}"), { missing: [], unknown: [] });
});
