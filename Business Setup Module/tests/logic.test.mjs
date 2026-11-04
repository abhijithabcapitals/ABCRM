import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expiryNote } from "../logic/expiries.js";
import { kycMissing } from "../logic/kyc.js";
import { buildLines } from "../logic/lines.js";
import { balance, canStart, canComplete, isRegistration } from "../logic/balances.js";
import { SERVICE_STATUSES, zohoProps } from "../logic/statuses.js";
import { contactChoice } from "../logic/contact.js";

test("a past date asks staff to check it, because imported dates may be stale", () => {
  assert.equal(expiryNote({ state: "Past date" }), "Check this date");
  assert.equal(expiryNote({ state: "Upcoming" }), "Upcoming");
});

test("KYC names each required field and needs no licence for a new company", () => {
  const full = { legal_name: "A", contact: "B", email: "a@b.c", phone: "1", business_activity: "T", company_status: "New", partners: [{ full_name: "P", nationality: "IN" }] };
  assert.deepEqual(kycMissing(full), []);
  assert.deepEqual(kycMissing({ ...full, email: " " }), ["email"]);
  assert.deepEqual(kycMissing({ ...full, partners: [{ full_name: "P" }] }), ["partner"]);
  assert.deepEqual(kycMissing({ ...full, company_status: "Existing" }), ["licence number", "licence expiry", "issuing authority"]);
  assert.deepEqual(kycMissing({ ...full, company_status: "Existing", licence_number: "L", licence_expiry: "2027-01-01", issuing_authority: "IFZA" }), []);
});

test("lines carry their service, action and fee item, and the description shows the action except for New", () => {
  const [a, b] = buildLines([{ service_name: "Trade licence", action: "New", fee_item_id: "f1", amount: "100" }, { service_name: "Visa", action: "Renewal", amount: 50, remarks: "x" }]);
  assert.deepEqual(a, { service_name: "Trade licence", action: "New", fee_item_id: "f1", description: "Trade licence", amount: 100, remarks: "" });
  assert.equal(b.description, "Renewal Visa");
  assert.equal(b.fee_item_id, null);
  assert.equal(b.remarks, "x");
});

test("balance handles a part payment, a reversal, a refund and a zero total", () => {
  assert.deepEqual(balance(1000, [{ type: "Payment", amount: 400 }]), { total: 1000, netPaid: 400, outstanding: 600 });
  assert.equal(balance(1000, [{ type: "Payment", amount: 400 }, { type: "Reversal", amount: 400 }]).netPaid, 0);
  assert.equal(balance(1000, [{ type: "Payment", amount: 400 }, { type: "Refund", amount: 100 }]).outstanding, 700);
  assert.deepEqual(balance(0, []), { total: 0, netPaid: 0, outstanding: 0 });
  assert.equal(balance(null, null).outstanding, 0);
});

test("a service can start with money received, or with nothing to pay", () => {
  assert.equal(canStart({ total: 1000, netPaid: 0 }), false);
  assert.equal(canStart({ total: 1000, netPaid: 1 }), true);
  assert.equal(canStart({ total: 0, netPaid: 0 }), true);
});

test("a service needs a file to complete, unless overridden with a reason", () => {
  assert.equal(canComplete({ files: 0 }), false);
  assert.equal(canComplete({ files: 1 }), true);
  assert.equal(canComplete({ files: 0, override: true }), false);
  assert.equal(canComplete({ files: 0, override: true, reason: "Nothing issued" }), true);
});

test("company registration lines ask for licence details", () => {
  assert.equal(isRegistration("Company registration"), true);
  assert.equal(isRegistration("Trade Licence IFZA"), true);
  assert.equal(isRegistration("License Fees"), true);
  assert.equal(isRegistration("Visa renewal"), false);
});

test("the status list matches the database", () => {
  const sql = readFileSync(fileURLToPath(new URL("../../Database Module/Business Setup Base/migrations/006_quotes_tracker.sql", import.meta.url)), "utf8");
  const list = sql.match(/p_status in \(([^)]+)\)/)[1].split(",").map((s) => s.trim().replace(/'/g, ""));
  assert.deepEqual(SERVICE_STATUSES, list);
});

test("contact: a blank form keeps the master value, a difference asks staff to choose", () => {
  assert.deepEqual(contactChoice("a@b.c", ""), { conflict: false, value: "a@b.c" });
  assert.deepEqual(contactChoice("", "a@b.c"), { conflict: false, value: "a@b.c" });
  assert.deepEqual(contactChoice("a@b.c", " a@b.c "), { conflict: false, value: "a@b.c" });
  assert.deepEqual(contactChoice("old@b.c", "new@b.c"), { conflict: true, master: "old@b.c", form: "new@b.c" });
});

test("the Zoho panel sits before the Banking handover button and blocks nothing", () => {
  const bank = readFileSync(fileURLToPath(new URL("../../Banking Module/components/BankProcess.jsx", import.meta.url)), "utf8");
  const panel = readFileSync(fileURLToPath(new URL("../../Integrations Module/components/ZohoPanel.jsx", import.meta.url)), "utf8");
  assert.ok(bank.indexOf("<ZohoPanel") > 0 && bank.indexOf("<ZohoPanel") < bank.indexOf('id="bk-complete"'));
  assert.doesNotMatch(panel, /Send to Accounts|bk-complete/);
  // The handover controls sit outside the panel and in no condition that reads Zoho state.
  const quotes = readFileSync(fileURLToPath(new URL("../components/workspace/Quotes.jsx", import.meta.url)), "utf8");
  const sendLine = quotes.split(/\r?\n/).find((l) => l.includes("Send to Accounts</Button>"));
  assert.ok(sendLine, "Quotes.jsx lost the Send to Accounts button");
  assert.doesNotMatch(sendLine, /zoho|quoteId|ZohoPanel/i);
  assert.match(sendLine, /^\s*\{can\("setup\.services\.manage"\) && <Button variant="primary" onClick=\{\(\) => setDialog\("send"\)\}>Send to Accounts<\/Button>\}\s*$/);
  const completeLine = bank.split(/\r?\n/).find((l) => l.includes('id="bk-complete"'));
  assert.ok(completeLine, "BankProcess.jsx lost bk-complete");
  assert.doesNotMatch(completeLine, /zoho|quoteId|quoteNote/i);
  for (const src of [quotes, bank]) {
    const tag = src.match(/<ZohoPanel[\s\S]*?\/>/)?.[0];
    assert.ok(tag, "the panel must be a self-closing element, with no children");
    assert.doesNotMatch(tag, /Send to Accounts|bk-complete/);
  }
});

test("the quote screen sends every contact field the database asks for", () => {
  const flow = readFileSync(fileURLToPath(new URL("../components/NewServiceFlow.jsx", import.meta.url)), "utf8");
  for (const f of ["client_id", "client_name", "contact_name", "contact_email", "contact_phone", "client_address", "lines", "template_key"]) assert.ok(flow.includes(f), f);
});

test("a quote's mail draft carries its lines, which the database asks for", () => {
  const docs = readFileSync(fileURLToPath(new URL("../services/documents.js", import.meta.url)), "utf8");
  assert.match(docs, /doc_type: "mail"[^;]*lines: doc\.lines/);
});

test("private price files are ignored by the repository itself", () => {
  const ignore = readFileSync(fileURLToPath(new URL("../../.gitignore", import.meta.url)), "utf8");
  assert.match(ignore, /Database Module\/Business Setup Base\/private\//);
  assert.match(ignore, /\.superpowers\//);
});

test("Zoho panel: issued quotes get the estimate only, accepted get both", () => {
  const ok = { quotes: true, held: false, ready: true, invoiceRight: true };
  assert.deepEqual(zohoProps("issued", ok), { kinds: ["estimate"], canCreate: { estimate: true, invoice: false } });
  assert.deepEqual(zohoProps("accepted", ok), { kinds: ["estimate", "invoice"], canCreate: { estimate: true, invoice: true } });
});

test("Zoho panel: a held quote is read-only, and the invoice needs a ready accepted quote", () => {
  const held = zohoProps("accepted", { quotes: true, held: true, ready: true, invoiceRight: true });
  assert.deepEqual(held.canCreate, { estimate: false, invoice: false });
  assert.deepEqual(held.kinds, ["estimate", "invoice"]);
  assert.equal(zohoProps("accepted", { quotes: true, held: false, ready: false, invoiceRight: true }).canCreate.invoice, false);
  assert.equal(zohoProps("accepted", { quotes: true, held: false, ready: true, invoiceRight: false }).canCreate.invoice, false);
  assert.equal(zohoProps("accepted", { quotes: false, held: false, ready: true, invoiceRight: true }).canCreate.estimate, false);
  assert.equal(zohoProps("accepted", { quotes: true, held: false, ready: false, known: false, invoiceRight: true }).canCreate.estimate, false);
});

// ── Phase 1 review fixes ──
import { readdirSync } from "node:fs";
import { DOC_KINDS, FIELDS, SERVICES_FIELD, changedAnswers, formValues } from "../logic/staffForm.js";
import { itemState, itemTone } from "../logic/checklist.js";
const onboardingSql = readFileSync(fileURLToPath(new URL("../../Database Module/Business Setup Base/migrations/009_onboarding.sql", import.meta.url)), "utf8");

test("staff document kinds are exactly the types the client form asks for, including address proofs", () => {
  const def = onboardingSql.slice(onboardingSql.indexOf('"documents": ['), onboardingSql.indexOf("}$json$"));
  const types = [...def.matchAll(/"type": "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...DOC_KINDS].sort(), [...new Set(types)].sort());
  for (const k of ["Ejari", "Bank statement", "Utility bill"]) assert.ok(DOC_KINDS.includes(k), k);
});

test("staff can complete every answer the form requires", () => {
  const fn = onboardingSql.slice(onboardingSql.indexOf("function public.business_setup_form_missing_items"), onboardingSql.indexOf("-- ── Called by the client-portal"));
  const keys = new Set([...fn.matchAll(/a ->> '(\w+)'/g)].map((m) => m[1]));
  const covered = new Set([...FIELDS.map(([k]) => k), "services", "partners"]);
  for (const k of keys) assert.ok(covered.has(k), `form answer ${k} cannot be completed by staff`);
});

test("changed answers keep services and the first partner in their stored shape", () => {
  const a = { client_name: "A", services: ["Visa"], partners: [{ name: "P", nationality: "IN", share: 50 }, { name: "Q", nationality: "AE" }] };
  const v = formValues(a);
  assert.equal(v[SERVICES_FIELD], "Visa");
  assert.deepEqual(changedAnswers(v, a), {});
  assert.deepEqual(changedAnswers({ ...v, [SERVICES_FIELD]: "Visa, Ejari ", licence_expiry: "2027-01-01" }, a), { services: ["Visa", "Ejari"], licence_expiry: "2027-01-01" });
  const p = changedAnswers({ ...v, partner_nationality: "UK" }, a);
  assert.deepEqual(p.partners, [{ name: "P", nationality: "UK", share: 50 }, { name: "Q", nationality: "AE" }]);
  assert.equal(changedAnswers(formValues({}), {}).partners, undefined);
});

test("the checklist never claims an invoice in this phase", () => {
  const all = { stage: "Documentation", docs: { quote: true, signed: true, paid: true, letter: true, invoice: true } };
  assert.equal(itemState(all, "invoice"), "Later");
  assert.equal(itemState(all, "signed"), "Done");
  assert.equal(itemState({ stage: "Documentation", docs: {} }, "paid"), "Open");
  assert.equal(itemTone("Later"), undefined);
});

test("pages use the decided rules: superseded is not live, Share link needs the login right, Mark lost on Documentation and Cases", () => {
  const rd = (f) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");
  assert.match(rd("../components/workspace/Quotes.jsx"), /\["rejected", "superseded"\]/);
  assert.match(rd("../components/Leads.jsx"), /setup\.portal\.manage/);
  assert.match(rd("../components/Leads.jsx"), /A manager issues the login\./);
  for (const f of ["DocumentationPage", "Cases", "Leads"]) assert.match(rd(`../components/${f}.jsx`), /LostDialog/);
  for (const f of ["DocumentationPage", "Cases", "Leads"]) assert.match(rd(`../components/${f}.jsx`), /ReassignActions/);
  assert.match(rd("../components/DocumentationPage.jsx"), /caseLinkClient/);
});
