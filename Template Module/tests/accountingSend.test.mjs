import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FROM, fromOptions, initialChoice, pickFrom, pickSignature, sendOptions, sendProblem } from "../logic/accountingSend.js";

const froms = fromOptions([{ address: "Ceo@abcapital.ae", display_name: "Ceo" }, { address: "ceo@abcapital.ae" }, { address: "info@abcapital.ae" }]);
const plainSig = { id: "s1", is_default: true, sender_mailbox_address: null };
const ceoSig = { id: "s2", is_default: false, sender_mailbox_address: "ceo@abcapital.ae" };
const otherSig = { id: "s3", is_default: false, sender_mailbox_address: "hr@abcapital.ae" };
const sigs = [plainSig, ceoSig, otherSig];

test("From list: info@ first, owned once each, no duplicate info@", () => {
  assert.deepEqual(froms.map((f) => f.address), [DEFAULT_FROM, "ceo@abcapital.ae"]);
  assert.deepEqual(fromOptions(null).map((f) => f.address), [DEFAULT_FROM]);
});
test("the default signature is preselected and From stays info@", () => assert.deepEqual(initialChoice(sigs, froms), { from: DEFAULT_FROM, signatureId: "s1" }));
test("a default signature tied to an owned mailbox starts From there", () =>
  assert.equal(initialChoice([{ ...ceoSig, is_default: true }], froms).from, "ceo@abcapital.ae"));
test("no default means no signature", () => assert.deepEqual(initialChoice([ceoSig], froms), { from: DEFAULT_FROM, signatureId: "" }));
test("picking a signature with a mailbox switches From", () =>
  assert.deepEqual(pickSignature({ from: DEFAULT_FROM, signatureId: "s1" }, sigs, froms, "s2"), { from: "ceo@abcapital.ae", signatureId: "s2" }));
test("picking one without a mailbox keeps From; no signature allowed", () => {
  assert.deepEqual(pickSignature({ from: "ceo@abcapital.ae", signatureId: "s2" }, sigs, froms, "s1"), { from: "ceo@abcapital.ae", signatureId: "s1" });
  assert.deepEqual(pickSignature({ from: "ceo@abcapital.ae", signatureId: "s2" }, sigs, froms, ""), { from: "ceo@abcapital.ae", signatureId: "" });
});
test("a signature for a mailbox the user cannot use keeps From and blocks Send", () => {
  const c = pickSignature({ from: DEFAULT_FROM, signatureId: "s1" }, sigs, froms, "s3");
  assert.equal(c.from, DEFAULT_FROM);
  assert.match(sendProblem(c, sigs, froms), /hr@abcapital\.ae/);
});
test("changing From clears a signature that does not fit", () => {
  assert.equal(pickFrom({ from: "ceo@abcapital.ae", signatureId: "s2" }, sigs, "info@abcapital.ae").signatureId, "");
  assert.equal(pickFrom({ from: "ceo@abcapital.ae", signatureId: "s1" }, sigs, "info@abcapital.ae").signatureId, "s1");
});
test("a valid choice has no problem and builds the request fields", () => {
  const c = { from: "ceo@abcapital.ae", signatureId: "s2" };
  assert.equal(sendProblem(c, sigs, froms), null);
  assert.deepEqual(sendOptions(c), { from: "ceo@abcapital.ae", signature_id: "s2" });
  assert.deepEqual(sendOptions({ from: DEFAULT_FROM, signatureId: "" }), { from: DEFAULT_FROM, signature_id: null });
});
test("a From the user does not own is a problem", () => assert.match(sendProblem({ from: "x@abcapital.ae", signatureId: "" }, sigs, froms), /cannot send/));

import { pdfName } from "../logic/accountingSend.js";
test("the PDF name matches the server's", () => {
  assert.equal(pdfName({ document_number: "ACQ-1", client_name: "Sample/Co: LLC" }), "ACQ-1 Sample-Co- LLC.pdf");
  assert.equal(pdfName({}), "Document.pdf");
});
