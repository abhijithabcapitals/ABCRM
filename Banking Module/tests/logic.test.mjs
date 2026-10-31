// node --test "Banking Module/tests/logic.test.mjs"   (no extra packages; xlsx comes from Main Module)
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parsePaymentNote } from "../logic/paymentNotes.js";
import { quoteTotals } from "../logic/pricing.js";
import { buildAutofill } from "../logic/kycAutofill.js";
import { readSheet, markDuplicates, suggestStatus, resolveBank, normaliseCompany, isCleanRow, colourFamily } from "../logic/excelImport.js";

const require = createRequire(new URL("../../Main Module/package.json", import.meta.url));
const XLSX = require("xlsx");
const WORKBOOK = fileURLToPath(new URL("../../Resources/Banking/Banking Working sheet.xlsx", import.meta.url));

test("brief's example splits into two payments and no invented record", () => {
  const r = parsePaymentNote("500 BT 01/10 BT 500 24/10", "2026-10-01", 1500);
  assert.equal(r.payments.length, 2);
  assert.deepEqual(r.payments.map((p) => [p.amount, p.date, p.method]), [[500, "2026-10-01", "Bank Transfer"], [500, "2026-10-24", "Bank Transfer"]]);
  assert.ok(r.payments.every((p) => p.year_assumed));
});
test("amount without date keeps date empty", () => {
  const r = parsePaymentNote("1000 PAID CASH", "2025-03-01");
  assert.equal(r.payments[0].amount, 1000);
  assert.equal(r.payments[0].date, null);
  assert.equal(r.payments[0].needs_date, true);
  assert.equal(r.payments[0].method, "Cash");
});
test("no amount, no fabricated payment", () => {
  assert.equal(parsePaymentNote("CASH PAID", "2025-03-01").payments.length, 0);
  assert.ok(parsePaymentNote("CASH PAID", "2025-03-01").flags.length > 0);
});
test("due only is not a payment", () => {
  const r = parsePaymentNote("3000 DUE", "2025-03-01");
  assert.equal(r.payments.length, 0);
  assert.equal(r.stated_due, 3000);
});
test("paid and due in one note", () => {
  const r = parsePaymentNote("2000 BANK TRANSFER 2500 DUE", "2025-03-01");
  assert.equal(r.payments.length, 1);
  assert.equal(r.payments[0].amount, 2000);
  assert.equal(r.stated_due, 2500);
});
test("multi-method note", () => {
  const r = parsePaymentNote("500 CAHS PAID 2000 BT 2000 DUE", "2025-03-01");
  assert.deepEqual(r.payments.map((p) => [p.amount, p.method]), [[500, "Cash"], [2000, "Bank Transfer"]]);
  assert.equal(r.stated_due, 2000);
});
test("full wording suggests fee and flags it", () => {
  const r = parsePaymentNote("RECD FULL", "2025-03-01", 2500);
  assert.equal(r.payments[0].amount, 2500);
  assert.equal(r.payments[0].amount_assumed, true);
  assert.ok(r.flags.length);
});
test("invalid date is not used", () => {
  assert.equal(parsePaymentNote("500 PAID 45/13", "2025-03-01").payments[0].date, null);
});
test("Ejari note is flagged", () => {
  assert.equal(parsePaymentNote("700 HOME EJARI", "2025-03-01").home_ejari, true);
  assert.equal(parsePaymentNote("700 HOME EJARI", "2025-03-01").payments.length, 0);
});

test("pricing matches database vectors", () => {
  const lines = [
    { item_type: "Bank Fee", unit_amount: 300 },
    { item_type: "Service Fee", unit_amount: 2000 },
    { item_type: "Supplementary", unit_amount: 1000 },
    { item_type: "Discount", unit_amount: 100 },
  ];
  assert.equal(quoteTotals(lines, "inclusive").total_amount, 3200);
  assert.equal(quoteTotals(lines, "inclusive").vat_amount, 138.1);
  assert.equal(quoteTotals(lines, "exclusive").total_amount, 3345);
  const direct = quoteTotals([{ item_type: "Bank Fee", unit_amount: 300, collected_through_ab: false }, { item_type: "Service Fee", unit_amount: 2000 }]);
  assert.equal(direct.total_amount, 2000);
  assert.equal(direct.direct_to_bank_total, 300);
});

test("status: text decides, colour conflicts go to a person", () => {
  assert.equal(suggestStatus("Approved", "green").status, "Approved");
  assert.equal(suggestStatus("Approved", "green").confidence, "High");
  assert.equal(suggestStatus("WIP", "green").status, null);
  assert.equal(suggestStatus("WIP", "red").status, null);
  assert.equal(suggestStatus("Approved", "red").status, null);
  assert.equal(suggestStatus("Rejected", "red").confidence, "Medium");
  assert.equal(suggestStatus("WIP", "none").status, "Document Collection");
  assert.equal(suggestStatus("", "none").status, null);
});
test("bank aliases and excluded services", () => {
  const partners = [{ bank_code: "MASHREQ", bank_name: "Mashreq", aliases: ["MASHREQ NEO BIZ", "MASHREQ"] }, { bank_code: "ADIB", bank_name: "ADIB", aliases: ["ADIB"] }];
  assert.equal(resolveBank("Mashreq Neo Biz", partners).bank_code, "MASHREQ");
  assert.equal(resolveBank("ADIB PERSONAL", partners).personal, true);
  assert.equal(resolveBank("POS MACHINE NETWORK", partners).skip, true);
  assert.equal(resolveBank("CT FILING", partners).skip, true);
  assert.equal(resolveBank("FAIYAZ", partners).unknown, true);
});
test("company key ignores legal form and punctuation", () => {
  assert.equal(normaliseCompany("Test Trading L.L.C"), normaliseCompany("TEST TRADING LLC"));
});
test("colour families", () => {
  assert.equal(colourFamily({ s: { patternType: "solid", fgColor: { rgb: "FF08EC4F" } } }).family, "green");
  assert.equal(colourFamily({ s: { patternType: "solid", fgColor: { rgb: "FFFF0000" } } }).family, "red");
  assert.equal(colourFamily({ s: { patternType: "solid", fgColor: { rgb: "FFFFFF00" } } }).family, "other");
  assert.equal(colourFamily({}).family, "none");
});

test("real workbook: monthly and completed sheets parse", { skip: !existsSync(WORKBOOK) }, () => {
  const wb = XLSX.read(readFileSync(WORKBOOK), { cellStyles: true, cellNF: true });
  const partners = [["ADCB",["ADCB"]],["RAKBANK",["RAK","RAKBANK","RAK BANK"]],["WIO",["WIO","WIO BANK"]],["ENBD",["ENBD","EMIRATES NBD","ENBD CONNECT"]],["ADIB",["ADIB","ADIB DIGITAL"]],["DIB",["DIB"]],["FAB",["FAB"]],["MBANK",["M BANK"]],["UBL",["UBL"]],["EIB",["EIB","EMIRATES ISLAMIC BANK","EMIRATES ISLAMIC SHARJAH"]],["MASHREQ",["MASHREQ","MASHREQ NEO BIZ","MASHREQ NEO","MASHREQ TRADITIONAL","MASHREQ NEW BIZ","MASHREQ NIO BIZ","MASHREQ KYC","MASHERQ"]],["SIB",["SIB"]]]
    .map(([bank_code, aliases]) => ({ bank_code, bank_name: bank_code, aliases }));
  const m = readSheet(wb.Sheets["Monthly Bank Account"], "Monthly Bank Account", XLSX, { partners });
  const c = readSheet(wb.Sheets["Completed Bank"], "Completed Bank", XLSX, { partners });
  markDuplicates([...m.rows, ...c.rows]);
  assert.equal(m.summary.headerRows, 27);
  assert.ok(m.rows.length > 550, `monthly rows ${m.rows.length}`);
  assert.ok(m.summary.skippedService >= 8);
  assert.ok(c.rows.length > 500, `completed rows ${c.rows.length}`);
  assert.ok(m.rows.every((r) => r.source_row > 3 && r.source_sheet && r.raw));
  assert.ok(m.rows.some((r) => r.colour_meaning === "green"), "cell colour read");
  assert.ok(m.rows.some((r) => r.colour_meaning === "red"), "red read");
  assert.ok(m.rows.some((r) => r.mapped.home_ejari), "home ejari found");
  assert.ok(!m.rows.some((r) => /^(TOTAL|ONLINE|SIR)\b/i.test(r.mapped.company)), "summary rows excluded");
  const rowStats = { clean: m.rows.filter(isCleanRow).length, low: m.rows.filter((r) => r.confidence === "Low").length, dup: m.rows.filter((r) => r.duplicate_of_row).length, maybeDup: [...m.rows, ...c.rows].filter((r) => r.possible_duplicate_of).length, unknownBank: m.rows.filter((r) => !r.mapped.bank_resolved).length, withPayments: m.rows.filter((r) => r.payment_candidates.length).length };
  console.log("monthly", m.rows.length, JSON.stringify(rowStats), "completed", c.rows.length);
  const first = m.rows[0];
  assert.equal(first.month_label, "2024-08");
  assert.equal(first.source_row, 4);
});

test("autofill maps fields, skips low confidence, keeps conflicts for a person", () => {
  const a = buildAutofill([
    { name: "licence.pdf", extraction: { fields: [{ key: "legal_name", value: "Test LLC", confidence: "high" }, { key: "licence_number", value: "123", confidence: "medium" }, { key: "website", value: "bad", confidence: "low" }, { key: "jurisdiction", value: "Free Zone", confidence: "high" }], people: [], rows: [] } },
    { name: "moa.pdf", extraction: { fields: [{ key: "legal_name", value: "Other LLC", confidence: "high" }], people: [], rows: [{ list: "shareholders", item: { name: "Asha", ownership: "60%", nationality: "Indian" } }] } },
    { name: "pp.jpg", extraction: { fields: [], people: [{ name: "Asha", nationality: "IND" }], rows: [] } },
  ]);
  assert.equal(a.values.legal_name, "Test LLC");
  assert.equal(a.values.license_number, "123");
  assert.equal(a.values.website, undefined);
  assert.equal(a.values.is_free_zone, true);
  assert.equal(a.conflicts.legal_name.length, 2);
  assert.equal(a.shareholders.length, 1);
  assert.equal(a.sources.license_number, "licence.pdf");
});
