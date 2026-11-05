// node --test "Template Module/tests/libraryLetter.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { letterContext, letterFields, quoteToForm } from "../logic/libraryLetter.js";
import { generateLetter, retryLetter } from "../services/libraryGenerate.js";

const terms = { fee_intro: "Fees:", payment_terms: ["{{vat_statement}}", "Work starts on payment."], ab_responsibilities: ["Care."], client_responsibilities: ["Inform."], limitations: "Limits.", reps: "Reps" };
const settings = { company: { name: "AB Co" }, engagement_terms: terms };
const values = { client_name: "Sample Client", contact_name: "Sam", contact_email: "s@example.com", contact_phone: "050", license_number: "L-1", date: "2026-11-05", passport_number: "P123" };
const input = (over = {}) => ({ fields: letterFields(), values, rows: [{ label: "Formation", amount: "1,000" }], clientId: null, parentId: null, ...over });
const created = { id: "L1", doc_type: "letter", department: "Business Setup", document_number: "ABC/2026/11/BSE005", client_name: "Sample Client" };
function fakes(over = {}) {
  const calls = [];
  const note = (name, value) => (...args) => { calls.push({ name, args }); if (value instanceof Error) throw value; return value; };
  const deps = { loadSettings: note("loadSettings", settings), create: note("create", created), render: note("render", "BLOB"), save: note("save", {}) };
  for (const [k, v] of Object.entries(over)) deps[k] = note(k, v);
  return { calls, deps };
}
const names = (calls) => calls.map((c) => c.name);

test("letter fields include licence and TRN as optional, and require the contact details", () => {
  const f = Object.fromEntries(letterFields().map((x) => [x.name, x]));
  assert.equal(f.license_number.required, false);
  assert.equal(f.vat_trn.required, false);
  assert.equal(f.client_address.required, false);
  assert.equal(f.client_address.label, "Client address");
  for (const n of ["client_name", "contact_name", "contact_email", "contact_phone"]) assert.equal(f[n].required, true, n);
});

test("quote to form copies client, contact and fee rows, and not the date", () => {
  const form = quoteToForm({ id: "Q1", client_id: "CL1", client_name: "C", contact_name: "P", contact_email: "e@x.co", contact_phone: "1", license_number: "L", created_at: "2026-01-01", lines: [{ description: "Fee", amount: 10, remarks: "r" }] });
  assert.equal(form.parentId, "Q1");
  assert.equal(form.clientId, "CL1");
  assert.equal(form.values.license_number, "L");
  assert.equal(form.values.date, undefined);
  assert.deepEqual(form.rows, [{ label: "Fee", amount: 10, remarks: "r", rate: "" }]);
});

test("letter data has number, date, lines and total, and no sentence saying no VAT was charged", () => {
  const data = letterContext({ document_number: "R1", client_name: "C", services: ["Fee"], lines: [{ description: "Fee", amount: 1000 }], total_amount: 1000, vat_mode: "none", vat_rate: 0 }, settings.company, terms, "2026-11-05");
  assert.equal(data.document_number, "R1");
  assert.equal(data.document_date, "05/11/2026");
  assert.equal(data.lines[0].description, "Fee");
  assert.equal(data.scope[0].text, "Fee");
  assert.ok(data.total);
  assert.equal(data.payment_terms[0].text, "The fees are plus applicable taxes.");
  assert.equal(data.payment_terms[1].text, "Work starts on payment.");
  assert.ok(!JSON.stringify(data).includes("No VAT has been charged"));
});

test("missing field uses no number", async () => {
  const { calls, deps } = fakes();
  const out = await generateLetter(input({ values: { ...values, contact_email: "" } }), deps);
  assert.match(out.error, /Email/);
  assert.deepEqual(calls, []);
});

test("a name that differs from the linked client uses no number", async () => {
  const { calls, deps } = fakes();
  const out = await generateLetter(input({ linkedName: "Other" }), deps);
  assert.match(out.error, /linked to Other/);
  assert.deepEqual(calls, []);
});

test("render failure before create uses no number", async () => {
  const { calls, deps } = fakes({ render: new Error("bad") });
  const out = await generateLetter(input(), deps);
  assert.equal(out.error, "bad");
  assert.ok(!names(calls).includes("create"));
});

test("create gets the parent, client, typed values and lines, and nothing the form did not show", async () => {
  const { calls, deps } = fakes();
  const out = await generateLetter(input({ parentId: "Q1", clientId: "CL1" }), deps);
  assert.deepEqual(names(calls), ["loadSettings", "render", "create", "render", "save"]);
  assert.equal(out.file.name, "ABC-2026-11-BSE005 Sample Client.docx");
  const p = calls.find((c) => c.name === "create").args[0];
  assert.equal(p.parent_id, "Q1");
  assert.equal(p.client_id, "CL1");
  assert.equal(p.license_number, "L-1");
  assert.deepEqual(p.lines, [{ description: "Formation", amount: 1000, remarks: "", rate: "" }]);
  assert.equal(p.field_values.passport_number, undefined);
  assert.equal(calls.filter((c) => c.name === "render").at(-1).args[0].document_number, "ABC/2026/11/BSE005");
});

test("save failure keeps the Ref", async () => {
  const { deps } = fakes({ save: new Error("offline") });
  const out = await generateLetter(input(), deps);
  assert.equal(out.doc, created);
  assert.equal(out.error, "offline");
});

test("Retry on a letter makes no new row and uses stored values", async () => {
  const { calls, deps } = fakes();
  const doc = { ...created, services: ["Fee"], lines: [{ description: "Fee", amount: 5 }], total_amount: 5, vat_mode: "none", field_values: { date: "2026-02-03" } };
  const out = await retryLetter(doc, deps);
  assert.equal(out.error, undefined);
  assert.deepEqual(names(calls), ["loadSettings", "render", "save"]);
  assert.equal(calls[1].args[0].document_date, "03/02/2026");
});

test("the built-in engagement letter renders with this data and prints what was typed", async () => {
  const { createRequire } = await import("node:module");
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const require = createRequire(new URL("../../Main Module/package.json", import.meta.url));
  const PizZip = require("pizzip");
  const Docxtemplater = require("docxtemplater");
  const file = fileURLToPath(new URL("../templates/Service_Engagement_Template.docx", import.meta.url));
  const doc = new Docxtemplater(new PizZip(readFileSync(file)), { paragraphLoop: true, linebreaks: true, nullGetter: () => "" });
  doc.render(letterContext({ document_number: "ABC/2026/11/BSE005", client_name: "Sample Client", contact_name: "Sam", license_number: "L-1", services: ["Formation"], lines: [{ description: "Formation", amount: 1000 }], total_amount: 1000, vat_mode: "none", vat_rate: 0 }, settings.company, terms, "2026-11-05"));
  const text = doc.getZip().file("word/document.xml").asText().replace(/<[^>]+>/g, "");
  for (const want of ["ABC/2026/11/BSE005", "05/11/2026", "Sample Client", "Sam", "Formation", "plus applicable taxes"]) assert.ok(text.includes(want), want);
  assert.ok(!/\{[a-z_#/]+\}/.test(text), "no tag left");
});
