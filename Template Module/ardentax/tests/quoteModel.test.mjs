// node --test "Template Module/ardentax/tests/"
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeQuote, defaultDetails, feeLabel, fileNameFor, mailTokens, money, quoteBlockers, quoteChecks } from "../logic/quoteModel.js";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/totals.json", import.meta.url), "utf8"));

// The figures on the workbook's Quote sheet: Established, 3,600 documents, AED 4,199, onboarding AED 1,500.
function workbookCase() {
  const d = defaultDetails("2026-11-05");
  d.client.legal = "Sample Trading LLC";
  d.client.email = "poc@sample.example";
  d.selected = "Established";
  d.tiers.S.docs = 3600;
  d.tiers.S.year = 4199;
  d.rows.ONB.inc = true;
  d.rows.ONB.fee = 1500;
  return d;
}

test("workbook figures: totals and wording", () => {
  const t = computeQuote(workbookCase());
  assert.equal(t.oneTime, 1500);
  assert.equal(t.annualTotal, 4199);
  assert.equal(t.year1, 5699);
  assert.equal(t.renewal, 4199);
  assert.equal(t.perMonth, 300);
  assert.equal(t.totalText, "5,699 AED");
  assert.equal(t.totalDesc, "Year 1: one-time AED 1,500 + annual AED 4,199");
  assert.equal(t.overage, 4199 / 3600 + 0.08);
});

test("annual row description comes from volume and coverage", () => {
  const t = computeQuote(workbookCase());
  assert.equal(t.rows.ANN.desc, "E-invoicing service for up to 3,600 invoices annually, covering both sales and purchase invoices (approx. 300 invoices per month included)");
  assert.equal(t.rows.ANN.fee, 4199);
});

test("overage default follows the selected package, not always Established", () => {
  const d = workbookCase();
  d.tiers.C.docs = 10000;
  d.tiers.C.year = 7500;
  d.selected = "Corporate";
  assert.equal(computeQuote(d).overage, 7500 / 10000 + 0.08);
});

test("a typed overage wins, and zero means none", () => {
  const d = workbookCase();
  d.options.overage = 2;
  assert.equal(computeQuote(d).overage, 2);
  d.options.overage = 0;
  assert.equal(computeQuote(d).overage, 0);
});

test("monthly price fills from the annual price unless typed", () => {
  const d = workbookCase();
  assert.equal(computeQuote(d).tierMonth.S, 349.92);
  d.tiers.S.month = 350;
  assert.equal(computeQuote(d).tierMonth.S, 350);
});

test("Option #1 / #2 mode shows TBD and leaves integration out of the total", () => {
  const d = workbookCase();
  d.client.erp = "Zoho Books";
  d.options.showOptions = true;
  d.rows.SUP.inc = true; d.rows.SUP.fee = 2000;
  d.rows.FULL.inc = true; d.rows.FULL.fee = 5000;
  const t = computeQuote(d);
  assert.equal(t.oneTime, 1500);
  assert.equal(t.oneTimeAll, 8500);
  assert.equal(t.opt1Total, 7699);
  assert.equal(t.opt2Total, 10699);
  assert.equal(t.totalText, "TBD");
  assert.equal(t.totalDesc, "Upon client preference: Option 1 - AED 7,699 / Option 2 - AED 10,699 (Year 1)");
  assert.equal(t.rows.SUP.title, "Option #1: Zoho Books Integration Support (Integration handled by client IT team)");
  assert.equal(t.rows.FULL.title, "Option #2: Zoho Books Integration (Handled by Ardentax)");
});

test("no ERP gives the plain integration titles", () => {
  const t = computeQuote(workbookCase());
  assert.equal(t.rows.SUP.title, "ERP Integration Support");
  assert.equal(t.rows.FULL.title, "ERP Integration (Handled by Ardentax)");
});

test("annual only: total description says Annual Subscription", () => {
  const d = workbookCase();
  d.rows.ONB.inc = false;
  assert.equal(computeQuote(d).totalDesc, "Annual Subscription");
});

test("one-time note is automatic, can be typed, can be cleared", () => {
  const d = workbookCase();
  assert.equal(computeQuote(d).oneTimeNote, "");
  d.rows.SUP.inc = true;
  assert.equal(computeQuote(d).oneTimeNote, "Integration support and gap assessment are shown as one-time fees. (integration is out of scope)");
  d.options.oneTimeNote = "Typed";
  assert.equal(computeQuote(d).oneTimeNote, "Typed");
  d.options.oneTimeNote = "";
  assert.equal(computeQuote(d).oneTimeNote, "");
});

test("TRN row description uses the paid count and fee", () => {
  const d = workbookCase();
  d.options.paidTrns = 2; d.options.trnFee = 1200;
  assert.equal(computeQuote(d).rows.TRN.desc, "2 x TRN included (each TRN would cost 1,200 AED)");
});

test("fee labels match the macro", () => {
  assert.equal(feeLabel("", "One-time"), "");
  assert.equal(feeLabel(null, "One-time"), "");
  assert.equal(feeLabel(0, "One-time"), "Included");
  assert.equal(feeLabel("0", "One-time"), "Included");
  assert.equal(feeLabel(1500, "One-time"), "1,500 AED");
  assert.equal(feeLabel(1500.5, "One-time"), "1,500.50 AED");
  assert.equal(feeLabel(" Free ", "One-time"), "Free");
  assert.equal(feeLabel("", "Included"), "Included");
  assert.equal(money(1500), "1,500");
  assert.equal(money(0.25), "0.25");
});

test("a text fee counts as zero in the totals", () => {
  const d = workbookCase();
  d.rows.ONB.fee = "Free";
  const t = computeQuote(d);
  assert.equal(t.oneTime, 0);
  assert.equal(t.year1, 4199);
});

test("custom quote totals and line items", () => {
  const d = workbookCase();
  d.quoteType = "Custom";
  d.custom.volume = 48000;
  d.custom.items[0].fee = "Free";
  d.custom.items[1].fee = 2000;
  d.custom.items[2].fee = 0.25;
  d.custom.items[3].fee = 12000;
  const t = computeQuote(d);
  assert.equal(t.volume, 48000);
  assert.equal(t.oneTime, 2000);
  assert.equal(t.annual, 12000);
  assert.equal(t.year1, 14000);
  assert.equal(t.overage, 0.25);
  assert.equal(t.totalText, "14,000 AED");
  assert.equal(t.items[2].desc, "Per invoice above the 48,000 included invoices");
  assert.equal(t.items[3].desc, "All e-invoicing services for up to 48,000 invoices annually (sales and purchase invoices)");
});

test("each Quote sheet check fires with the workbook's wording", () => {
  const checks = (edit) => { const d = workbookCase(); edit(d); return quoteChecks(d, computeQuote(d)); };
  assert.deepEqual(checks(() => {}), []);
  assert.ok(checks((d) => { d.rows.SUP.inc = true; d.rows.FULL.inc = true; d.rows.ONB.inc = false; }).includes("Both integration rows are included. Set Option #1 / #2 to Yes, or set one row to No."));
  assert.ok(checks((d) => { d.options.showOptions = true; }).includes("Options mode needs both integration rows set to Yes."));
  assert.ok(checks((d) => { d.tiers.S.docs = 0; }).includes("The selected package has no documents per year."));
  assert.ok(checks((d) => { d.rows.TRN.inc = true; }).includes("TRN fee row is included but Paid TRNs is 0."));
  assert.ok(checks((d) => { d.rows.ONB.inc = false; }).includes("Neither onboarding nor complementary scope is shown. Is onboarding really excluded?"));
  assert.ok(checks((d) => { d.client.email = "none"; }).includes("POC email looks incomplete."));
  assert.ok(checks((d) => { d.rows.SUP.inc = true; }).includes("Two long bullet rows are on: the pricing table will be taller than one page and continue on the next page (header repeated). Set one to No to keep it on a single page."));
  assert.ok(checks((d) => { d.options.overage = 9; }).includes("Overage rate looks unusual (normally 0.25 to 4 AED)."));
});

test("each Custom Quote sheet check fires with the workbook's wording", () => {
  const d = workbookCase();
  d.quoteType = "Custom";
  const c = quoteChecks(d, computeQuote(d));
  assert.ok(c.includes("Enter the invoices included per year."));
  d.custom.items = d.custom.items.filter((i) => i.type !== "Per invoice");
  assert.ok(quoteChecks(d, computeQuote(d)).includes("No per-invoice rate: the additional invoices sentence is left out of the quote."));
});

test("what blocks generating matches the macro: client name, package, annual price, volume", () => {
  const d = defaultDetails("2026-11-05");
  const b = quoteBlockers(d, computeQuote(d));
  assert.ok(b.includes("Client legal name"));
  assert.ok(b.includes("Annual price of the selected package"));
  assert.ok(b.includes("Documents per year of the selected package"));
  const ok = workbookCase();
  assert.deepEqual(quoteBlockers(ok, computeQuote(ok)), []);
  const c = workbookCase();
  c.quoteType = "Custom";
  c.custom.items = [];
  const cb = quoteBlockers(c, computeQuote(c));
  assert.ok(cb.includes("Invoices included per year"));
  assert.ok(cb.includes("At least one line item with a fee"));
});

test("mail tokens", () => {
  const d = workbookCase();
  d.client.poc = "Ebinu Thomas";
  d.client.erp = "Odoo";
  const t = computeQuote(d);
  assert.equal(mailTokens("{POC_FIRST}|{POC_NAME}|{CLIENT}|{TIER}|{VOLUME}|{ANNUAL}|{ONE_TIME}|{TOTAL}|{ERP}", d, t),
    "Ebinu|Ebinu Thomas|Sample Trading LLC|Established|3,600|4,199|1,500|5,699 AED|Odoo");
  d.client.poc = "";
  assert.equal(mailTokens("{POC_FIRST}", d, t), "Sir/Madam");
  d.quoteType = "Custom";
  assert.equal(mailTokens("{TIER}", d, computeQuote(d)), "custom");
});

test("file names are safe and carry the version from 2", () => {
  assert.equal(fileNameFor("Ardentax/2026/11/ADTQ001", "A&B / Co", 2), "Ardentax-2026-11-ADTQ001 AB Co v2.docx");
  assert.equal(fileNameFor("Ardentax/2026/11/ADTQ001", "Sample Trading", 1), "Ardentax-2026-11-ADTQ001 Sample Trading.docx");
  assert.equal(fileNameFor("Ardentax/2026/11/ADTQ001", "شركة", 1, "pdf"), "Ardentax-2026-11-ADTQ001.pdf");
});

for (const f of fixtures) {
  test(`shared totals fixture: ${f.name}`, () => {
    const t = computeQuote(f.details);
    assert.deepEqual({ one_time: t.oneTime, annual: t.annualTotal, year1: t.year1 }, f.expect);
  });
}
