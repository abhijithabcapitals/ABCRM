import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  canCreate,
  clientVisible,
  dubaiToday,
  fromBanking,
  fromHub,
  fromJob,
  type Source,
  toZohoBody,
  totalsMatch,
  vatDiffers,
  vatMissing,
} from "./mapping.ts";

// Zoho docs checked on the invoices page: line_items name (max 100), rate, quantity, tax_id;
// invoice discount (flat or "10%") with optional discount_type; is_inclusive_tax; reference_number.
// The estimates page was not read separately; the body is assumed to match.

const hubRow = (over: Record<string, unknown> = {}) => ({
  department: "Business Setup",
  client_id: "c1",
  document_number: "BSQ-1",
  status: "accepted",
  total_amount: 1050,
  vat_mode: "exclusive",
  vat_rate: 5,
  lines: [
    { service_name: "Trade licence", description: "ignored", amount: 600 },
    { description: "Visa processing", amount: 400 },
  ],
  ...over,
});

const bankRow = (over: Record<string, unknown> = {}) => ({
  quotation_number: "BQ-1",
  status: "Accepted",
  total_amount: 1000,
  vat_mode: "inclusive",
  vat_rate: 5,
  bank_fee_total: 700,
  service_fee_total: 300,
  supplementary_total: 0,
  discount_total: 50,
  direct_to_bank_total: 200,
  initial_deposit_memo: "memo A",
  minimum_balance_memo: "memo B",
  ...over,
});

Deno.test("hub lines use service_name, then description", () => {
  const b = toZohoBody(fromHub(hubRow()), "cust", "tax", "2026-11-04") as any;
  assertEquals(b.line_items.map((l: any) => l.name), ["Trade licence", "Visa processing"]);
  assertEquals(b.line_items.map((l: any) => [l.rate, l.quantity]), [[600, 1], [400, 1]]);
  assertEquals(b.customer_id, "cust");
  assertEquals(b.date, "2026-11-04");
});

Deno.test("inclusive sets is_inclusive_tax and tax_id on every line", () => {
  const b = toZohoBody(fromHub(hubRow({ vat_mode: "inclusive" })), "c", "tax", "2026-11-04") as any;
  assertEquals(b.is_inclusive_tax, true);
  assert(b.line_items.every((l: any) => l.tax_id === "tax"));
});

Deno.test("exclusive sets is_inclusive_tax false with tax_id", () => {
  const b = toZohoBody(fromHub(hubRow()), "c", "tax", "2026-11-04") as any;
  assertEquals(b.is_inclusive_tax, false);
  assert(b.line_items.every((l: any) => l.tax_id === "tax"));
});

Deno.test("none sends no tax_id", () => {
  const b = toZohoBody(fromHub(hubRow({ vat_mode: "none" })), "c", "tax", "2026-11-04") as any;
  assert(b.line_items.every((l: any) => !("tax_id" in l)));
  assertEquals(b.is_inclusive_tax, false);
});

Deno.test("banking makes bank, service and supplementary lines, dropping zero ones", () => {
  const b = toZohoBody(fromBanking(bankRow({ discount_total: 0 }), "cm1"), "c", "tax", "2026-11-04") as any;
  assertEquals(b.line_items.map((l: any) => l.rate), [500, 300]);
  const b2 = toZohoBody(fromBanking(bankRow({ discount_total: 0, supplementary_total: 20 }), "cm1"), "c", "tax", "2026-11-04") as any;
  assertEquals(b2.line_items.length, 3);
});

Deno.test("banking discount comes off the service fee line and is not sent as discount", () => {
  const b = toZohoBody(fromBanking(bankRow(), "cm1"), "c", "tax", "2026-11-04") as any;
  assertEquals(b.line_items.map((l: any) => [l.name, l.rate]), [["Bank fee", 500], ["Service fee, less discount", 250]]);
  assert(!("discount" in b));
  assert(!("discount_type" in b));
});

Deno.test("exclusive banking: bank line has no direct amount and no tax_id, others are taxed", () => {
  // collected bank 500, service 300, supplementary 100, discount 50, net 350, VAT 17.50, total 867.50
  const row = bankRow({ vat_mode: "exclusive", supplementary_total: 100, total_amount: 867.5 });
  const src = fromBanking(row, "cm1");
  const b = toZohoBody(src, "c", "tax", "2026-11-04") as any;
  const [bank, ...rest] = b.line_items;
  assertEquals(bank.rate, 500);
  assert(!("tax_id" in bank));
  assert(rest.every((l: any) => l.tax_id === "tax"));
  const taxable = rest.reduce((t: number, l: any) => t + l.rate, 0);
  assertEquals(taxable, 350);
  assertEquals(bank.rate + taxable + taxable * 0.05, src.total);
  assertEquals(b.is_inclusive_tax, false);
});

Deno.test("inclusive banking: a discount above the service fee takes the rest off supplementary", () => {
  const row = bankRow({ service_fee_total: 100, supplementary_total: 80, discount_total: 130 });
  const b = toZohoBody(fromBanking(row, "cm1"), "c", "tax", "2026-11-04") as any;
  // service line is zero and dropped; supplementary 80 - 30 = 50
  assertEquals(b.line_items.map((l: any) => [l.name, l.rate]), [["Bank fee", 500], ["Supplementary charges, less discount", 50]]);
});

Deno.test("direct_to_bank_total equal to the whole bank fee gives no bank line", () => {
  const b = toZohoBody(fromBanking(bankRow({ bank_fee_total: 200 }), "cm1"), "c", "tax", "2026-11-04") as any;
  assert(!b.line_items.some((l: any) => l.name === "Bank fee"));
});

Deno.test("direct_to_bank_total and memo fields are never sent", () => {
  const src = fromBanking(bankRow({ direct_to_bank_total: 9999, bank_fee_total: 10499 }), "cm1");
  const json = JSON.stringify([src, toZohoBody(src, "c", "tax", "2026-11-04")]);
  assert(!json.includes("9999"));
  assert(!json.includes("memo"));
  assert(!json.includes("direct_to_bank"));
});

Deno.test("reference_number is the CRM number and no invoice_number is sent", () => {
  const b = toZohoBody(fromHub(hubRow()), "c", "tax", "2026-11-04") as any;
  assertEquals(b.reference_number, "BSQ-1");
  assert(!("invoice_number" in b));
});

Deno.test("line name is cut to Zoho's 100 characters", () => {
  const long = "x".repeat(150);
  const b = toZohoBody(fromHub(hubRow({ lines: [{ service_name: long, amount: 1 }] })), "c", "t", "2026-11-04") as any;
  assertEquals(b.line_items[0].name.length, 100);
});

Deno.test("totalsMatch allows 0.01 and refuses 0.02", () => {
  assert(totalsMatch(100, 100.01));
  assert(totalsMatch(100.01, 100));
  assert(!totalsMatch(100, 100.02));
});

Deno.test("a VAT quote with no tax code is refused", () => {
  const src = fromHub(hubRow());
  assertEquals(vatMissing(src, null), "Pick the 5% VAT code in Settings first.");
  assertEquals(vatMissing(src, "tax"), null);
  assertEquals(vatMissing(fromHub(hubRow({ vat_mode: "none" })), null), null);
});

Deno.test("canCreate: an invoice needs an accepted quote; rejected and superseded quotes create nothing", () => {
  const hub = (status: string) => fromHub(hubRow({ status }));
  assertEquals(canCreate(hub("accepted"), "invoice"), null);
  assert(canCreate(hub("issued"), "invoice") !== null);
  assertEquals(canCreate(hub("issued"), "estimate"), null);
  assertEquals(canCreate(hub("accepted"), "estimate"), null);
  for (const s of ["rejected", "superseded"]) {
    assert(canCreate(hub(s), "estimate") !== null);
    assert(canCreate(hub(s), "invoice") !== null);
  }
  const bank = (status: string) => fromBanking(bankRow({ status }), "cm1");
  for (const s of ["Issued", "Sent", "Accepted"]) assertEquals(canCreate(bank(s), "estimate"), null);
  assertEquals(canCreate(bank("Accepted"), "invoice"), null);
  assert(canCreate(bank("Sent"), "invoice") !== null);
  for (const s of ["Draft", "Approval Required", "Rejected", "Expired", "Superseded"]) {
    assert(canCreate(bank(s), "estimate") !== null);
  }
});

Deno.test("canCreate: unreadable, negative and empty lines are refused", () => {
  const msg = "This quote has an amount that can't be read. Fix it before creating a Zoho draft.";
  for (const amount of ["abc", -5, null, undefined]) {
    assertEquals(canCreate(fromHub(hubRow({ lines: [{ service_name: "A", amount }] })), "estimate"), msg);
  }
  assertEquals(canCreate(fromHub(hubRow({ lines: [] })), "estimate"), "This quote has no lines to send to Zoho.");
  assertEquals(canCreate(fromBanking(bankRow({ discount_total: 5000 }), "cm1"), "estimate"), msg);
  assertEquals(canCreate(fromBanking(bankRow({ service_fee_total: "x" }), "cm1"), "estimate"), msg);
});

Deno.test("canCreate: no client record is refused", () => {
  const src: Source = fromBanking(bankRow(), null);
  assertEquals(canCreate(src, "estimate"), "This client has no Client Master record, so it can't be linked to Zoho.");
});

Deno.test("clientVisible: sent, viewed, overdue, paid, unpaid, partially_paid true; draft, void, pending_approval, unknown false", () => {
  for (const s of ["sent", "viewed", "overdue", "paid", "unpaid", "partially_paid"]) assert(clientVisible(s), s);
  for (const s of ["draft", "void", "pending_approval", "weird", ""]) assert(!clientVisible(s), s);
});

Deno.test("dubaiToday rolls over at 20:00 UTC", () => {
  assertEquals(dubaiToday(new Date("2026-11-04T19:59:59Z")), "2026-11-04");
  assertEquals(dubaiToday(new Date("2026-11-04T20:00:00Z")), "2026-11-05");
});

Deno.test("a revised Banking quote gets its own reference; version 1 keeps the number", () => {
  const v1 = fromBanking(bankRow({ quotation_number: "BQ-7", version: 1 }), "cm1");
  const v2 = fromBanking(bankRow({ quotation_number: "BQ-7", version: 2 }), "cm1");
  const none = fromBanking(bankRow({ quotation_number: "BQ-7", version: null }), "cm1");
  assertEquals([v1.reference, v2.reference, none.reference], ["BQ-7", "BQ-7 v2", "BQ-7"]);
});

Deno.test("a quote with no number is refused", () => {
  const src = fromHub(hubRow({ document_number: "  " }));
  assertEquals(canCreate(src, "estimate"), "This quote has no number, so it can't be sent to Zoho.");
});

Deno.test("a VAT rate other than 5 is refused unless the quote has no VAT", () => {
  const msg = "This quote uses a VAT rate other than 5%, which the saved Zoho VAT code doesn't match.";
  for (const mode of ["inclusive", "exclusive"]) {
    assertEquals(canCreate(fromHub(hubRow({ vat_mode: mode, vat_rate: 15 })), "estimate"), msg);
    assertEquals(canCreate(fromHub(hubRow({ vat_mode: mode, vat_rate: null })), "estimate"), msg);
    assertEquals(canCreate(fromHub(hubRow({ vat_mode: mode, vat_rate: "5.00" })), "estimate"), null);
  }
  assertEquals(canCreate(fromHub(hubRow({ vat_mode: "none", vat_rate: 0 })), "estimate"), null);
  assertEquals(canCreate(fromBanking(bankRow({ vat_rate: 15 }), "c1"), "estimate"), msg);
  assertEquals(canCreate(fromBanking(bankRow(), "c1"), "estimate"), null);
});

Deno.test("the source carries the rate and the VAT amount", () => {
  const h = fromHub(hubRow({ vat_amount: 50 }));
  assertEquals([h.vatRate, h.vatAmount], [5, 50]);
  assertEquals(fromHub(hubRow()).vatAmount, null);
  assertEquals(fromHub(hubRow({ vat_amount: -1 })).vatAmount, null);
  assertEquals(fromBanking(bankRow({ vat_amount: 12.5 }), "c1").vatAmount, 12.5);
});

Deno.test("vatDiffers uses a one cent tolerance and is null when unchecked", () => {
  assertEquals(vatDiffers(5, 5), false);
  assertEquals(vatDiffers(5, 5.01), false);
  assertEquals(vatDiffers(5, 5.02), true);
  assertEquals(vatDiffers(5, "4"), true);
  assertEquals(vatDiffers(5, undefined), null);
  assertEquals(vatDiffers(5, null), null);
  assertEquals(vatDiffers(5, "abc"), null);
  assertEquals(vatDiffers(null, 5), null);
});

// ---- Accounting jobs ----

const jobRow = (over: Record<string, unknown> = {}) => ({
  id: "j1",
  job_number: "JOB-000007",
  client_id: "CL1",
  service_name: "VAT Return",
  period_label: "Q3 2026",
  work_status: "Completed",
  fee_amount: "1000.00",
  invoice_number: null,
  ...over,
});

Deno.test("a job maps to one exclusive 5% line with its own reference", () => {
  const s = fromJob(jobRow());
  assertEquals(s.department, "Accounting");
  assertEquals(s.reference, "JOB-000007");
  assertEquals(s.clientId, "CL1");
  assertEquals(s.vatMode, "exclusive");
  assertEquals(s.vatRate, 5);
  assertEquals(s.lines, [{ name: "VAT Return - Q3 2026", amount: 1000, taxable: true }]);
  assertEquals([s.vatAmount, s.total], [50, 1050]);
  const b = toZohoBody(s, "cust", "tax", "2026-11-04") as any;
  assertEquals(b.is_inclusive_tax, false);
  assertEquals(b.line_items, [{ name: "VAT Return - Q3 2026", rate: 1000, quantity: 1, tax_id: "tax" }]);
  assertEquals(canCreate(s, "invoice"), null);
});

Deno.test("job totals round to 2 places", () => {
  const t = (fee: string) => {
    const s = fromJob(jobRow({ fee_amount: fee }));
    return [s.vatAmount, s.total];
  };
  assertEquals(t("123.45"), [6.17, 129.62]);
  assertEquals(t("0.10"), [0.01, 0.11]);
  assertEquals(t("0.09"), [0, 0.09]);
  assertEquals(t("10.10"), [0.51, 10.61]);
  assertEquals(t("99999999.99"), [5000000, 104999999.99]);
});

Deno.test("a job line has no period part when none is set, and the name is capped at 100", () => {
  assertEquals(fromJob(jobRow({ period_label: null })).lines[0].name, "VAT Return");
  assertEquals(fromJob(jobRow({ period_label: "  " })).lines[0].name, "VAT Return");
  const long = fromJob(jobRow({ service_name: "S".repeat(120) }));
  const b = toZohoBody(long, "c", "t", "2026-11-04") as any;
  assertEquals(b.line_items[0].name.length, 100);
});

Deno.test("job refusals use plain text", () => {
  const no = (over: Record<string, unknown>, kind: "invoice" | "estimate" = "invoice") => canCreate(fromJob(jobRow(over)), kind);
  assertEquals(no({}, "estimate"), "An estimate can't be made from a job. Only an invoice can.");
  assertEquals(no({ work_status: "In Progress" }), "This job must be completed before it is invoiced.");
  assertEquals(no({ work_status: "completed" }), "This job must be completed before it is invoiced.");
  assertEquals(no({ fee_amount: null }), "This job has no fee yet.");
  assertEquals(no({ fee_amount: 0 }), "This job has no fee yet.");
  assertEquals(no({ fee_amount: "0.00" }), "This job has no fee yet.");
  const bad = "This job has a fee that can't be read. Fix it before creating a Zoho draft.";
  assertEquals(no({ fee_amount: -5 }), bad);
  assertEquals(no({ fee_amount: "abc" }), bad);
  assertEquals(no({ client_id: null }), "Link a client to this job first.");
  assertEquals(no({ invoice_number: "INV-9" }), "This job already has an invoice recorded.");
});

Deno.test("a job's recorded invoice no longer blocks once the handler clears the flag", () => {
  const s = fromJob(jobRow({ invoice_number: "INV-9" }));
  assertEquals(s.invoiceRecorded, true);
  assertEquals(canCreate({ ...s, invoiceRecorded: false }, "invoice"), null);
});

Deno.test("a job linked to a quote is inclusive: nothing is added to the fee", () => {
  const s = fromJob(jobRow({ quote_id: "q1", fee_amount: "1050.00" }));
  assertEquals([s.vatMode, s.vatRate, s.vatAmount, s.total], ["inclusive", 5, 50, 1050]);
  assertEquals(s.lines, [{ name: "VAT Return - Q3 2026", amount: 1050, taxable: true }]);
  const b = toZohoBody(s, "cust", "tax", "2026-11-05") as any;
  assertEquals(b.is_inclusive_tax, true);
  assertEquals(b.line_items[0], { name: "VAT Return - Q3 2026", rate: 1050, quantity: 1, tax_id: "tax" });
  assertEquals(canCreate(s, "invoice"), null);
});

Deno.test("a quote-linked job's VAT is round(fee * 5 / 105, 2)", () => {
  const v = (fee: string) => fromJob(jobRow({ quote_id: "q1", fee_amount: fee })).vatAmount;
  assertEquals(v("100.00"), 4.76);
  assertEquals(v("105.00"), 5);
  assertEquals(v("1234.56"), 58.79);
  assertEquals(v("0.21"), 0.01);
  assertEquals(v("0.20"), 0.01);
  assertEquals(v("0.10"), 0);
  assertEquals(fromJob(jobRow({ quote_id: "q1", fee_amount: "1234.56" })).total, 1234.56);
});

Deno.test("a typed fee is still exclusive when quote_id is empty", () => {
  const s = fromJob(jobRow({ quote_id: null }));
  assertEquals([s.vatMode, s.vatAmount, s.total], ["exclusive", 50, 1050]);
});
