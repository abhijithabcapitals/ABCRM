// node --test "Template Module/ardentax/tests/"
import test from "node:test";
import assert from "node:assert/strict";
import { attachmentNames, initialCopy, sendPlan, signState, signStatus } from "../logic/signingUi.js";

const DOC = { id: "d1", pdf_path: "ArdentTax (ASP)/d1/u/Ardentax-2026-11-ADTQ001 Sample.pdf", word_path: "ArdentTax (ASP)/d1/u/Ardentax-2026-11-ADTQ001 Sample.docx" };
const LIVE = { id: "s1", signer_name: "Sam Signer", signed_at: "2026-11-06T08:00:00Z", pdf_path: "ArdentTax (ASP)/d1/signed/x.pdf", word_path: "ArdentTax (ASP)/d1/signed/x.docx" };
const live = { live: LIVE, last: LIVE };
const withdrawn = { live: null, last: { ...LIVE, superseded_at: "2026-11-06T09:00:00Z" } };

test("Sign and Sign before sending show only to an approver, on a document with files and no live signature", () => {
  assert.deepEqual(signState(DOC, { canSign: true, signing: null }), { sign: true, signFirst: true, chooseCopy: false, signedPdf: null });
  assert.equal(signState(DOC, { canSign: false }).sign, false);
  assert.equal(signState(DOC, { canSign: false }).signFirst, false);
  assert.equal(signState(DOC, { canSign: "yes" }).sign, false, "only a real true from doc_sign_can counts");
  assert.equal(signState({ id: "d1" }, { canSign: true }).sign, false, "File pending: nothing to sign");
  assert.equal(signState({ ...DOC, word_path: null }, { canSign: true }).signFirst, false);
  assert.equal(signState(DOC, { canSign: true, signing: live }).sign, false, "already signed");
  assert.equal(signState(DOC, { canSign: true, signing: withdrawn }).sign, true, "a withdrawn signature can be signed again");
});

test("a signed document offers the signed or the unsigned copy to everyone who can send", () => {
  for (const canSign of [true, false]) {
    const s = signState(DOC, { canSign, signing: live });
    assert.equal(s.chooseCopy, true);
    assert.equal(s.signFirst, false);
    assert.equal(s.signedPdf, LIVE.pdf_path);
  }
  assert.equal(signState(DOC, { signing: withdrawn }).chooseCopy, false);
});

test("status line", () => {
  const fmt = (d) => d.slice(0, 10);
  assert.deepEqual(signStatus(live, fmt), { label: "Signed by Sam Signer on 2026-11-06", tone: "good" });
  assert.deepEqual(signStatus({ live: { ...LIVE, signer_name: "" } }, fmt), { label: "Signed by an approver on 2026-11-06", tone: "good" });
  assert.deepEqual(signStatus(withdrawn), { label: "Signature withdrawn: document changed", tone: "warn" });
  assert.deepEqual(signStatus(null), { label: "Not signed", tone: "plain" });
  assert.deepEqual(signStatus({ live: null, last: null }), { label: "Not signed", tone: "plain" });
});

test("the mail panel starts on the signed copy when there is one, with the tick off", () => {
  assert.deepEqual(initialCopy(live), { copy: "signed", signFirst: false });
  assert.deepEqual(initialCopy(withdrawn), { copy: "unsigned", signFirst: false });
  assert.deepEqual(initialCopy(null), { copy: "unsigned", signFirst: false });
});

test("what Send does: signing is optional, and an unsigned send never needs it", () => {
  const approverUnsigned = signState(DOC, { canSign: true });
  assert.deepEqual(sendPlan(approverUnsigned, { copy: "unsigned", signFirst: true }), { signFirst: true, signed: true });
  assert.deepEqual(sendPlan(approverUnsigned, { copy: "unsigned", signFirst: false }), { signFirst: false, signed: false });
  const memberUnsigned = signState(DOC, { canSign: false });
  assert.deepEqual(sendPlan(memberUnsigned, { copy: "unsigned", signFirst: true }), { signFirst: false, signed: false }, "a tick the member cannot see is ignored");
  assert.deepEqual(sendPlan(memberUnsigned, { copy: "signed", signFirst: false }), { signFirst: false, signed: false }, "no signed copy to pick");
  const signed = signState(DOC, { canSign: false, signing: live });
  assert.deepEqual(sendPlan(signed, { copy: "signed", signFirst: false }), { signFirst: false, signed: true });
  assert.deepEqual(sendPlan(signed, { copy: "unsigned", signFirst: true }), { signFirst: false, signed: false });
});

test("attachment names keep the document's own file names, marked when signed", () => {
  assert.deepEqual(attachmentNames(DOC, { attachWord: false, signed: false }), ["Ardentax-2026-11-ADTQ001 Sample.pdf"]);
  assert.deepEqual(attachmentNames(DOC, { attachWord: true, signed: false }), ["Ardentax-2026-11-ADTQ001 Sample.pdf", "Ardentax-2026-11-ADTQ001 Sample.docx"]);
  assert.deepEqual(attachmentNames(DOC, { attachWord: true, signed: true }), ["Ardentax-2026-11-ADTQ001 Sample.pdf (signed copy)", "Ardentax-2026-11-ADTQ001 Sample.docx (signed copy)"]);
  assert.deepEqual(attachmentNames({ id: "x" }, { attachWord: true, signed: false }), []);
});
