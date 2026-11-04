import test from "node:test";
import assert from "node:assert/strict";
import { quoteContext, DEFAULT_USD_RATE } from "../logic/quoteData.js";

const ifza = { key: "ifza" };
const mainland = { key: "mainland" };
const base = { created_at: "2026-10-19T08:00:00Z", client_name: "Acme", business_activity: "Trading" };
const q750 = { ...base, lines: [{ service_name: "VAT Registration", amount: 750, remarks: "One Time" }], total_amount: 750 };
const q1000 = { ...base, lines: [{ description: "Fee", amount: 400 }, { description: "Licence", amount: 600 }], total_amount: 1000 };
const qZero = { ...base, lines: [], total_amount: 0 };

test("USD uses one rate", () => assert.equal(quoteContext(q750, ifza, 3.6725).items[0].amount_usd, "204"));
test("total USD from rate", () => assert.equal(quoteContext(q1000, ifza, 3.6725).total_usd, "272"));
test("activity and name separate", () => {
  const c = quoteContext({ ...q750, business_activity: "Trading", client_name: "Acme" }, mainland, 3.6725);
  assert.equal(c.business_activity, "Trading");
  assert.equal(c.business_name, "Acme");
});
test("zero total renders", () => {
  const c = quoteContext(qZero, ifza, 3.6725);
  assert.equal(c.total, "0");
  assert.equal(c.total_usd, "0");
  assert.deepEqual(c.items, []);
});
test("thousands get commas", () => {
  const c = quoteContext({ ...base, lines: [{ service_name: "Licence", amount: 14900 }], total_amount: 14900 }, ifza, 3.6725);
  assert.equal(c.items[0].amount, "14,900");
  assert.equal(c.items[0].amount_usd, "4,057");
  assert.equal(c.total, "14,900");
});
test("items number from 1 and keep their label and remarks", () => {
  const c = quoteContext(q1000, ifza, 3.6725);
  assert.deepEqual(c.items.map((i) => i.sl), [1, 2]);
  assert.equal(c.items[0].label, "Fee");
  assert.equal(c.items[0].remarks, "");
  assert.equal(quoteContext(q750, ifza, 3.6725).items[0].label, "VAT Registration");
  assert.equal(quoteContext(q750, ifza, 3.6725).items[0].remarks, "One Time");
});
test("date is day first, in Dubai time", () => {
  assert.equal(quoteContext(q750, ifza, 3.6725).date, "19/10/2026");
  assert.equal(quoteContext({ ...q750, created_at: "2026-10-19T21:00:00Z" }, ifza, 3.6725).date, "20/10/2026");
});
test("a missing or bad rate falls back to the default", () => {
  assert.equal(DEFAULT_USD_RATE, 3.6725);
  assert.equal(quoteContext(q750, ifza).items[0].amount_usd, "204");
  assert.equal(quoteContext(q750, ifza, 0).items[0].amount_usd, "204");
});

test("net, VAT and total come from the stored amounts, with USD from the same rate", () => {
  const c = quoteContext({ ...base, lines: [{ service_name: "A", amount: 1000 }, { service_name: "B", amount: 500 }], vat_mode: "exclusive", vat_amount: 50, total_amount: 1550 }, ifza, 3.6725);
  assert.equal(c.net, "1,500");
  assert.equal(c.vat, "50");
  assert.equal(c.total, "1,550");
  assert.equal(c.net_usd, "408");
  assert.equal(c.vat_usd, "14");
  assert.equal(c.total_usd, "422");
  const none = quoteContext(qZero, ifza, 3.6725);
  assert.deepEqual([none.net, none.vat, none.total], ["0", "0", "0"]);
});

test("a line's own VAT is listed for templates that show it", () => {
  const c = quoteContext({ ...base, lines: [{ service_name: "A", amount: 1000, vat_rate: 5 }, { service_name: "B", amount: 500, vat_rate: 0 }], vat_mode: "exclusive", vat_amount: 50, total_amount: 1550 }, ifza, 3.6725);
  assert.deepEqual(c.items.map((i) => [i.vat, i.vat_rate]), [["50", 5], ["0", 0]]);
  assert.equal(quoteContext({ ...base, vat_mode: "exclusive", lines: [{ service_name: "A", amount: 42.7, vat_rate: 5 }], vat_amount: 2.14, total_amount: 44.84 }, ifza, 3.6725).items[0].vat, "2.14");
});

test("the built-in quote and letter get net and VAT and the lines say when a fee carries no VAT", async () => {
  const { lineVatData } = await import("../logic/quoteData.js");
  const d = lineVatData({ lines: [{ description: "A", amount: 1000, vat_rate: 5 }, { description: "B", amount: 500, vat_rate: 0 }], vat_amount: 50, total_amount: 1550 });
  assert.equal(d.net, "1,500"); assert.equal(d.vat, "50"); assert.equal(d.total, "1,550"); assert.equal(d.show_breakdown, true); assert.equal(d.has_vat, false);
  assert.deepEqual(d.lines.map((l) => l.description), ["A", "B (0% VAT)"]);
  assert.match(d.vat_statement, /5%/);
});

// ── The built-in quote and letter templates (Template Module), rendered for real ──
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { quoteData, letterData } from "../../Template Module/logic/serviceDocs.js";
import { lineVatData } from "../logic/quoteData.js";

const req = createRequire(new URL("../../Main Module/package.json", import.meta.url));
const renderBuiltIn = (file, data) => {
  const PizZip = req("pizzip"); const Docxtemplater = req("docxtemplater");
  const d = new Docxtemplater(new PizZip(readFileSync(fileURLToPath(new URL(`../../Template Module/templates/${file}`, import.meta.url)))), { paragraphLoop: true, linebreaks: true, nullGetter: () => "" });
  d.render(data);
  return d.getZip().file("word/document.xml").asText().replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "");
};
const bsDoc = { client_name: "Acme", department: "Business Setup", document_number: "Q1", created_at: "2026-11-05T08:00:00Z", vat_mode: "exclusive", vat_rate: 5, vat_amount: 50, total_amount: 1550,
  services: ["A", "B"], lines: [{ description: "A", service_name: "A", amount: 1000, vat_rate: 5 }, { description: "B", service_name: "B", amount: 500, vat_rate: 0 }] };

test("the built-in quote shows net, VAT and total for a Business Setup quote, and keeps one Total row for other departments", () => {
  const withVat = renderBuiltIn("Service_Quotation_Template.docx", { ...quoteData(bsDoc, {}), ...lineVatData(bsDoc) });
  assert.match(withVat, /Net amount\s*1,500/); assert.match(withVat, /VAT\s*50\b/); assert.match(withVat, /Total quotation amount\s*1,550/); assert.match(withVat, /B \(0% VAT\)/);
  assert.doesNotMatch(withVat, /VAT: AED/);
  const other = renderBuiltIn("Service_Quotation_Template.docx", quoteData({ ...bsDoc, department: "Accounting", vat_mode: "inclusive", vat_amount: 71.43, total_amount: 1500 }, {}));
  assert.doesNotMatch(other, /Net amount/); assert.match(other, /Total quotation amount\s*1,500/); assert.match(other, /VAT: AED 71.43/);
});

test("the built-in letter shows net, VAT and total with line VAT", () => {
  const t = renderBuiltIn("Service_Engagement_Template.docx", { ...letterData(bsDoc, {}, {}, []), ...lineVatData(bsDoc) });
  assert.match(t, /Net amount\s*1,500/); assert.match(t, /Total\s*1,550/);
});

test("an older quote (VAT inside the fee, or none) shows the sum of its lines as the net and no per-line VAT", () => {
  const old = quoteContext({ ...base, vat_mode: "inclusive", lines: [{ service_name: "A", amount: 1000 }, { service_name: "B", amount: 500 }], vat_amount: 71.43, total_amount: 1500 }, ifza, 3.6725);
  assert.equal(old.net, "1,500"); assert.equal(old.vat, "71.43"); assert.equal(old.total, "1,500");
  assert.deepEqual(old.items.map((i) => [i.vat, i.vat_rate]), [["", null], ["", null]]);
});
