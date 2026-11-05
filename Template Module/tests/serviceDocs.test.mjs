// node --test "Template Module/tests/"
import test from "node:test";
import { needsPcCopy } from "../logic/helpers.js";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEPARTMENTS, NUMBERING_DEPARTMENTS, addLine, checkReady, feeItemFor, deskTotals, deskVatMode, fileNameFor, fixedVat, folderKind, letterData, listWords, mailDraft, quoteData, serviceTotals } from "../logic/serviceDocs.js";

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

test("ArdentTax shows on the numbering page, not among the Service Desk departments", () => {
  assert.ok(NUMBERING_DEPARTMENTS.includes("ArdentTax (ASP)"));
  assert.ok(!DEPARTMENTS.includes("ArdentTax (ASP)"));
  for (const d of DEPARTMENTS) assert.ok(NUMBERING_DEPARTMENTS.includes(d));
});

test("ArdentTax files stay in the CRM, so they never wait for a PC copy", () => {
  assert.equal(needsPcCopy({ storage_path: "a", local_path: null, source: "ardentax" }), false);
  assert.equal(needsPcCopy({ storage_path: "a", local_path: null, source: "hub" }), true);
});

test("Business Setup on the desk has no VAT choice and exclusive totals; other departments keep theirs", () => {
  assert.equal(fixedVat("Business Setup"), true); assert.equal(fixedVat("Accounting"), false);
  assert.equal(deskVatMode("Business Setup", "inclusive"), "exclusive"); assert.equal(deskVatMode("Accounting", "inclusive"), "inclusive"); assert.equal(deskVatMode("Tax Compliance", "none"), "none");
  const totals = deskTotals("Business Setup", [{ amount: 0.1 }, { amount: 0.1 }], "inclusive");
  assert.deepEqual(totals, { net: 0.2, vat: 0.02, total: 0.22 });   // per line, as the server rounds
  // A 0% fee item keeps its rate on the desk line, so the totals match the stored ones.
  const zero = addLine([], "Govt", "100", { id: "f0", vat_rate: 0 }).lines;
  assert.deepEqual(zero, [{ description: "Govt", amount: 100, fee_item_id: "f0", vat_rate: 0 }]);
  assert.deepEqual(deskTotals("Business Setup", zero, "inclusive"), { net: 100, vat: 0, total: 100 });
  assert.deepEqual(deskTotals("Business Setup", addLine(zero, "Svc", "100", { id: "f5", vat_rate: 5 }).lines, "inclusive"), { net: 200, vat: 5, total: 205 });
  assert.deepEqual(addLine([], "S", "10").lines, [{ description: "S", amount: 10 }]);
  assert.deepEqual(deskTotals("Accounting", [{ amount: 105 }], "inclusive"), serviceTotals([{ amount: 105 }], "inclusive", 5));
  const desk = readFileSync(fileURLToPath(new URL("../components/ServiceDesk.jsx", import.meta.url)), "utf8");
  assert.match(desk, /!fixedVat\(dept\) && <div className="bk-field"><label htmlFor="d-vat">/);
  assert.match(desk, /withLineVat\(doc, /); assert.match(desk, /vat_mode: deskVatMode\(dept, form\.vat_mode\)/);
});

test("the letter's scope prints each Business Setup line's scope, falling back to its name; other departments are unchanged", () => {
  const doc = { client_name: "X", department: "Business Setup", services: ["Visa", "Licence"], lines: [{ description: "Visa", amount: 1, scope: "Two investor visas" }, { description: "Licence", amount: 1, scope: "" }] };
  assert.deepEqual(letterData(doc, {}, {}).scope, [{ text: "Two investor visas" }, { text: "Licence" }]);
  const other = { ...doc, department: "Accounting" };
  assert.deepEqual(letterData(other, {}, {}).scope, [{ text: "Visa" }, { text: "Licence" }]);
});

test("the Word quote prints a line's scope beside it only when given", () => {
  const base = { ...quoteData({ client_name: "X", document_number: "N", services: ["Visa"], lines: [], vat_mode: "exclusive", total_amount: 105, vat_amount: 5 }, {}) };
  const withScope = render("Service_Quotation_Template.docx", { ...base, lines: [{ no: 1, description: "Visa", amount: "100", scope_note: "Two investor visas" }] });
  assert.match(withScope, /Visa/); assert.match(withScope, /Two investor visas/);
  const none = render("Service_Quotation_Template.docx", { ...base, lines: [{ no: 1, description: "Visa", amount: "100" }] });
  assert.match(none, /Visa/); assert.doesNotMatch(none, /Visa\s*:/);
});

test("feeItemFor: no link, one match, two matches", () => {
  const fees = [{ id: "a", service_item_id: "s1", vat_rate: 0 }, { id: "b", service_item_id: "s2", vat_rate: 5 }, { id: "c", service_item_id: "s2", vat_rate: 0 }, { id: "d", service_item_id: null, vat_rate: 5 }];
  assert.deepEqual(feeItemFor(fees, "s9"), { item: null });
  assert.deepEqual(feeItemFor(fees, null), { item: null });
  assert.equal(feeItemFor(fees, "s1").item.id, "a");
  assert.match(feeItemFor(fees, "s2").error, /More than one/);
  assert.deepEqual(feeItemFor(undefined, "s1"), { item: null });
});
test("the desk reports a failed fee list and disables Add until fees load", () => {
  const desk = readFileSync(fileURLToPath(new URL("../components/ServiceDesk.jsx", import.meta.url)), "utf8");
  assert.doesNotMatch(desk, /listFees\(\)\.catch/); assert.match(desk, /fee list could not be loaded/); assert.match(desk, /disabled=\{dept === "Business Setup" && !fees\.data\}/);
});
