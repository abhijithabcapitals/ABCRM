// node --test "Template Module/tests/accountingQuote.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { BASES, blankOption, optionFromPackage, serviceAmount, totalsByBasis, registerAmount, registerLabel, checkQuote, toQuotePayload, isAccountingQuote, isAccountingAgreement, quoteContext } from "../logic/accountingQuote.js";

const svc = (name, basis, amount, subs = []) => ({ name, basis, amount, subs });
const opt = (name, services) => ({ package_key: "k", name, description: "", notes: [], services });
const quote = (options, accepted = null) => ({ accepted_option: accepted, options, shared: { scope: ["S1"], payment: ["P1"], notes: ["N1"] } });
const form = { client_name: "Test Client", contact_name: "Pat", contact_email: "pat@example.com", contact_phone: "0500000000" };

test("bases carry the exact keys, labels and printed words", () => {
  assert.deepEqual(BASES.map((b) => [b.key, b.label]), [["month", "Per month"], ["quarter", "Per quarter"], ["year", "Per year"], ["once", "One-time"], ["included", "Included"], ["separate", "Charged separately"], ["na", "NA"]]);
  assert.deepEqual(BASES.slice(4).map((b) => b.printed), ["Included in the above mentioned fees", "Will be charged separately", "NA"]);
  assert.deepEqual(BASES.map((b) => b.priced), [true, true, true, true, false, false, false]);
});

test("totalsByBasis never adds different bases", () => {
  const o = opt("A", [svc("a", "month", 100), svc("b", "month", null, [{ name: "x", amount: 30 }, { name: "y", amount: 20 }]), svc("c", "once", 500), svc("d", "included", null)]);
  assert.deepEqual(totalsByBasis(o), [{ basis: "month", label: "Per month", total: 150 }, { basis: "once", label: "One-time", total: 500 }]);
});

test("serviceAmount", () => {
  assert.equal(serviceAmount(svc("a", "included", null)), null);
  assert.equal(serviceAmount(svc("a", "month", "100")), 100);
  assert.equal(serviceAmount(svc("a", "month", null, [{ name: "x", amount: 30.1 }, { name: "y", amount: 20.2 }])), 50.3);
});

test("registerAmount and registerLabel", () => {
  const m = opt("A", [svc("a", "month", 150)]);
  const once = opt("B", [svc("a", "once", 500)]);
  const none = opt("C", [svc("a", "included", null)]);
  assert.deepEqual(registerAmount(opt("D", [svc("a", "year", 9), svc("b", "once", 5), svc("c", "month", 1)])), { amount: 1, basis: "month" });
  assert.deepEqual(registerAmount(opt("D", [svc("b", "once", 5), svc("a", "year", 9)])), { amount: 9, basis: "year" });
  assert.deepEqual(registerAmount(none), { amount: 0, basis: null });
  assert.equal(registerLabel({ field_values: { quote: quote([m, once]) } }), "AED 150 per month (Option 1 of 2)");
  assert.equal(registerLabel({ field_values: { quote: quote([once]) } }), "AED 500 one-time");
  assert.equal(registerLabel({ field_values: { quote: quote([none]) } }), "No fixed fee (Option 1 of 1)");
  assert.equal(registerLabel({ field_values: { quote: quote([m, once], 1) } }), "AED 500 one-time (Option 2 of 2)");
});

test("checkQuote names the problem", () => {
  const ok = quote([opt("A", [svc("a", "month", "100")])]);
  assert.equal(checkQuote(form, ok), null);
  assert.match(checkQuote(form, quote([])), /option/i);
  assert.match(checkQuote(form, quote([opt(" ", [svc("a", "month", "1")])])), /name/i);
  for (const bad of ["", "-1", "abc"]) assert.match(checkQuote(form, quote([opt("A", [svc("Bookkeeping", "month", bad)])])), /amount.*Bookkeeping/i);
  assert.match(checkQuote(form, quote([opt("A", [svc("Bookkeeping", "month", "5", [{ name: "x", amount: "5" }])])])), /Bookkeeping.*sub|sub.*Bookkeeping/i);
  assert.match(checkQuote({ ...form, contact_email: "nope" }, ok), /email/i);
});

test("toQuotePayload cleans amounts", () => {
  const q = quote([opt("A", [svc("a", "month", "1,000"), svc("b", "included", "9"), svc("c", "once", "", [{ name: "x", amount: "2,5" .replace(",", "") }])])]);
  const p = toQuotePayload(form, q, "cid");
  assert.equal(p.client_id, "cid");
  assert.equal(p.client_name, "Test Client");
  assert.equal(p.contact_email, "pat@example.com");
  const s = p.quote.options[0].services;
  assert.equal(s[0].amount, 1000);
  assert.equal(s[1].amount, null);
  assert.deepEqual(s[2].subs, [{ name: "x", amount: 25 }]);
});

test("document kinds", () => {
  assert.equal(isAccountingQuote({ library_template: "AB Capital/Accounting Quote" }), true);
  assert.equal(isAccountingQuote({ library_template: "AB Capital/Accounting Agreement" }), false);
  assert.equal(isAccountingAgreement({ library_template: "AB Capital/Accounting Agreement" }), true);
});

test("blankOption and optionFromPackage", () => {
  assert.deepEqual(blankOption().services, []);
  const o = optionFromPackage({ package_key: "p", name: "Pkg", description: "d", notes: ["n"], services: [{ name: "s", basis: "month", amount: 5, subs: [] }] });
  assert.equal(o.package_key, "p");
  assert.equal(o.services[0].amount, 5);
});

test("quoteContext", () => {
  const settings = { company: { bank: { account_name: "Acc", iban: "IB" } }, accounting_proposal_defaults: { contact: { name: "C", phone: "1", email: "e@x.y", website: "w" } } };
  const doc = { client_name: "Test Client", contact_name: "Pat", created_at: "2026-11-05T21:30:00Z", document_number: "N1", field_values: { quote: quote([opt("A", [svc("a", "month", 100), svc("b", "month", null, [{ name: "x", amount: 3 }]), svc("c", "included", null), svc("d", "separate", null), svc("e", "na", null)]), opt("B", [svc("a", "once", 7)])]) } };
  const c = quoteContext(doc, settings);
  assert.equal(c.show_option_heading, true);
  assert.equal(c.date, "06/11/2026");
  assert.equal(c.bank.iban, "IB");
  assert.equal(c.contact.name, "C");
  const rows = c.options[0].rows;
  assert.deepEqual(rows.map((r) => !!r.is_sub), [false, false, true, false, false, false]);
  assert.deepEqual(rows.slice(3).map((r) => r.fee), ["Included in the above mentioned fees", "Will be charged separately", "NA"]);
  assert.equal(rows[0].fee, "AED 100 per month");
  assert.deepEqual(c.options[0].totals.map((t) => t.text), ["AED 103 per month"]);
  assert.equal(c.options[1].totals[0].text, "AED 7 one-time");
  assert.equal(quoteContext({ ...doc, field_values: { quote: quote([opt("A", [svc("a", "once", 1)])]) } }, settings).show_option_heading, false);
  assert.equal(Object.keys(c).some((k) => /^(grand|total|sum)/i.test(k)), false);
});
