// Checks what no database is needed for: every rpc call names a real function with real parameters, every table
// used exists, and both Word templates render from the same merge data the CRM produces.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { quoteMerge, letterMerge } from "../logic/documents.js";

const require = createRequire(new URL("../../Main Module/package.json", import.meta.url));
const here = fileURLToPath(new URL("..", import.meta.url));
const sql = readdirSync(join(here, "../Database Module/Banking Base/migrations")).map((f) => readFileSync(join(here, "../Database Module/Banking Base/migrations", f), "utf8")).join("\n");
const src = ["components", "services"].flatMap((d) => readdirSync(join(here, d)).filter((f) => /\.jsx?$/.test(f)).map((f) => readFileSync(join(here, d, f), "utf8"))).join("\n");

const fns = {};
for (const m of sql.matchAll(/create or replace function public\.(banking_\w+)\(([^)]*)\)/g)) {
  fns[m[1]] = m[2].split(",").map((a) => a.trim().split(/\s+/)[0]).filter(Boolean);
}

test("rpc calls match database functions", () => {
  const bad = [];
  for (const m of src.matchAll(/rpc\("(banking_\w+)"(?:,\s*\{([^}]*)\})?/g)) {
    if (!fns[m[1]]) { bad.push(`missing ${m[1]}`); continue; }
    for (const k of (m[2] || "").matchAll(/(?:^|[,\s{])(p(?:_\w+)?)\s*:/g)) if (!fns[m[1]].includes(k[1])) bad.push(`${m[1]} has no ${k[1]}`);
  }
  assert.deepEqual(bad, []);
});

test("tables used in the UI exist", () => {
  const bad = new Set();
  for (const m of src.matchAll(/(?:table|listAll|insertRow|updateRow)\("(banking_\w+)"/g)) if (!sql.includes(`public.${m[1]} (`)) bad.add(m[1]);
  assert.deepEqual([...bad], []);
});

const company = { name: "AB", short_name: "AB FZE", website: "w", email: "e", mobile: "m", bank: { account_name: "A", bank: "B", account_no: "1", iban: "I", swift: "S", currency: "AED" } };
const flat = (m) => ({ ...m, ba_name: m.bank_details.account_name, ba_iban: m.bank_details.iban });
function render(file, data) {
  const PizZip = require("pizzip");
  const Docxtemplater = require("docxtemplater");
  const zip = new PizZip(readFileSync(join(here, "templates", file)));
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => "" });
  doc.render(data);
  return doc.getZip().file("word/document.xml").asText().replace(/<[^>]+>/g, " ");
}

test("quotation template renders separate lines and memos", () => {
  const q = { quotation_number: "BQ-1", version: 2, status: "Issued", quotation_date: "2026-10-31", valid_until: "2026-11-15", vat_mode: "inclusive", vat_rate: 5, vat_amount: 142.86, discount_total: 0, total_amount: 3000, initial_deposit_memo: 5000, minimum_balance_memo: null, banking_partners: { bank_name: "ADCB" },
    banking_quotation_items: [{ item_type: "Service Fee", description: "Svc", amount: 2000, sort_order: 1 }, { item_type: "Supplementary", description: "Home Ejari", amount: 1000, sort_order: 2 }, { item_type: "Bank Fee", description: "Direct fee", amount: 300, collected_through_ab: false, sort_order: 3 }] };
  const text = render("Quotation_Template.docx", flat(quoteMerge(q, { display_name: "Client LLC" }, { case_ref: "BC-1" }, company, "Me")));
  for (const s of ["BQ-1 v2", "Client LLC", "ADCB", "Home Ejari", "2,000", "AED 3,000", "Direct fee", "initial deposit 5,000"]) assert.ok(text.includes(s), s);
  assert.ok(!/\{[#/]?\w+\}/.test(text), "no placeholder left");
});

test("letter template renders terms from the snapshot", () => {
  const l = { letter_number: "EL-1", letter_date: "2026-10-31", content: { client: "Client LLC", case_ref: "BC-1", bank: "Mashreq", total: 2000, vat_mode: "inclusive", vat_rate: 5, quotation_number: "BQ-1", quotation_version: 1, company,
    items: [{ type: "Service Fee", description: "Business Bank Account", amount: 2000, collected: true }],
    terms: { understanding: "Open with {{bank}}.", scope_title: "Best Effort", scope: ["Process"], fee_intro: "Fees", payment_terms: ["{{vat_statement}}"], ab_responsibilities: ["Prepare"], client_responsibilities: ["Provide"], limitations: "No guarantee", reps: "FATF" } } };
  const text = render("Engagement_Letter_Template.docx", flat(letterMerge(l)));
  for (const s of ["Open with Mashreq.", "Business Bank Account", "inclusive of applicable UAE VAT", "No guarantee", "Client Signature"]) assert.ok(text.includes(s), s);
  assert.ok(!/\{[#/]?\w+\}/.test(text), "no placeholder left");
});
