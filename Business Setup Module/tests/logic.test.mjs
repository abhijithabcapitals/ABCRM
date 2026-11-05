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
import { NAV, stageTab, pageKey } from "../logic/nav.js";
import { ageDays, duplicateClient, leadActions } from "../logic/leads.js";

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
  assert.match(sendLine, /^\s*\{can\("setup\.cases\.approve"\) && <Button variant="primary" onClick=\{\(\) => setDialog\("send"\)\}>Send to Accounts<\/Button>\}\s*$/);
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
import { CHECKLIST, itemState, itemTone } from "../logic/checklist.js";
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
  const all = { stage: "Onboarding", docs: { quote: true, quote_accepted: true, letter: true, invoice: true } };
  assert.equal(itemState(all, "invoice"), "Done");
  assert.equal(itemState({ ...all, docs: { ...all.docs, invoice: false } }, "invoice"), "Open");
  assert.equal(itemState({ stage: "Onboarding", docs: {} }, "invoice"), "Open");
  assert.equal(itemState({ stage: "Onboarding" }, "fields"), "Open");
  assert.equal(itemState(all, "quote_accepted"), "Done");
  // checklist_order: the keys are business_setup_case_docs' keys except balance, in the order Onboarding works through them.
  assert.deepEqual(CHECKLIST.map(([k]) => k), ["fields", "documents", "quote", "login", "quote_accepted", "letter", "letter_accepted", "invoice"]);   // no Paid item: a payment blocks nothing
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
  assert.match(rd("../components/ClientOnboarding.jsx"), /<Invoices caseId=\{c\.id\}/);
});

test("pages use the decided rules: superseded is not live, Move needs the owner or the approve right, Mark lost on Documentation and All Leads", () => {
  const rd = (f) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");
  assert.match(rd("../components/workspace/Quotes.jsx"), /\["rejected", "superseded"\]/);
  assert.match(rd("../logic/leads.js"), /setup\.cases\.approve/);
  assert.doesNotMatch(rd("../components/AllLeads.jsx"), /A manager issues the login|ShareLink/);
  for (const f of ["ClientOnboarding", "AllLeads"]) assert.match(rd(`../components/${f}.jsx`), /LostDialog/);
  for (const f of ["ClientOnboarding", "Cases", "AllLeads"]) assert.match(rd(`../components/${f}.jsx`), /ReassignActions/);
  assert.match(rd("../components/ClientOnboarding.jsx"), /caseLinkClient/);
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

test("the fee master shows and saves is_service", () => {
  const src = readFileSync(fileURLToPath(new URL("../components/FeeMaster.jsx", import.meta.url)), "utf8");
  assert.match(src, /name: "is_service"[^}]*type: "bool"/); assert.match(src, /is_service: true/); assert.match(src, /key: "is_service"/);
});

test("nav_order: the nine keys and labels of the client flow", () => {
  assert.deepEqual(NAV.map(([k]) => k), ["dashboard", "leads", "onboarding", "pipeline", "completion", "clients", "services", "tasks", "settings"]);
  assert.deepEqual(NAV.map(([, l]) => l), ["Dashboard", "All Leads", "Client Onboarding", "Pipeline", "Completion", "Clients", "Services & Fees", "Tasks", "⚙ Settings"]);
});

test("each stage opens its own tab, and old page keys map to the new ones", () => {
  assert.deepEqual(["Lead", "Review", "Lost", "Onboarding", "Pipeline", "Completion", "With Accounts"].map(stageTab), ["leads", "leads", "leads", "onboarding", "pipeline", "completion", "completion"]);
  assert.deepEqual(["Completed", "Cancelled"].map(stageTab), ["clients", "clients"]);
  assert.deepEqual(["review", "documentation", "cases", "leads", "clients", "dashboard"].map(pageKey), ["leads", "onboarding", "pipeline", "leads", "clients", "dashboard"]);
  assert.ok(NAV.some(([k]) => k === stageTab("anything else")));
});

test("lead actions: Assign to me on unowned rows only, Move needs the owner or a manager", () => {
  const sales = (p) => ["setup.access", "setup.leads.manage"].includes(p);
  const boss = (p) => ["setup.access", "setup.leads.manage", "setup.cases.approve"].includes(p);
  const unowned = { id: "c", stage: "Lead" };
  assert.equal(leadActions(sales, unowned, "me").assign, true);
  assert.equal(leadActions(sales, { ...unowned, owner_id: "me" }, "me").assign, false);
  assert.equal(leadActions(sales, { ...unowned, owner_id: "other" }, "me").assign, false);
  assert.equal(leadActions(sales, unowned, "me").move, false);
  assert.equal(leadActions(sales, { ...unowned, owner_id: "me" }, "me").move, true);
  assert.equal(leadActions(sales, { ...unowned, owner_id: "other" }, "me").move, false);
  assert.equal(leadActions(boss, { ...unowned, owner_id: "other" }, "me").move, true);
  assert.equal(leadActions(sales, { ...unowned, owner_id: "other" }, "me").reassign, false);
  assert.equal(leadActions(sales, { ...unowned, owner_id: "me" }, "me").reassign, true);
});

test("a duplicate refusal names the existing client, and the age counts whole days", () => {
  assert.deepEqual(duplicateClient("A client like this already exists: CL000012 Acme (same email). Link that client, or confirm this is a new one."), { id: "CL000012" });
  assert.equal(duplicateClient("Something else"), null);
  assert.equal(duplicateClient("A client already exists"), null);
  assert.equal(ageDays("2026-11-01T10:00:00Z", new Date("2026-11-05T09:00:00Z")), 3);
  assert.equal(ageDays(null, new Date()), null);
});

// ── Phase 2, Task 7: reading documents into the client's form ──
import { mergeOcr, fromDocai, ocrRows, ocrPayload } from "../logic/ocrFill.js";

test("merge_fills_empty: an empty field takes the read value", () => {
  const r = mergeOcr({ client_name: "", phone: "  " }, { client_name: "Acme LLC", phone: "0501234567" });
  assert.equal(r.answers.client_name, "Acme LLC"); assert.equal(r.answers.phone, "0501234567");
  assert.deepEqual(r.conflicts, []);
  assert.equal(mergeOcr({}, { email: "a@b.ae" }).answers.email, "a@b.ae");
});

test("merge_keeps_value: a filled field stays, and the difference is in conflicts", () => {
  const r = mergeOcr({ client_name: "Acme LLC", email: "a@b.ae" }, { client_name: "ACME Trading", email: " A@B.AE " });
  assert.equal(r.answers.client_name, "Acme LLC");
  assert.deepEqual(r.conflicts, [{ key: "client_name", current: "Acme LLC", read: "ACME Trading" }]);   // the same email in another case or spacing is no conflict
});

test("merge_ignores_unknown: a read key not on the form is dropped", () => {
  const r = mergeOcr({}, { favourite_colour: "blue", client_name: "Acme" });
  assert.equal("favourite_colour" in r.answers, false); assert.equal(r.answers.client_name, "Acme");
  assert.deepEqual(r.conflicts, []);
});

test("merge never changes the answers it was given, and skips empty reads", () => {
  const a = { client_name: "" }; const before = JSON.stringify(a);
  const r = mergeOcr(a, { client_name: "Acme", phone: "", email: null });
  assert.equal(JSON.stringify(a), before);
  assert.equal("phone" in r.answers, false); assert.equal("email" in r.answers, false);
});

test("partners are filled only while the form has none", () => {
  const read = { partners: [{ name: "Sara", nationality: "India" }] };
  assert.deepEqual(mergeOcr({ partners: [] }, read).answers.partners, read.partners);
  assert.deepEqual(mergeOcr({ partners: [{ name: "Omar", nationality: "UAE" }] }, read).answers.partners, [{ name: "Omar", nationality: "UAE" }]);
});

test("docai results become form values: licence fields, people as partners, low confidence skipped, first document wins", () => {
  const docs = [
    { name: "licence.pdf", extraction: { fields: [{ key: "legal_name", value: "Acme LLC" }, { key: "licence_number", value: "L-1" }, { key: "licence_authority", value: "IFZA" }, { key: "licence_expiry_date", value: "2027-03-01" }, { key: "main_activity", value: "Trading", confidence: "low" }, { key: "email", value: "a@b.ae" }] } },
    { name: "moa.pdf", extraction: { fields: [{ key: "legal_name", value: "Acme Trading LLC" }], people: [{ name: "Sara Khan", nationality: "India" }, { name: "No Nation" }] } },
  ];
  const { read, sources, disagree } = fromDocai(docs);
  assert.deepEqual(read, { client_name: "Acme LLC", licence_number: "L-1", issuing_authority: "IFZA", licence_expiry: "2027-03-01", email: "a@b.ae", partners: [{ name: "Sara Khan", nationality: "India" }] });
  assert.equal(sources.client_name, "licence.pdf");
  assert.deepEqual(disagree, { client_name: ["Acme LLC (licence.pdf)", "Acme Trading LLC (moa.pdf)"] });
  assert.equal("licence_expiry" in fromDocai([{ name: "x", extraction: { fields: [{ key: "licence_expiry_date", value: "01/03/2027" }] } }]).read, false);   // only a date the form can store
});

test("rows for staff: empty fields are ticked, a difference is not, and only ticked values are saved", () => {
  const answers = { client_name: "Acme LLC", phone: "" };
  const read = { client_name: "ACME Trading", phone: "0501234567", email: "a@b.ae" };
  const rows = ocrRows(answers, read, { phone: "pass.pdf" });
  assert.deepEqual(rows.map((r) => [r.key, r.state, r.tick]), [["client_name", "differs", false], ["phone", "new", true], ["email", "new", true]]);
  assert.equal(rows[1].source, "pass.pdf"); assert.equal(rows[0].label, "Client name");
  assert.deepEqual(ocrPayload(rows, { phone: true, email: false, client_name: true }), { client_name: "ACME Trading", phone: "0501234567" });
  assert.deepEqual(ocrPayload(rows, Object.fromEntries(rows.map((r) => [r.key, r.tick]))), { phone: "0501234567", email: "a@b.ae" });
});
