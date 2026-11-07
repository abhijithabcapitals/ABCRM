// node --test "Business Development Module/tests/"
import test from "node:test";
import assert from "node:assert/strict";
import { currentQuote, letterOf, quoteClientFromLead, quoteLinesFromServices, quoteStage, signedCopyProblem } from "../logic/leadQuoteRules.js";

test("quote lines come from quoted services at the agreed fee", () => {
  const { lines, foreign } = quoteLinesFromServices([
    { service_name: "Bookkeeping", proposed_fee: 1000, final_agreed_fee: 900, currency: "AED", status: "quoted" },
    { service_name: "Audit", proposed_fee: 500, currency: "AED", status: "rejected" },
    { service_name: "Payroll", proposed_fee: null, currency: "AED", status: "interested" },
    { service_name: "VAT Return Filing", proposed_fee: 200, currency: "USD", status: "quoted" },
  ]);
  assert.deepEqual(lines, [{ description: "Bookkeeping", amount: 900 }, { description: "VAT Return Filing", amount: 200 }]);
  assert.deepEqual(foreign, ["VAT Return Filing (USD)"]);
});

test("client details come from the lead, address left blank", () => {
  assert.deepEqual(quoteClientFromLead({ name: "Acme", contact_name: "Sam", email: "s@a.ae", mobile: "+971 5" }),
    { client: "Acme", contact: "Sam", email: "s@a.ae", phone: "+971 5", address: "", license: "", trn: "" });
});

test("the current quote is the newest one not replaced, and its letter", () => {
  const docs = [
    { id: "q1", doc_type: "quote", status: "superseded", created_at: "2026-11-03" },
    { id: "q2", doc_type: "quote", status: "accepted", created_at: "2026-11-02" },
    { id: "l1", doc_type: "letter", parent_id: "q2", status: "issued" },
    { id: "m1", doc_type: "mail", parent_id: "q2" },
  ];
  assert.equal(currentQuote(docs).id, "q2");
  assert.equal(letterOf(docs, currentQuote(docs)).id, "l1");
});

test("quote stages", () => {
  assert.equal(quoteStage(null), "none");
  assert.equal(quoteStage({ status: "issued" }), "waiting");
  assert.equal(quoteStage({ status: "accepted" }, null), "letter");
  assert.equal(quoteStage({ status: "accepted" }, { id: "l" }), "done");
  assert.equal(quoteStage({ status: "rejected" }), "rejected");
});

test("signed copy must be a small PDF or image", () => {
  assert.match(signedCopyProblem(null), /Choose/);
  assert.match(signedCopyProblem({ name: "a.docx", size: 10 }), /PDF/);
  assert.match(signedCopyProblem({ name: "a.pdf", size: 11 * 1024 * 1024 }), /10 MB/);
  assert.equal(signedCopyProblem({ name: "a.PDF", size: 100 }), null);
});
