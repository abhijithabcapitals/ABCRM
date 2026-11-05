// node --test "Template Module/tests/libraryData.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { mergeAutofill, fromClientMaster, clientLinkProblem } from "../logic/libraryOcr.js";
import { libraryContext, toLines } from "../logic/libraryContext.js";
import { fmtMoney } from "../logic/helpers.js";

const auto = (values = {}, extra = {}) => ({ values, sources: {}, conflicts: {}, shareholders: [], ...extra });

test("fills empty fields only and never overwrites a typed value", () => {
  const r = mergeAutofill({ client_name: "Typed Co", contact_email: "  " },
    auto({ legal_name: "OCR Co", company_email: "a@b.ae", company_phone: "0501" }));
  assert.equal(r.values.client_name, "Typed Co");
  assert.equal(r.values.contact_email, "a@b.ae");
  assert.equal(r.values.contact_phone, "0501");
  assert.deepEqual(r.filled.sort(), ["business_name", "contact_email", "contact_phone"]);
});

test("maps address, activity, business name and ardentax tags", () => {
  const r = mergeAutofill({}, auto({ registered_address: "", office_address: "Office 1", business_activity: "Trading",
    trade_name: "TN", legal_name: "LN", license_number: "L1", vat_trn: "1001" }));
  assert.equal(r.values.client_address, "Office 1");
  assert.equal(r.values.business_activity, "Trading");
  assert.equal(r.values.business_name, "TN");
  assert.equal(r.values.trade_name, "TN");
  assert.equal(r.values.license_number, "L1");
  assert.equal(r.values.vat_trn, "1001");
  assert.equal(mergeAutofill({}, auto({ legal_name: "LN" })).values.business_name, "LN");
});

test("disagreeing documents become conflicts with both readings", () => {
  const r = mergeAutofill({}, auto({ legal_name: "A LLC" }, { conflicts: { legal_name: ["A LLC (licence)", "A L.L.C (MoA)"], office_address: ["x (y)"], passport_number: ["1 (p)", "2 (q)"] } }));
  assert.deepEqual(r.conflicts.client_name, ["A LLC (licence)", "A L.L.C (MoA)"]);
  assert.deepEqual(r.conflicts.client_address, ["x (y)"]);
  assert.equal(r.conflicts.passport_number, undefined);
});

test("first person on an ID fills contact_name", () => {
  const r = mergeAutofill({}, auto({}, { shareholders: [{ full_name: "Ali Khan", nationality: "PK" }, { full_name: "Zed" }] }));
  assert.equal(r.values.contact_name, "Ali Khan");
  assert.ok(r.filled.includes("contact_name"));
});

test("no ID number reaches values", () => {
  const r = mergeAutofill({}, auto({ legal_name: "A", passport_number: "P123", emirates_id: "784-1" },
    { shareholders: [{ full_name: "Ali", passport_number: "P123", emirates_id: "784-1" }] }));
  assert.equal(JSON.stringify(r).includes("P123"), false);
  assert.equal(JSON.stringify(r).includes("784-1"), false);
  assert.equal("passport_number" in r.values, false);
  assert.equal("emirates_id" in r.values, false);
});

test("Client Master keys map to tags", () => {
  const v = fromClientMaster({ client_id: 7, data: { "Client Legal Name": "Acme", "Primary Contact": "Bob", "General Email": "b@a.ae", "General Phone": "04", "Registered Address": "Dubai", "Passport No": "X" } });
  assert.deepEqual(v, { client_id: 7, client_name: "Acme", contact_name: "Bob", contact_email: "b@a.ae", contact_phone: "04", client_address: "Dubai" });
});

test("context has ref_no, items and totals", () => {
  const c = libraryContext({ client_name: "Acme", date: "2026-11-05" }, [{ label: "Licence", amount: 1000 }, { label: "Visa", amount: "500" }], 4, "ABC/1");
  assert.equal(c.ref_no, "ABC/1");
  assert.equal("quotation_no" in c, false);
  assert.equal(c.items.length, 2);
  assert.equal(c.total, fmtMoney(1500));
  assert.equal(c.total, "1,500");
  assert.equal(c.items[0].amount, "1,000");
  assert.equal(c.items[0].sl, 1);
  assert.equal(c.date, "05/11/2026");
  assert.equal(c.usd_rate, "4");
  assert.equal(libraryContext({}, [], "", "R").usd_rate, "3.6725");
});

test("date not in ISO form is left as given", () => {
  assert.equal(libraryContext({ date: "05 Nov 2026" }, [], 0, "R").date, "05 Nov 2026");
});

test("USD column sums rounded lines at the given rate", () => {
  const c = libraryContext({}, [{ label: "A", amount: 10 }, { label: "B", amount: 10 }, { label: "C", amount: 10 }], 4, "R");
  assert.deepEqual(c.items.map((i) => i.amount_usd), ["3", "3", "3"]); // 2.5 rounds up
  assert.equal(c.total_usd, "9");
});

test("rate and remarks stay on each item", () => {
  const c = libraryContext({}, [{ label: "A", amount: 1, remarks: "once", rate: "10%" }, { label: "", amount: 5 }, { label: "B", amount: 2, rate: 5 }], 3.6725, "R");
  assert.equal(c.items.length, 2);
  assert.equal(c.items[0].rate, "10%");
  assert.equal(c.items[0].remarks, "once");
  assert.equal(c.items[1].rate, 5);
  assert.equal(c.items[1].remarks, "");
  assert.deepEqual(toLines([{ label: "A", amount: "1,200", remarks: "r", rate: "x" }, { label: " ", amount: 1 }]),
    [{ description: "A", amount: 1200, remarks: "r", rate: "x" }]);
});

test("control characters are stripped from every value", () => {
  const c = libraryContext({ client_name: "A\x0BB", n: 3 }, [{ label: "L\x00x", amount: 1, remarks: "r\x1Fz", rate: "p\x0Cq" }], 3.6725, "R\x08/1");
  assert.equal(c.client_name, "AB");
  assert.equal(c.n, 3);
  assert.equal(c.ref_no, "R/1");
  assert.equal(c.items[0].label, "Lx");
  assert.equal(c.items[0].remarks, "rz");
  assert.equal(c.items[0].rate, "pq");
  assert.equal(toLines([{ label: "L\x0Bx", amount: 1 }])[0].description, "Lx");
});

test("empty rows are dropped", () => {
  const c = libraryContext({}, [{ label: "", amount: 100 }, { label: "  ", amount: "" }, { label: "Real", amount: 1 }], 3.6725, "R");
  assert.equal(c.items.length, 1);
  assert.equal(c.total, "1");
  assert.equal(libraryContext({}, [{}], 3.6725, "R").items.length, 0);
});

test("non-numeric amount on a labelled row throws naming the row", () => {
  assert.throws(() => libraryContext({}, [{ label: "Licence", amount: "abc" }], 3.6725, "R"), /Licence/);
  assert.throws(() => libraryContext({}, [{ label: "Visa", amount: "" }], 3.6725, "R"), /Visa/);
  assert.throws(() => toLines([{ label: "Fee", amount: "x" }]), /Fee/);
});

test("Primary Contact with several names gives the first", () => {
  assert.equal(fromClientMaster({ client_id: "C", data: { "Primary Contact": "A One; B Two" } }).contact_name, "A One");
});

test("clientLinkProblem ignores case and an empty link", () => {
  assert.equal(clientLinkProblem("", "Anyone"), null);
  assert.equal(clientLinkProblem("Sample LLC", "SAMPLE llc"), null);
  assert.match(clientLinkProblem("Sample LLC", "Other"), /linked to Sample LLC/);
});

test("every date field shows as DD/MM/YYYY; other text stays", () => {
  const ctx = libraryContext({ date: "2026-11-05", prepared_date: "2026-01-02", acceptance_date: "Yes", ref: "2026-01-02" }, [], 3.6725, "R");
  assert.equal(ctx.date, "05/11/2026");
  assert.equal(ctx.prepared_date, "02/01/2026");
  assert.equal(ctx.acceptance_date, "Yes");
  assert.equal(ctx.ref, "2026-01-02");
});
