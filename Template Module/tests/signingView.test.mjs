// node --test "Template Module/tests/signingView.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { signingView, validateSignatureFile } from "../logic/signingView.js";

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
