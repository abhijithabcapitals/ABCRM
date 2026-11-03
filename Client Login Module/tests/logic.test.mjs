// node --test "Client Login Module/tests/logic.test.mjs"   (no extra packages)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { bankingProgress } from "../logic/progress.js";
import { FIELDS, fieldState } from "../logic/fields.js";

test("bankingProgress percent follows the 15 visible steps", () => {
  const pct = (current_stage) => bankingProgress({ current_stage, outcome: null }).percent;
  assert.equal(pct(1), 7);
  assert.equal(pct(13), 87);
  assert.equal(pct(14), 93);
  assert.equal(pct(17), 93);
  assert.equal(pct(18), 100);
});

test("bankingProgress outcomes override the stage", () => {
  assert.deepEqual(bankingProgress({ current_stage: 8, outcome: "Approved" }), { state: "approved", percent: 100, label: "Account opened" });
  assert.deepEqual(bankingProgress({ current_stage: 17, outcome: "Rejected" }), { state: "rejected", percent: null, label: "Not approved" });
  const open = bankingProgress({ current_stage: 8, outcome: null });
  assert.equal(open.state, "open");
  assert.equal(open.label, "Document Collection & Verification");
});

test("FIELDS lists the 16 editable keys", () => {
  assert.deepEqual(FIELDS.map((f) => f.key).sort(), [
    "business_activity", "company_email", "company_phone", "ct_registration_number", "financial_year_end", "issuing_authority",
    "legal_name", "legal_structure", "license_expiry_date", "license_issue_date", "license_number", "office_address",
    "registered_address", "trade_name", "vat_trn", "website",
  ]);
  assert.deepEqual(FIELDS.filter((f) => f.masterOnly).map((f) => f.key).sort(), ["ct_registration_number", "financial_year_end"]);
  assert.deepEqual([...new Set(FIELDS.map((f) => f.group))].sort(), ["Company", "Contact", "Licence", "Tax"]);
});

test("fieldState reads the record and the open change request", () => {
  const f = FIELDS.find((x) => x.key === "trade_name");
  const rec = { trade_name: "A" };
  const pending = fieldState(f, rec, [{ field_key: "trade_name", status: "pending", new_value: "B" }]);
  assert.equal(pending.value, "A");
  assert.equal(pending.pending, "B");
  assert.equal(pending.locked, false);
  assert.equal(fieldState(f, rec, [{ field_key: "trade_name", status: "in_review", new_value: "B" }]).locked, true);
  assert.equal(fieldState(f, rec, [{ field_key: "trade_name", status: "rejected", review_note: "No" }]).rejectedNote, "No");
  const none = fieldState(f, rec, [{ field_key: "vat_trn", status: "pending", new_value: "X" }]);
  assert.deepEqual(none, { value: "A", pending: null, rejectedNote: null, locked: false });
});

test("no file still points at the old portal locations", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === "node_modules" ? [] : walk(join(d, e.name))) : [join(d, e.name)]);
  const old = /@client-module\/portal|crm\/ClientPortalAdmin|\.\.\/portal\/ClientPortal/;
  const bad = ["Main Module/src", "Client Module/crm"].flatMap((d) => walk(join(root, d))).filter((f) => /\.(jsx?|mjs)$/.test(f) && old.test(readFileSync(f, "utf8")));
  assert.deepEqual(bad, []);
});
