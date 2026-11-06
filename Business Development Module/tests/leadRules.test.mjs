// node --test "Business Development Module/tests/"
import test from "node:test";
import assert from "node:assert/strict";
import { departmentForService, isUnassigned, nextStep, suggestTransfers, WORKFLOW_STAGES } from "../logic/leadRules.js";

test("workflow stages are in the agreed order", () => {
  assert.deepEqual(WORKFLOW_STAGES, ["Prospect", "Contact", "Convinced", "Received Documents", "Done KYC", "Quote & Engagement Sent"]);
});

test("services route to their department", () => {
  assert.equal(departmentForService("Bank Account Opening"), "business_banking");
  assert.equal(departmentForService("Company Formation"), "business_setup");
  assert.equal(departmentForService("VAT Return Filing"), "accounting");
  assert.deepEqual(suggestTransfers(["Bookkeeping", "Company Formation", "VAT Registration"]), {
    business_setup: ["Company Formation"],
    accounting: ["Bookkeeping", "VAT Registration"],
  });
});

test("an unassigned open lead is in the pool and its next step is Assign to me", () => {
  const lead = { status: "active", current_owner: null, stage: "Prospect" };
  assert.equal(isUnassigned(lead), true);
  assert.deepEqual(nextStep(lead), { action: "assign", label: "Assign to me" });
  assert.equal(isUnassigned({ ...lead, status: "won" }), false);
});

test("next step walks the workflow, then quote, then convert", () => {
  const lead = (stage) => ({ status: "active", current_owner: "u1", stage });
  assert.equal(nextStep(lead("Prospect")).stage, "Contact");
  assert.equal(nextStep(lead("Received Documents")).stage, "Done KYC");
  assert.equal(nextStep(lead("Done KYC")).action, "quote");
  assert.equal(nextStep(lead("Quote & Engagement Sent")).action, "convert");
  assert.equal(nextStep({ ...lead("Prospect"), status: "lost" }), null);
});
