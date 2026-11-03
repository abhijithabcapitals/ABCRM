import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expiryNote } from "../logic/expiries.js";
import { kycMissing } from "../logic/kyc.js";
import { buildLines } from "../logic/lines.js";
import { balance, canStart, canComplete, isRegistration } from "../logic/balances.js";
import { SERVICE_STATUSES } from "../logic/statuses.js";
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
  const panel = readFileSync(fileURLToPath(new URL("../components/ZohoInvoicePanel.jsx", import.meta.url)), "utf8");
  assert.ok(bank.indexOf("<ZohoInvoicePanel />") > 0 && bank.indexOf("<ZohoInvoicePanel />") < bank.indexOf('id="bk-complete"'));
  assert.doesNotMatch(panel, /disabled|onClick|rpc\(/);
  assert.match(panel, /You can still send this to Accounts/);
});

test("the quote screen sends every contact field the database asks for", () => {
  const flow = readFileSync(fileURLToPath(new URL("../components/NewServiceFlow.jsx", import.meta.url)), "utf8");
  for (const f of ["client_id", "client_name", "contact_name", "contact_email", "contact_phone", "client_address", "lines", "template_key"]) assert.match(flow, new RegExp(`\b${f}\b`), f);
});

test("private price files are ignored by the repository itself", () => {
  const ignore = readFileSync(fileURLToPath(new URL("../../.gitignore", import.meta.url)), "utf8");
  assert.match(ignore, /Database Module\/Business Setup Base\/private\//);
  assert.match(ignore, /\.superpowers\//);
});
