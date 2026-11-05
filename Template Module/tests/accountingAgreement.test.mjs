// node --test "Template Module/tests/accountingAgreement.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { agreementFromQuote, feeWording, scopeSentence, checkAgreement, agreementContext } from "../logic/accountingAgreement.js";

const svc = (name, basis, amount, subs = []) => ({ name, basis, amount, subs });
const opt = (name, services) => ({ package_key: "k", name, description: "", notes: [], services });
const qdoc = (options, accepted) => ({ client_name: "Test Client", contact_name: "Pat", contact_email: "pat@example.com", field_values: { quote: { accepted_option: accepted, options, shared: {} } } });
const pkg = { package_key: "k", name: "P", description: "", services: [], notes: [], schedule1: [{ name: "Bookkeeping", description: "Record entries." }] };
const defaults = {
  standard: { scope_notes: ["Scope note A"], fee_notes: [], please_note: [], billing: { monthly: ["Billed monthly."], quarterly: ["Billed quarterly."], commencement: ["Billed at start."] } },
  contact: { name: "N", phone: "1", email: "e@example.com", website: "w" },
};
const good = () => ({
  accepted_option: 0, address: ["Line 1"], attention: "", signatory_name: "Sam", signatory_title: "Director", notices_email: "sam@example.com",
  scope_sentence: "x", schedule1: [{ name: "A", description: "" }], scope_notes: [], schedule2: [{ description: "A", fee: "AED 1/- + VAT" }],
  billing: "monthly", billing_notes: [], effective_months: 12, notice_days: 30,
});

test("feeWording per basis", () => {
  assert.equal(feeWording(svc("a", "month", 100), "January 2030"), "AED 100/- + VAT per month starting from the month of January 2030");
  assert.equal(feeWording(svc("a", "quarter", 300), "January 2030"), "AED 300/- + VAT per quarter starting from the month of January 2030");
  assert.equal(feeWording(svc("a", "year", 1200), "January 2030"), "AED 1,200/- + VAT per year starting from the month of January 2030");
  assert.equal(feeWording(svc("a", "once", 500), "January 2030"), "AED 500/- + VAT");
  assert.equal(feeWording(svc("a", "included", null), "x"), "Included in the above mentioned fees");
  assert.equal(feeWording(svc("a", "separate", null), "x"), "Will be charged separately");
  assert.equal(feeWording(svc("a", "na", null), "x"), "NA");
});

test("scopeSentence", () => {
  assert.ok(scopeSentence(["A"]).startsWith('Based on the requirement discussed, we will be providing the services mentioned under "Schedule 1: Scope of Services" relating to '));
  assert.match(scopeSentence(["Accounting and Book-Keeping"]), /relating to Accounting and Book-Keeping\.$/);
  assert.match(scopeSentence(["A", "B", "C"]), /relating to A, B and C\.$/);
  assert.match(scopeSentence(["A", "B"]), /relating to A and B\.$/);
});

test("agreementFromQuote uses accepted option, throws when null", () => {
  const q = qdoc([opt("One", [svc("Other", "month", 1)]), opt("Two", [svc("Bookkeeping", "month", 200)])], 1);
  const a = agreementFromQuote(q, pkg, defaults);
  assert.equal(a.accepted_option, 1);
  assert.deepEqual(a.schedule1, [{ name: "Bookkeeping", description: "Record entries." }]);
  assert.equal(a.schedule2.length, 1);
  assert.deepEqual(a.scope_notes, ["Scope note A"]);
  assert.equal(a.billing, "monthly");
  assert.throws(() => agreementFromQuote(qdoc([opt("One", [svc("A", "month", 1)])], null), pkg, defaults));
});

test("schedule 1 description blank when package lacks it; subs give indented rows", () => {
  const q = qdoc([opt("One", [svc("Payroll", "month", null, [{ name: "S1", amount: 10 }, { name: "S2", amount: 20 }])])], 0);
  const a = agreementFromQuote(q, pkg, defaults);
  assert.deepEqual(a.schedule1, [{ name: "Payroll", description: "" }]);
  assert.equal(a.schedule2.length, 3);
  assert.equal(a.schedule2[0].sub, undefined);
  assert.match(a.schedule2[0].fee, /^AED 30\/- \+ VAT per month/);
  assert.equal(a.schedule2[1].sub, true);
  assert.equal(a.schedule2[1].description, "S1");
  assert.equal(a.schedule2[2].sub, true);
});

test("sub row fees parse string amounts and handle once", () => {
  const m = agreementFromQuote(qdoc([opt("One", [svc("Payroll", "month", null, [{ name: "S1", amount: "1,000" }])])], 0), pkg, defaults);
  assert.equal(m.schedule2[1].fee, "AED 1,000/- + VAT per month");
  const o = agreementFromQuote(qdoc([opt("One", [svc("Setup", "once", null, [{ name: "S1", amount: "250" }])])], 0), pkg, defaults);
  assert.equal(o.schedule2[1].fee, "AED 250/- + VAT");
});

test("checkAgreement names each gap", () => {
  assert.equal(checkAgreement(good()), null);
  assert.match(checkAgreement({ ...good(), address: [] }), /address/i);
  assert.match(checkAgreement({ ...good(), signatory_name: " " }), /signatory name/i);
  assert.match(checkAgreement({ ...good(), signatory_title: "" }), /designation/i);
  assert.match(checkAgreement({ ...good(), notices_email: "bad" }), /email/i);
  assert.match(checkAgreement({ ...good(), schedule1: [], schedule2: [] }), /schedule/i);
  assert.match(checkAgreement({ ...good(), effective_months: 0 }), /months/i);
});

test("period text full wording", () => {
  const doc = { created_at: "2026-11-05T10:00:00Z", field_values: { agreement: good() } };
  assert.equal(agreementContext(doc, {}, false).period_text, "This Agreement shall remain effective for 12 months from the date of acceptance. It may be extended further with mutual written agreement. Either Party may terminate the Agreement by giving 30 days' prior written notice. No penalties or additional fees shall apply upon termination; however, any outstanding fees for services rendered or in progress shall be payable in full.");
});

test("agreementContext", () => {
  const doc = { document_number: "D1", created_at: "2026-11-05T10:00:00Z", client_name: "Test Client", field_values: { agreement: { ...good(), scope_notes: ["", "  "], billing: "quarterly", effective_months: 6, notice_days: 45 } } };
  const settings = { accounting_proposal_defaults: defaults, company: { bank: { iban: "TESTIBAN" } } };
  const d = agreementContext(doc, settings, false);
  assert.equal(d.draft_mark, true);
  assert.equal(d.has_signature, false);
  assert.equal(agreementContext(doc, settings, true).draft_mark, false);
  assert.equal(agreementContext(doc, settings, true).has_signature, true);
  assert.deepEqual(d.scope_notes, []);
  assert.deepEqual(d.billing_notes, ["Billed quarterly."]);
  assert.match(d.period_text, /6 months/);
  assert.match(d.period_text, /45 days/);
  assert.equal(d.attention, "The Management");
  assert.equal(d.date, "05-November-2026");
  assert.equal(d.client_name, "Test Client");
  assert.equal(d.ab_notices_email, "accounts@abcapital.ae");
  assert.equal(d.bank.iban, "TESTIBAN");
  const filled = agreementContext({ ...doc, field_values: { agreement: { ...good(), scope_notes: ["Keep"] } } }, settings, false);
  assert.deepEqual(filled.scope_notes, ["Keep"]);
});

test("agreementContext numbers schedule rows and gives fee notes", () => {
  const a = { ...good(), schedule1: [{ name: "A", description: "" }, { name: "B", description: "" }], schedule2: [{ description: "A", fee: "x" }, { description: "S", fee: "y", sub: true }, { description: "B", fee: "z" }] };
  const doc = { created_at: "2026-11-05T10:00:00Z", field_values: { agreement: a } };
  const d = agreementContext(doc, { accounting_proposal_defaults: { standard: { fee_notes: ["Fee note", " "] } } }, false);
  assert.deepEqual(d.schedule1.map((r) => r.no), [1, 2]);
  assert.deepEqual(d.schedule2.map((r) => r.no), [1, "", 2]);
  assert.deepEqual(d.fee_notes, ["Fee note"]);
});

test("agreementContext prints a stored billing string for each billing choice", () => {
  const s = { accounting_proposal_defaults: { standard: { billing: { monthly: "Invented monthly wording.", quarterly: "Invented quarterly wording.", commencement: "Invented start wording." } } } };
  for (const [k, text] of [["monthly", "Invented monthly wording."], ["quarterly", "Invented quarterly wording."], ["commencement", "Invented start wording."]]) {
    const doc = { field_values: { agreement: { ...good(), billing: k } } };
    assert.deepEqual(agreementContext(doc, s, false).billing_notes, [text]);
  }
});

test("agreementContext: own billing notes override the stored string; arrays and empty strings still work", () => {
  const std = (billing) => ({ accounting_proposal_defaults: { standard: { billing } } });
  const doc = (extra) => ({ field_values: { agreement: { ...good(), ...extra } } });
  assert.deepEqual(agreementContext(doc({ billing_notes: ["Own note."] }), std({ monthly: "Stored string." }), false).billing_notes, ["Own note."]);
  assert.deepEqual(agreementContext(doc({}), std({ monthly: ["Listed A.", "Listed B."] }), false).billing_notes, ["Listed A.", "Listed B."]);
  assert.deepEqual(agreementContext(doc({}), std({ monthly: "" }), false).billing_notes, []);
});
