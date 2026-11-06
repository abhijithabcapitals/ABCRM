// node --test "Template Module/tests/signingView.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { approversToSave, oldImageToRemove, signingView, validateSignatureFile } from "../logic/signingView.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const settings = { document_signing: { companies: {
  ab_capital: { name: "Test Co One", approvers: [A.toUpperCase()], signature_path: "signatures/ab_capital/x.png", uploaded_at: "2030-01-01", uploaded_by: A },
  ardentax: { name: "Test Co Two", approvers: [], signature_path: null } } } };
const staff = [{ id: A, full_name: "Test A", role: "ADMIN" }, { id: B, full_name: "Test B", role: "MANAGER" }, { id: "c", full_name: "Test Client", role: "client" }, { id: "d", full_name: "No Role", role: null }];

test("admin sees edit parts for both companies", () => {
  const v = signingView(settings, { id: B, role: "admin" }, staff);
  assert.deepEqual(v.map((c) => c.company), ["ab_capital", "ardentax"]);
  assert.ok(v.every((c) => c.canEdit));
  assert.deepEqual(v[0].approvers, [A]);
  assert.equal(v[0].hasImage, true);
  assert.equal(v[1].hasImage, false);
});

test("non-admin sees only companies they approve, with no edit parts", () => {
  const v = signingView(settings, { id: A, role: "manager" }, staff);
  assert.deepEqual(v.map((c) => c.company), ["ab_capital"]);
  assert.ok(v.every((c) => !c.canEdit && c.canPreview));
  assert.deepEqual(signingView(settings, { id: B, role: "manager" }, staff), []);
});

test("admin may preview only where an approver, or when the list is empty", () => {
  const v = signingView(settings, { id: B, role: "admin" }, staff);
  assert.equal(v[0].canPreview, false);
  assert.equal(v[1].canPreview, true);
});

test("choice list is staff only", () => {
  const v = signingView(settings, { id: A, role: "admin" }, staff);
  assert.deepEqual(v[0].choices.map((u) => u.id), [A, B]);
});

test("missing settings give no companies", () => {
  assert.deepEqual(signingView(null, { id: A, role: "admin" }, staff), []);
});

test("image rules", () => {
  assert.equal(validateSignatureFile({ type: "image/png", size: 10 }).ext, "png");
  assert.equal(validateSignatureFile({ type: "image/jpeg", size: 10 }).ext, "jpg");
  assert.ok(validateSignatureFile({ type: "image/gif", size: 10 }).error);
  assert.ok(validateSignatureFile({ type: "image/png", size: 2 * 1024 * 1024 }).error);
  assert.equal(validateSignatureFile({ type: "image/png", size: 2 * 1024 * 1024 - 1 }).ext, "png");
});

test("approvers outside the staff choices are listed as extras and survive until removed", () => {
  const st = [...staff];
  const s2 = { document_signing: { companies: { ab_capital: { name: "X", approvers: [A, "c", "d", "99999999-9999-4999-8999-999999999999"], signature_path: null } } } };
  const people = [{ id: A, role: "ADMIN" }, { id: "c", role: "client" }, { id: "d", role: null }];
  const v = signingView(s2, { id: A, role: "admin" }, people)[0];
  assert.deepEqual(v.extras, ["c", "d", "99999999-9999-4999-8999-999999999999"]);
  assert.deepEqual(v.choices.map((u) => u.id), [A]);
  assert.ok(st.length);
});

test("saving drops ids with no profile but keeps known non-staff ids", () => {
  const s2 = { document_signing: { companies: { ab_capital: { name: "X", approvers: [], signature_path: null } } } };
  const people = [{ id: A, role: "ADMIN" }, { id: "c", role: "client" }];
  const v = signingView(s2, { id: A, role: "admin" }, people)[0];
  assert.deepEqual(approversToSave(new Set([A, "c", "gone"]), v), [A, "c"]);
});

test("old image removal", () => {
  assert.equal(oldImageToRemove("signatures/ab_capital/a.png", "signatures/ab_capital/b.png"), "signatures/ab_capital/a.png");
  assert.equal(oldImageToRemove("accounting-signature/a.png", "signatures/ab_capital/b.png"), null);
  assert.equal(oldImageToRemove(null, "x"), null);
  assert.equal(oldImageToRemove("signatures/a.png", "signatures/a.png"), null);
  assert.equal(oldImageToRemove("elsewhere/a.png", "signatures/b.png"), null);
});

// ---- signing deps: company and signed folder from the row (same rules as Template Hub 011 doc_company and doc_sign_prefix) ----
import { docCompany, signedPrefix } from "../logic/signingView.js";
test("the company of a document comes from its row", () => {
  assert.equal(docCompany("hub_documents", { library_template: "AB Capital/Accounting Quote" }), "ab_capital");
  assert.equal(docCompany("hub_documents", { library_template: null }), "ab_capital");
  assert.equal(docCompany("hub_documents", { library_template: "Ardentax/Letter" }), "ardentax");
  assert.equal(docCompany("ardentax_documents", {}), "ardentax");
  assert.equal(docCompany("banking_quotations", {}), "ab_capital");
});
test("signed files go under the document's own signed/ folder", () => {
  assert.equal(signedPrefix("hub_documents", { id: "d1", department: "Accounting" }), "Accounting/d1/signed/");
  assert.equal(signedPrefix("ardentax_documents", { id: "a1" }), "ArdentTax (ASP)/a1/signed/");
  assert.throws(() => signedPrefix("hub_documents", { id: "d1", department: "" }), /department/);
  assert.throws(() => signedPrefix("hub_documents", { id: "", department: "Accounting" }), /document/);
  assert.throws(() => signedPrefix("banking_quotations", { id: "b1" }), /not supported/);
});
