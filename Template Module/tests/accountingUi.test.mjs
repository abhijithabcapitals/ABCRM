import test from "node:test";
import assert from "node:assert/strict";
import { cleanLines, docActions, docStatus, fromLines, moveRow, toLines } from "../logic/accountingUi.js";

const Q = "AB Capital/Accounting Quote";
const A = "AB Capital/Accounting Agreement";
const quote = (o = {}) => ({ library_template: Q, storage_path: "p.pdf", word_path: "w.docx", field_values: { quote: { accepted_option: null, options: [{}, {}] } }, ...o });
const agreement = (o = {}) => ({ library_template: A, storage_path: "p.pdf", word_path: "w.docx", ...o });

test("lines round trip and clean", () => {
  assert.deepEqual(toLines("a\n\nb"), ["a", "", "b"]);
  assert.equal(fromLines(["a", "b"]), "a\nb");
  assert.deepEqual(cleanLines([" a ", "", "  "]), ["a"]);
});

test("moveRow swaps and stops at the ends", () => {
  assert.deepEqual(moveRow([1, 2, 3], 1, -1), [2, 1, 3]);
  assert.deepEqual(moveRow([1, 2, 3], 2, 1), [1, 2, 3]);
  assert.deepEqual(moveRow([1, 2, 3], 0, -1), [1, 2, 3]);
});

test("retry shows only without files and before approval", () => {
  assert.equal(docActions(agreement({ storage_path: null })).retry, true);
  assert.equal(docActions(agreement({ storage_path: null, approved_at: "2026-11-05" })).retry, false);
  assert.equal(docActions(quote()).retry, false);
});

test("approve needs canApprove, files and no approval yet", () => {
  assert.equal(docActions(agreement(), { canApprove: true }).approve, true);
  assert.equal(docActions(agreement(), { canApprove: false }).approve, false);
  assert.equal(docActions(agreement({ approved_at: "x" }), { canApprove: true }).approve, false);
});

test("unapproved agreement cannot be sent", () => {
  const a = docActions(agreement());
  assert.equal(a.send, false);
  assert.equal(a.awaitingApproval, true);
  assert.equal(docActions(agreement({ approved_at: "x" })).send, true);
  assert.equal(docActions(quote()).send, true);
});

test("agreement is offered only after acceptance and only once", () => {
  assert.equal(docActions(quote()).makeAgreement, false);
  const accepted = quote({ field_values: { quote: { accepted_option: 1, options: [{}, {}] } } });
  assert.equal(docActions(accepted).makeAgreement, true);
  assert.equal(docActions(accepted, { hasAgreement: true }).makeAgreement, false);
  assert.equal(docActions(accepted, { hasAgreement: true }).accept, false);
});

test("record signed only after approval; save now only when not in OneDrive", () => {
  assert.equal(docActions(agreement()).recordSigned, false);
  assert.equal(docActions(agreement({ approved_at: "x" })).recordSigned, true);
  assert.equal(docActions(quote()).saveNow, true);
  assert.equal(docActions(quote({ onedrive_path: "C:/x" })).saveNow, false);
});

test("status words", () => {
  assert.equal(docStatus(agreement()).label, "Awaiting approval");
  assert.equal(docStatus(agreement({ approved_at: "x" })).label, "Approved");
  assert.equal(docStatus(agreement({ approved_at: "x", signed_at: "y" })).label, "Signed");
  assert.equal(docStatus(quote()).label, "Issued");
  assert.equal(docStatus(quote({ field_values: { quote: { accepted_option: 0 } } })).label, "Accepted");
});

import { mailRowLines } from "../logic/accountingUi.js";
test("mailRowLines turns null amounts into 0 and keeps the rest", () => {
  const out = mailRowLines([{ description: "A", amount: null }, { description: "B", amount: 5 }, { description: "C" }]);
  assert.deepEqual(out.map((l) => l.amount), [0, 5, 0]);
  assert.deepEqual(mailRowLines(undefined), []);
});
test("edit is hidden once the agreement is signed", () => {
  assert.equal(docActions({ library_template: "AB Capital/Accounting Agreement", storage_path: "p" }).edit, true);
  assert.equal(docActions({ library_template: "AB Capital/Accounting Agreement", storage_path: "p", signed_at: "2026-11-05" }).edit, false);
});

import { agreementUnder, rejectedAgreementNote } from "../logic/accountingUi.js";
import { readFileSync } from "node:fs";
test("a rejected agreement still counts under its quote and explains why no new one is offered", () => {
  const A = "AB Capital/Accounting Agreement";
  const rej = { id: "a1", parent_id: "q1", library_template: A, status: "rejected", document_number: "ABC/2026/11/ACE001" };
  const live = { id: "a2", parent_id: "q1", library_template: A, status: "issued", document_number: "ABC/2026/11/ACE002" };
  assert.equal(agreementUnder([rej], "q1"), rej);
  assert.equal(agreementUnder([rej, live], "q1"), live);
  assert.equal(agreementUnder([rej], "q2"), null);
  assert.equal(agreementUnder([{ ...rej, library_template: null, doc_type: "letter" }], "q1"), null);
  assert.equal(rejectedAgreementNote(rej), "Agreement ABC/2026/11/ACE001 was rejected. Ask an admin to remove it before making a new one.");
  assert.equal(rejectedAgreementNote(live), null);
  assert.equal(rejectedAgreementNote(null), null);
  const accepted = { library_template: "AB Capital/Accounting Quote", storage_path: "p", field_values: { quote: { accepted_option: 0 } } };
  assert.equal(docActions(accepted, { hasAgreement: !!agreementUnder([rej], "q1") }).makeAgreement, false);
});

test("the Accounting screen reads its own list and saves mail through hub_acct_mail_update", () => {
  const acc = readFileSync(new URL("../components/AccountingDocuments.jsx", import.meta.url), "utf8");
  assert.match(acc, /listAccountingDocuments/);
  assert.doesNotMatch(acc, /listDocuments\(/);
  assert.doesNotMatch(acc, /\bupdateMail\(/);
  assert.match(acc, /updateAccountingMail\(/);
  const api = readFileSync(new URL("../services/accountingApi.js", import.meta.url), "utf8");
  assert.match(api, /hub_acct_mail_update/);
  const hub = readFileSync(new URL("../services/hubApi.js", import.meta.url), "utf8");
  assert.match(hub, /listDocuments = async \(department\) => \{\r?\n  let q = supabase\.from\("hub_documents"\)\.select\("\*"\)\.neq\("doc_type", "library"\)\.order\("created_at", \{ ascending: false \}\)\.limit\(500\);/);
});
