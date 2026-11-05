import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expiryNote } from "../logic/expiries.js";
import { kycMissing, kycLabel, kycTone } from "../logic/kyc.js";
import { buildLines, lineTotals, lineError, withRates } from "../logic/lines.js";
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
  assert.deepEqual(a, { service_name: "Trade licence", action: "New", fee_item_id: "f1", description: "Trade licence", amount: 100, remarks: "", scope: "", vat_rate: 5 });
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

test("the checklist shows the real state of the invoice: Done on an invoice or the override, else Open", () => {
  const all = { stage: "Documentation", docs: { quote: true, signed: true, paid: true, letter: true, invoice: true } };
  assert.equal(itemState(all, "invoice"), "Done");
  assert.equal(itemState({ ...all, docs: { ...all.docs, invoice: false } }, "invoice"), "Open");
  assert.equal(itemState({ stage: "Documentation", docs: {} }, "invoice"), "Open");
  assert.equal(itemState(all, "signed"), "Done");
  assert.equal(itemState({ stage: "Documentation", docs: {} }, "paid"), "Open");
  assert.equal(itemTone("Done"), "good");
  assert.equal(itemTone("Open"), "warn");
});

test("the Clients list and the Overview work out the KYC label with one rule", () => {
  // The case found live: CL000001 has no stored state and nothing missing, so the Overview said Complete while the list said Not done.
  assert.equal(kycLabel(null, []), "Complete");
  assert.equal(kycLabel(undefined, []), "Complete");
  assert.equal(kycLabel(null, ["email"]), "Not done");
  assert.equal(kycLabel("Done", ["email"]), "Done");
  assert.equal(kycLabel(null, undefined), "Not done");
  assert.equal(kycLabel("Done", null), "Done"); // the list leaves kyc_missing null when a state is stored
  assert.equal(kycLabel("Pending", null), "Pending");
  assert.equal(kycTone("Complete"), "good"); assert.equal(kycTone("Done"), "good"); assert.equal(kycTone("Not done"), "warn");
  const rd = (f) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");
  for (const f of ["../components/Clients.jsx", "../components/workspace/Overview.jsx"]) assert.match(rd(f), /kycLabel\(/, f);
  assert.match(rd("../components/Clients.jsx"), /kycLabel\(r\.kyc_state, r\.kyc_missing\)/);
  assert.doesNotMatch(rd("../components/Clients.jsx"), /kyc_state === "Done"/);
});

test("the old Zoho placeholder panel has left the Business Setup quote screen; main's ZohoPanel replaces it in both modules", () => {
  const rd = (f) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");
  assert.doesNotMatch(rd("../components/workspace/Quotes.jsx"), /ZohoInvoicePanel/);
  assert.match(rd("../components/workspace/Quotes.jsx"), /<ZohoPanel /);
  assert.match(rd("../../Banking Module/components/BankProcess.jsx"), /<ZohoPanel /);
});

test("invoices are recorded through the database function, with the file under the client's invoice folder", () => {
  const rd = (f) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");
  const inv = rd("../components/workspace/Invoices.jsx");
  assert.match(inv, /invoiceRecord\(\{ \.\.\.v, case_id: caseId, file_path \}\)/);
  assert.match(inv, /uploadFile\(caseRow\.client_id, scan, "invoice"\)/);
  assert.match(rd("../components/DocumentationPage.jsx"), /<Invoices caseId=\{c\.id\}/);
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

// ── Phase 2, Task 7: suggested amounts and line VAT ──
test("line totals add VAT line by line, rounded per line", () => {
  assert.deepEqual(lineTotals([{ amount: 1000, vat_rate: 5 }, { amount: 500, vat_rate: 0 }]), { net: 1500, vat: 50, total: 1550 });
  assert.deepEqual(lineTotals([{ amount: 33.33, vat_rate: 5 }]), { net: 33.33, vat: 1.67, total: 35 });
  assert.deepEqual(lineTotals([{ amount: "100" }, { amount: "" }]), { net: 100, vat: 5, total: 105 });
  assert.deepEqual(lineTotals([]), { net: 0, vat: 0, total: 0 });
});

test("a line needs a service and a typed fee: the grey stored amount is not a fee, and zero is", () => {
  assert.equal(lineError([{ service_name: "Visa", amount: "", stored_amount: 900 }]), "Each line needs a service and a fee.");
  assert.equal(lineError([{ service_name: "Visa", amount: 0 }]), null);
  assert.equal(lineError([{ service_name: " ", amount: 10 }]), "Each line needs a service and a fee.");
  assert.equal(lineError([{ service_name: "Visa", amount: -1 }]), "Each line needs a service and a fee.");
  assert.equal(lineError([{ service_name: "Visa", amount: "12" }, { service_name: "Fee", amount: "" }]), "Each line needs a service and a fee.");
  assert.equal(lineError([]), "Add at least one service.");
});

test("lines carry scope and the rate; a fee item's rate wins over one stored on an older line", () => {
  const [a] = buildLines([{ service_name: "Visa", amount: 10, scope: " Employment visa ", vat_rate: 0 }]);
  assert.equal(a.scope, "Employment visa");
  assert.equal(a.vat_rate, 0);
  const rows = withRates([{ service_name: "A", fee_item_id: "f0", vat_rate: 5 }, { service_name: "B", vat_rate: 0 }, { service_name: "C" }], [{ id: "f0", vat_rate: 0 }]);
  assert.deepEqual(rows.map((r) => r.vat_rate), [0, 0, 5]);
});

test("the quote screen shows the stored amount as a placeholder with a Use button, has no VAT select, and shows net, VAT and total", () => {
  const flow = readFileSync(fileURLToPath(new URL("../components/NewServiceFlow.jsx", import.meta.url)), "utf8");
  assert.match(flow, /placeholder=\{r\.stored_amount/);
  assert.match(flow, /Use \{/);
  assert.match(flow, /Scope of work/);
  assert.doesNotMatch(flow, /id="bs-vat"/);
  assert.doesNotMatch(flow, /amount: f\.default_amount/);
  assert.match(flow, /lineError\(/);
  for (const w of ["Net", "VAT", "Total"]) assert.ok(flow.includes(w), w);
  assert.doesNotMatch(flow, /vat_mode: vat/);
});

test("the fee list handles an empty amount and edits the VAT rate", () => {
  const fm = readFileSync(fileURLToPath(new URL("../components/FeeMaster.jsx", import.meta.url)), "utf8");
  assert.match(fm, /vat_rate/);
  assert.doesNotMatch(fm, /name: "default_amount"[^}]*required: true/);
  assert.match(fm, /r\.default_amount === null/);
});

// ── Fix round 1: the screen rounds as the database does, in whole fils ──
test("line VAT rounds half up exactly: 42.70 and 10.10 at 5%", () => {
  assert.equal(lineTotals([{ amount: 42.7, vat_rate: 5 }]).vat, 2.14);
  assert.equal(lineTotals([{ amount: 10.1, vat_rate: 5 }]).vat, 0.51);
  assert.deepEqual(lineTotals([{ amount: 42.7, vat_rate: 5 }]), { net: 42.7, vat: 2.14, total: 44.84 });
});

test("line VAT matches an exact integer half-up calculation for every amount from 0.01 to 3000.00", () => {
  for (let f = 1; f <= 300000; f++) {
    const want = Math.floor((f * 5 + 50) / 100);   // integer fils, half up
    const got = Math.round(lineTotals([{ amount: f / 100, vat_rate: 5 }]).vat * 100);
    if (got !== want) assert.fail(`${f / 100}: showed ${got} fils, expected ${want}`);
  }
});

test("a fee with more than two decimals is refused, two are fine, and the fee input steps by 0.01", () => {
  assert.equal(lineError([{ service_name: "Visa", amount: "10.555" }]), "A fee can have at most two decimals.");
  assert.equal(lineError([{ service_name: "Visa", amount: "33.33" }]), null);
  assert.equal(lineError([{ service_name: "Visa", amount: 10.5 }]), null);
  const flow = readFileSync(fileURLToPath(new URL("../components/NewServiceFlow.jsx", import.meta.url)), "utf8");
  assert.match(flow, /step="0\.01"/);
});

test("revising a quote whose lines included VAT says that VAT is now added on top", () => {
  const flow = readFileSync(fileURLToPath(new URL("../components/NewServiceFlow.jsx", import.meta.url)), "utf8");
  assert.match(flow, /revises\.vat_mode !== "exclusive"/);
  assert.match(flow, /This quote's lines included VAT\. Check each fee, as VAT is now added on top\./);
});
