import test from "node:test";
import assert from "node:assert/strict";
import { cleanLines, docActions, docStatus, fromLines, legacyApproved, moveRow, signatureStatus, signStamp, toLines, withSignatures } from "../logic/accountingUi.js";

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

test("retry shows only without files, approved before or not", () => {
  assert.equal(docActions(agreement({ storage_path: null })).retry, true);
  assert.equal(docActions(agreement({ storage_path: null, approved_at: "2026-11-05" })).retry, true);
  assert.equal(docActions(quote()).retry, false);
});

const LIVE = { id: "s1", signed_at: "2026-11-06T09:00:00Z", signer_name: "Test Approver", pdf_path: "Accounting/d/signed/x.pdf", superseded_at: null };

test("Sign is offered on quotes and agreements with files, to approvers only, while not signed", () => {
  for (const d of [quote(), agreement()]) {
    assert.equal(docActions(d, { canSign: true }).sign, true);
    assert.equal(docActions(d, { canSign: false }).sign, false);
    assert.equal(docActions(d, { canSign: true, signature: LIVE }).sign, false);
    assert.equal(docActions({ ...d, storage_path: null }, { canSign: true }).sign, false);
  }
  assert.equal("approve" in docActions(agreement(), { canSign: true }), false);
});

test("signing is optional: an unsigned agreement can be sent", () => {
  const a = docActions(agreement());
  assert.equal(a.send, true);
  assert.equal("awaitingApproval" in a, false);
  assert.equal(docActions(agreement({ storage_path: null })).send, false);
  assert.equal(docActions(quote()).send, true);
});

test("the signed copy link shows only with a live signature", () => {
  assert.equal(docActions(agreement(), { signature: LIVE }).signedCopy, true);
  assert.equal(docActions(agreement()).signedCopy, false);
});

test("agreement is offered only after acceptance and only once", () => {
  assert.equal(docActions(quote()).makeAgreement, false);
  const accepted = quote({ field_values: { quote: { accepted_option: 1, options: [{}, {}] } } });
  assert.equal(docActions(accepted).makeAgreement, true);
  assert.equal(docActions(accepted, { hasAgreement: true }).makeAgreement, false);
  assert.equal(docActions(accepted, { hasAgreement: true }).accept, false);
});

test("the client's signed copy needs no approval; save now only when not in OneDrive", () => {
  assert.equal(docActions(agreement()).recordSigned, true);
  assert.equal(docActions(agreement({ storage_path: null })).recordSigned, false);
  assert.equal(docActions(quote()).saveNow, true);
  assert.equal(docActions(quote({ onedrive_path: "C:/x" })).saveNow, false);
});

test("status words: no more Awaiting approval", () => {
  assert.equal(docStatus(agreement()).label, "Issued");
  assert.equal(docStatus(agreement({ approved_at: "x" })).label, "Issued");
  assert.equal(docStatus(agreement({ signed_at: "y" })).label, "Client signed");
  assert.equal(docStatus(quote()).label, "Issued");
  assert.equal(docStatus(quote({ field_values: { quote: { accepted_option: 0 } } })).label, "Accepted");
});

test("signature status line", () => {
  const fmt = (d) => `D(${d})`;
  assert.deepEqual(signatureStatus(agreement(), { live: LIVE }, fmt), { label: "Signed by Test Approver on D(2026-11-06T09:00:00Z)", tone: "good" });
  assert.deepEqual(signatureStatus(agreement(), { live: { ...LIVE, signer_name: "" } }, fmt), { label: "Signed by an approver on D(2026-11-06T09:00:00Z)", tone: "good" });
  assert.deepEqual(signatureStatus(agreement(), { live: null, last: { ...LIVE, superseded_at: "2026-11-06T10:00:00Z" } }, fmt), { label: "Signature withdrawn: document changed", tone: "warn" });
  assert.deepEqual(signatureStatus(agreement(), null, fmt), { label: "Not signed", tone: "plain" });
  const old = agreement({ approved_at: "2026-11-04T10:00:00Z", agreement_changed_at: "2026-11-04T09:00:00Z" });
  assert.deepEqual(signatureStatus(old, null, fmt), { label: "Approved on D(2026-11-04T10:00:00Z)", tone: "good" });
  assert.deepEqual(signatureStatus({ ...old, agreement_changed_at: "2026-11-05T09:00:00Z" }, null, fmt), { label: "Not signed", tone: "plain" });
  assert.deepEqual(signatureStatus({ ...old, storage_path: null }, null, fmt).label, "Not signed");
});

test("an approval made before 012 holds only while nothing changed after it", () => {
  assert.equal(legacyApproved(agreement({ approved_at: "2026-11-04T10:00:00.5+00:00", agreement_changed_at: "2026-11-04T10:00:00.123456+00:00" })), true);
  assert.equal(legacyApproved(agreement({ approved_at: "2026-11-04T10:00:00Z", agreement_changed_at: null })), true);
  assert.equal(legacyApproved(agreement({ approved_at: "2026-11-04T10:00:00Z", agreement_changed_at: "2026-11-04T11:00:00Z" })), false);
  assert.equal(legacyApproved(agreement()), false);
});

test("the change stamp sent with a signing is the one the server compares (011 doc_sign_stamp)", () => {
  assert.equal(signStamp({ created_at: "2026-11-01T00:00:00Z" }), "2026-11-01T00:00:00Z");
  assert.equal(signStamp({ created_at: "c", agreement_changed_at: "2026-11-02T00:00:00.123456+00:00", content_changed_at: null }), "2026-11-02T00:00:00.123456+00:00");
  assert.equal(signStamp({ created_at: "c", agreement_changed_at: "2026-11-02T00:00:00Z", content_changed_at: "2026-11-03T00:00:00Z" }), "2026-11-03T00:00:00Z");
  assert.equal(signStamp({ created_at: "c", agreement_changed_at: "2026-11-04T00:00:00Z", content_changed_at: "2026-11-03T00:00:00Z" }), "2026-11-04T00:00:00Z");
  assert.equal(signStamp(null), null);
});

test("signatures attach to their rows: the live one, else the latest withdrawn one", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c", doc_type: "mail" }];
  const sigs = [
    { id: "s3", source_id: "a", signed_at: "2026-11-06T10:00:00Z", superseded_at: null, signer: { full_name: "Ann" } },
    { id: "s2", source_id: "a", signed_at: "2026-11-05T10:00:00Z", superseded_at: "2026-11-06T09:00:00Z" },
    { id: "s0", source_id: "b", signed_at: "2026-11-03T10:00:00Z", superseded_at: "2026-11-04T09:00:00Z" },
    { id: "s1", source_id: "b", signed_at: "2026-11-04T10:00:00Z", superseded_at: "2026-11-05T09:00:00Z" },
  ];
  const out = withSignatures(rows, sigs);
  assert.equal(out[0].signing.live.id, "s3");
  assert.equal(out[0].signing.live.signer_name, "Ann");
  assert.equal(out[1].signing.live, null);
  assert.equal(out[1].signing.last.id, "s1");
  assert.deepEqual(out[2].signing, { live: null, last: null });
  assert.equal(rows[0].signing, undefined, "rows are not changed in place");
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
  assert.match(acc, /listAccountingWithSignatures/);
  assert.doesNotMatch(acc, /approveAgreement|canApprove|Awaiting approval|approveDoc/);
  assert.match(acc, /signAccounting\(/);
  assert.match(acc, /Sign before sending/);
  assert.doesNotMatch(acc, /listDocuments\(/);
  assert.doesNotMatch(acc, /\bupdateMail\(/);
  assert.match(acc, /updateAccountingMail\(/);
  const api = readFileSync(new URL("../services/accountingApi.js", import.meta.url), "utf8");
  assert.match(api, /hub_acct_mail_update/);
  assert.match(api, /async function listAccountingWithSignatures\(\) \{\r?\n  const docs = await listAccountingDocuments\(\);/);
  assert.doesNotMatch(api, /hub_acct_approve|hub_acct_can_approve/);
  const hub = readFileSync(new URL("../services/hubApi.js", import.meta.url), "utf8");
  assert.match(hub, /listDocuments = async \(department\) => \{\r?\n  let q = supabase\.from\("hub_documents"\)\.select\("\*"\)\.neq\("doc_type", "library"\)\.order\("created_at", \{ ascending: false \}\)\.limit\(500\);/);
});
