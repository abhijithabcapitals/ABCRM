// node --test "Client Module/tests/"
import test from "node:test";
import assert from "node:assert/strict";
import { compliance, vatPeriodEndMonths } from "../crm/taxLogic.js";
import { NA, NP, VR_SUFFIX, complete, fillFromClient, fillFromDocuments, listFromCell, listToCell, FIELDS, parseUaeDate, findListedClient } from "../crm/masterLogic.js";
import { applyClient, clientKeyOf, findClient } from "../../Banking Module/logic/clientLookup.js";

const TODAY = new Date(Date.UTC(2026, 9, 29));
const items = (rec) => compliance([{ "Client ID": "CL000001", "Client Legal Name": "Sample Trading LLC", ...rec }], TODAY).items;
const find = (its, title) => its.find((i) => i.title === title);

test("unrecorded registrations are missing, not guessed", () => {
  const its = items({});
  assert.equal(find(its, "VAT registration status not recorded").status, "missing");
  assert.equal(find(its, "Corporate Tax registration status not recorded").status, "missing");
  assert.ok(its.every((i) => i.dueDate === ""));
});
test("quarterly VAT is due 28 days after period end", () => {
  const its = items({ "VAT Registered": "Yes", TRN: "100000000000003", "VAT Filing Frequency": "Quarterly", "VAT Tax Period": "Feb-Apr / May-Jul / Aug-Oct / Nov-Jan" });
  const vat = find(its, "VAT return & payment");
  assert.equal(vat.period, "Period ending 31/10/2026");
  assert.equal(vat.dueDate, "28/11/2026");
  assert.equal(vat.status, "due_30");
  assert.equal(vat.computed, true);
  assert.ok(!find(its, "VAT return – confirm filed"));
});
test("monthly VAT with a recent due date asks to confirm filing", () => {
  const its = items({ "VAT Registered": "Yes", TRN: "1", "VAT Filing Frequency": "Monthly", "VAT Tax Period": "Monthly" });
  const c = find(its, "VAT return – confirm filed");
  assert.equal(c.dueDate, "28/10/2026");
  assert.equal(c.status, "review");
  assert.equal(find(its, "VAT return & payment").dueDate, "28/11/2026");
});
test("VAT gaps are flagged and inconsistent quarters are not guessed", () => {
  const t = items({ "VAT Registered": "Yes", "VAT Filing Frequency": "Quarterly", "VAT Tax Period": "Not Provided" }).map((i) => i.title);
  assert.ok(t.includes("VAT TRN missing") && t.includes("VAT tax period unclear") && !t.includes("VAT return & payment"));
  assert.equal(vatPeriodEndMonths("Quarterly", "Jan-Mar / May-Jul"), null);
  assert.deepEqual(vatPeriodEndMonths("Quarterly", "Jan-Mar"), [3, 6, 9, 12]);
  assert.equal(vatPeriodEndMonths("Other", "Jan-Mar"), null);
});
test("a confirmed VAT due date wins", () => {
  const v = find(items({ "VAT Registered": "Yes", TRN: "1", "VAT Return Due Date": "15/11/2026", "VAT Filing Frequency": "Quarterly", "VAT Tax Period": "Feb-Apr / May-Jul / Aug-Oct / Nov-Jan" }), "VAT return & payment");
  assert.equal(v.dueDate, "15/11/2026");
  assert.equal(v.computed, false);
});
test("CT return is nine months after the financial year", () => {
  const ct = find(items({ "Corporate Tax Registered": "Yes", "CT Registration Number": "1", "Financial Year": "01/01 - 31/12" }), "Corporate Tax return & payment");
  assert.equal(ct.period, "Tax period ending 31/12/2025");
  assert.equal(ct.dueDate, "30/09/2026");
  assert.equal(ct.status, "overdue");
});
test("CT filed, first period, not registered, missing number", () => {
  assert.equal(find(items({ "Corporate Tax Registered": "Yes", "CT Registration Number": "1", "Financial Year": "01/01 - 31/12", "CT Return Status": "Filed" }), "Corporate Tax return & payment").status, "done");
  assert.ok(!find(items({ "Corporate Tax Registered": "Yes", "CT Registration Number": "1", "CT Tax Period": "01/04/2023 - 31/03/2024" }), "Corporate Tax return & payment"));
  assert.equal(find(items({ "Corporate Tax Registered": "No" }), "Corporate Tax registration needed?").status, "review");
  assert.equal(find(items({ "Corporate Tax Registered": "Yes", "Financial Year": "01/01 - 31/12" }), "CT registration number missing").status, "missing");
});
test("renewals, verification marks and urgency order", () => {
  const its = items({ "License Expiry Date": "10/11/2026", "Renewal Date": "01/10/2026", "Trade License Number": "12345" });
  const lic = find(its, "Trade licence renewal");
  assert.equal(lic.status, "due_14");
  assert.equal(lic.daysLeft, 12);
  assert.equal(find(its, "Engagement renewal").status, "overdue");
  assert.equal(find(items({ "Trade License Number": "12345" }), "Trade licence expiry date missing").status, "missing");
  assert.equal(find(items({ "License Expiry Date": `10/12/2026${VR_SUFFIX}` }), "Trade licence renewal").verify, true);
  const order = compliance([{ "Client ID": "CL1", "Client Legal Name": "B", "License Expiry Date": "01/01/2027" }, { "Client ID": "CL2", "Client Legal Name": "A", "License Expiry Date": "01/10/2026" }], TODAY).items.map((i) => i.status);
  assert.ok(order.indexOf("overdue") < order.indexOf("upcoming") && order.indexOf("upcoming") < order.indexOf("missing"));
});

test("master: blanks, conditions, score, review and blank-never-overwrites", () => {
  const r = complete({ "Client Legal Name": "ABC LLC", "VAT Registered": "yes", "Payroll Applicable": "No" }, null, TODAY);
  assert.equal(r.record["Trade Name"], NP);
  assert.equal(r.record["VAT Registered"], "Yes");
  assert.equal(r.record.TRN, NP);
  assert.equal(r.record["Employee Count"], NA);
  assert.ok(r.review.includes("VAT Information Incomplete"));
  assert.ok(r.missing.includes("TRN"));
  assert.ok(r.score < 50);
  assert.equal(r.band, "High Attention Required");
  const u = complete({ "Client Legal Name": "", "Trade Name": "New" }, r.record, TODAY);
  assert.equal(u.record["Client Legal Name"], "ABC LLC");
  assert.equal(u.record["Trade Name"], "New");
});
test("master: errors and validation flags", () => {
  assert.match(complete({}, null, TODAY).errors[0], /Legal Name/);
  assert.match(complete({ "Client Legal Name": "A", "Risk Level": "High" }, null, TODAY).errors[0], /Risk Reason/);
  const r = complete({ "Client Legal Name": "A", TRN: "123", "VAT Registered": "Yes", "License Expiry Date": "01/01/2020", Shareholders: "X – Ownership: 60% – Type: Corporate" }, null, TODAY).review;
  for (const t of ["TRN Format Check (expected 15 digits)", "License Expired / Review Required", "Shareholding Totals 60% (expected 100%)", "UBO Verification Required (corporate shareholder)"]) assert.ok(r.includes(t), t);
  assert.ok(complete({ "Client Legal Name": `A${VR_SUFFIX}` }, null, TODAY).review.includes("Verify: Client Legal Name"));
});
test("master: contact roles fill the role columns and lists round-trip", () => {
  const f = FIELDS["Contact Details"];
  const cell = listToCell([{ Name: "Sara Ali", Email: "s@x.com", Roles: "Primary/Finance" }], f);
  assert.deepEqual(listFromCell(cell, f), [{ Name: "Sara Ali", Email: "s@x.com", Roles: "Primary/Finance" }]);
  const r = complete({ "Client Legal Name": "A", "Contact Details": listToCell([{ Name: "Sara", Roles: "Primary/Finance" }], f) }, null, TODAY).record;
  assert.equal(r["Primary Contact"], "Sara");
  assert.equal(r["Finance Contact"], "Sara");
  assert.equal(parseUaeDate("31/02/2026"), null);
});
test("documents fill empty fields, mark unsure ones and leave different readings", () => {
  const docs = [{ name: "lic.pdf", doc_type: "TradeLicence", extraction: { fields: [{ key: "legal_name", value: "ABC LLC", confidence: "high" }, { key: "licence_number", value: "77", confidence: "medium" }, { key: "licence_expiry_date", value: "2027-01-31", confidence: "high" }, { key: "emirate", value: "Dubai", confidence: "high" }] } }];
  const r = fillFromDocuments({ Emirate: "Sharjah" }, docs);
  assert.equal(r.values["Client Legal Name"], "ABC LLC");
  assert.equal(r.values["Trade License Number"], `77${VR_SUFFIX}`);
  assert.equal(r.values["License Expiry Date"], "31/01/2027");
  assert.equal(r.values.Emirate, "Sharjah");
  assert.match(r.conflicts[0], /Emirate: Sharjah \/ Dubai/);
  assert.match(r.values["Corporate Documents Status"], /Trade License: Under Review/);
});

const CLIENTS = [{ name: "Ace FZCO", trade_name: "Ace", contact: "Asha", email: "a@ace.ae", phone: "+971 50 123 4567", license: "L-77", trn: "100", address: "Dubai" }, { name: "Beta LLC", contact: "Ben", email: "b@beta.ae" }];
const MAP = { client: "name", contact: "contact", email: "email", phone: "phone", license: "license", address: "address" };
test("lookup finds a client by any identifying detail", () => {
  assert.equal(findClient(CLIENTS, "name", " ace ").name, "Ace FZCO");
  assert.equal(findClient(CLIENTS, "phone", "050 123 4567").name, "Ace FZCO");
  assert.equal(findClient(CLIENTS, "license", "l77").name, "Ace FZCO");
  assert.equal(findClient(CLIENTS, "email", "nobody@x.ae"), null);
  assert.equal(findClient(CLIENTS, "phone", "123"), null);
  assert.equal(findClient(CLIENTS, "email", ""), null);
});
test("choosing a name fills everything; another detail fills only blanks; values stay editable", () => {
  const a = applyClient({ contact: "Old" }, MAP, "client", "Ace FZCO", CLIENTS);
  assert.equal(a.contact, "Asha");
  assert.equal(a.address, "Dubai");
  const b = applyClient({ contact: "Mine", client: "" }, MAP, "email", "a@ace.ae", CLIENTS);
  assert.equal(b.contact, "Mine");
  assert.equal(b.client, "Ace FZCO");
  const c = applyClient(a, MAP, "contact", "Changed", CLIENTS);
  assert.equal(c.contact, "Changed");
  assert.equal(c.address, "Dubai");
  assert.deepEqual(applyClient({}, MAP, "client", "Unknown", CLIENTS), { client: "Unknown" });
  const beta = applyClient({ phone: "kept" }, MAP, "client", "Beta LLC", CLIENTS);
  assert.equal(beta.phone, "kept");
});
test("template fields are matched to client details", () => {
  assert.equal(clientKeyOf({ key: "client_name", label: "Client name" }), "name");
  assert.equal(clientKeyOf({ key: "business_name", label: "Business" }), "name");
  assert.equal(clientKeyOf({ key: "mobile", label: "Mobile" }), "phone");
  assert.equal(clientKeyOf({ key: "visa_fee", label: "Visa", fee: true }), null);
  assert.equal(clientKeyOf({ key: "freezone", label: "Freezone" }), null);
});

test("a client opened from a notification is found by master id or list id, otherwise not at all", () => {
  const rows = [{ id: "u1", client_master_id: "CL000001" }, { id: "u2", client_master_id: null }];
  assert.equal(findListedClient(rows, "CL000001").id, "u1");
  assert.equal(findListedClient(rows, "u2").id, "u2");
  assert.equal(findListedClient(rows, "CL999999"), null);
  assert.equal(findListedClient(null, "CL000001"), null);
});
