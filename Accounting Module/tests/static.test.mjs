// node --test "Accounting Module/tests/"   (no database needed)
// Every rpc call in services/ must name a real database function with real parameters, and every status, mode and
// method constant in logic/jobs.js must appear in the migrations' checks.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { FOLLOW_UP_CHANNELS, PAYMENT_METHODS, RECEIPT_MODES, WORK_STATUSES } from "../logic/jobs.js";

const here = fileURLToPath(new URL("..", import.meta.url));
const dir = join(here, "../Database Module/Accounting Base/migrations");
const sql = readdirSync(dir).filter((f) => f.endsWith(".sql")).map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
const sdir = join(here, "services");
const src = readdirSync(sdir).filter((f) => /\.jsx?$/.test(f)).map((f) => readFileSync(join(sdir, f), "utf8")).join("\n");

const fns = {};
for (const m of sql.matchAll(/create or replace function public\.(accounting_\w+)\(([^)]*)\)/g)) {
  fns[m[1]] = m[2].split(",").map((a) => a.trim().split(/\s+/)[0]).filter(Boolean);
}

test("services call at least one database function", () => {
  assert.ok([...src.matchAll(/rpc\("accounting_\w+"/g)].length >= 10);
});

test("rpc calls match database functions", () => {
  const bad = [];
  for (const m of src.matchAll(/rpc\("(accounting_\w+)"(?:,\s*\{([^}]*)\})?/g)) {
    if (!fns[m[1]]) { bad.push(`missing ${m[1]}`); continue; }
    for (const k of (m[2] || "").matchAll(/(?:^|[,\s{])(p(?:_\w+)?)\s*:/g)) if (!fns[m[1]].includes(k[1])) bad.push(`${m[1]} has no ${k[1]}`);
  }
  assert.deepEqual(bad, []);
});

test("tables and views read by services exist", () => {
  const bad = new Set();
  for (const m of src.matchAll(/table\("(accounting_\w+)"/g)) if (!new RegExp(`(table|view) (if not exists )?public\\.${m[1]}\\b`).test(sql)) bad.add(m[1]);
  assert.deepEqual([...bad], []);
});

test("constants in logic/jobs.js appear in the migration checks", () => {
  const missing = [];
  for (const v of [...WORK_STATUSES, ...RECEIPT_MODES, ...PAYMENT_METHODS]) if (!sql.includes(`'${v}'`)) missing.push(v);
  assert.deepEqual(missing, []);
  assert.ok(FOLLOW_UP_CHANNELS.length > 0);
});

const component = (f) => readFileSync(join(here, "components", f), "utf8");

test("the job screens read clients through accounting_client_options, not client_lookup", () => {
  assert.match(src, /rpc\("accounting_client_options"\)/);
  for (const f of ["JobForm.jsx", "JobWorkspace.jsx", "FollowUps.jsx"]) {
    const s = component(f);
    assert.doesNotMatch(s, /useClientLookup\(/, f);
    assert.match(s, /clientOptions/, f);
  }
});

test("quotation and letter can be generated on any job, the checklist stays for new clients", () => {
  const s = component("JobWorkspace.jsx");
  const start = s.indexOf("{job.is_new_client && (");
  assert.ok(start > 0);
  const gated = s.slice(start, s.indexOf("</Panel>", start));
  assert.doesNotMatch(gated, /setModal\(/);
  assert.match(s, /setModal\("quote"\)/);
  assert.match(s, /setModal\("letter"\)/);
});

test("Voucher Base 002 keeps all five sources in the check", () => {
  const v = readFileSync(join(here, "../Database Module/Voucher Base/migrations/002_voucher_files.sql"), "utf8");
  const list = v.match(/check \(source in \(([^)]*)\)\)/)[1];
  for (const s of ["banking", "hub", "template", "business_setup", "accounting"]) assert.ok(list.includes(`'${s}'`), s);
});

test("fee labels say before VAT for a typed fee, and the invoice default and difference use fee plus VAT", () => {
  const form = component("JobForm.jsx");
  assert.match(form, /Fee \(AED, before VAT\)/);
  assert.doesNotMatch(form, /including any VAT/);
  const w = component("JobWorkspace.jsx");
  assert.doesNotMatch(w, /including any VAT/);
  assert.match(w, /label: feeLabel\(job\)/);
  assert.match(w, /amount: feeWithVat\(job\) \?\? ""/);
  assert.match(w, /Number\(job\.invoice_amount\) - feeWithVat\(job\)/);
  assert.match(w, /before VAT, so the amount starts at the fee plus 5% VAT/);
  assert.match(w, /which already includes VAT/);
});

test("linking a quotation always changes the fee: no keep option, and closing links nothing", () => {
  const w = component("JobWorkspace.jsx");
  assert.doesNotMatch(w, /Keep job fee|Which fee to keep/);
  assert.match(w, /changes the job fee from AED/);
  assert.match(w, /Closing this does not link the quotation/);
  assert.match(w, /linkDocument\(job\.id, "quote", d\.id, true\)/);
  assert.match(w, /<Modal title="Link this quotation\?" onClose=\{\(\) => setPendingQuote\(null\)\}>/);
  const api = readFileSync(join(here, "services/jobsApi.js"), "utf8");
  assert.match(api, /accounting_quote_vat_mode/);
});
