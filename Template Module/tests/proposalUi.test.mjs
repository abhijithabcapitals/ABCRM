// node --test "Template Module/tests/proposalUi.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { proposalSendChoice, proposalSignActions, sendSummary } from "../logic/proposalUi.js";
import { signOptions } from "../logic/accountingSend.js";

const doc = (o = {}) => ({ id: "d1", document_number: "ABC/2026/11/BSQ900", library_template: "AB Capital/Proposal", status: "issued", storage_path: "Business Setup/d1/p.pdf", word_path: "Business Setup/d1/p.docx", ...o });
const live = { id: "s1", pdf_path: "Business Setup/d1/signed/s.pdf", signer_name: "Sam Signer", signed_at: "2026-11-06T08:00:00Z" };

test("Sign shows only to an AB Capital approver, on a proposal with files that is not signed yet", () => {
  assert.equal(proposalSignActions(doc(), { canSign: true }).sign, true);
  assert.equal(proposalSignActions(doc(), { canSign: false }).sign, false);
  assert.equal(proposalSignActions(doc(), {}).sign, false, "default: not an approver");
  assert.equal(proposalSignActions(doc({ storage_path: null }), { canSign: true }).sign, false, "no files yet: Retry first");
  assert.equal(proposalSignActions(doc(), { canSign: true, signature: live }).sign, false, "already signed");
  assert.equal(proposalSignActions(doc({ status: "rejected" }), { canSign: true }).sign, false);
  assert.equal(proposalSignActions(doc({ status: "superseded" }), { canSign: true }).sign, false);
  assert.equal(proposalSignActions(doc({ status: "accepted" }), { canSign: true }).sign, true);
});

test("signed and unsigned copies: the unsigned copy stays whenever there are files", () => {
  assert.deepEqual(proposalSignActions(doc(), { signature: live }), { busy: false, sign: false, signedCopy: true, unsignedCopy: true });
  assert.deepEqual(proposalSignActions(doc(), {}), { busy: false, sign: false, signedCopy: false, unsignedCopy: true });
  assert.equal(proposalSignActions(doc({ storage_path: null }), {}).unsignedCopy, false);
  assert.equal(proposalSignActions(doc(), { busy: true }).busy, true);
});

test("send dialog: approvers may tick Sign before sending; a signed proposal goes as its signed copy unless changed", () => {
  const tick = proposalSendChoice(doc(), true);
  assert.deepEqual(tick, { showTick: true, showCopy: false, copy: "unsigned", signFirst: false });
  assert.deepEqual(signOptions(tick), { signFirst: false, signed: false }, "signing stays optional: unticked sends unsigned");
  assert.deepEqual(signOptions({ ...tick, signFirst: true }), { signFirst: true, signed: true });
  assert.deepEqual(proposalSendChoice(doc(), false), { showTick: false, showCopy: false, copy: "unsigned", signFirst: false }, "a non-approver sends unsigned, no tick");
  const signed = proposalSendChoice(doc({ signing: { live } }), false);
  assert.deepEqual(signed, { showTick: false, showCopy: true, copy: "signed", signFirst: false });
  assert.deepEqual(signOptions(signed), { signFirst: false, signed: true });
  assert.deepEqual(signOptions({ ...signed, copy: "unsigned" }), { signFirst: false, signed: false });
  assert.equal(proposalSendChoice(doc({ status: "rejected" }), true).showTick, false);
  assert.equal(proposalSendChoice(doc({ storage_path: null }), true).showTick, false);
});

test("sendSummary names the file that goes", () => {
  assert.equal(sendSummary(doc(), { signed: false }), "ABC-2026-11-BSQ900.pdf");
  assert.equal(sendSummary(doc(), { signed: true }), "ABC-2026-11-BSQ900.pdf (signed copy)");
  assert.equal(sendSummary(doc({ document_number: "" }), {}), "Proposal.pdf");
});
