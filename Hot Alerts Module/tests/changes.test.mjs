import test from "node:test";
import assert from "node:assert/strict";
import { filterChanges, changeWhat, showValue } from "../logic/changesLogic.js";
import { changesMadeList, changesMadeMarkSeen } from "../services/alertsApi.js";

const items = [
  { field: "Trade License Number", client_name: "One LLC", changed_by_name: "Asha" },
  { field: "License Expiry Date", client_name: "One LLC" },
  { field: "Emirates ID", person: "Omar", client_name: "Two LLC" },
  { field: "Passport Number", person: "Omar", client_name: "Two LLC" },
  { field: "Passport Expiry", person: "Omar", client_name: "Two LLC" },
  { field: "Shareholders", client_name: "One LLC" },
  { field: "Company Registration Number", client_name: "Three FZE" },
];

test("All keeps everything", () => assert.equal(filterChanges(items).length, 7));
test("Trade License groups licence fields", () => assert.deepEqual(filterChanges(items, "Trade License").map((c) => c.field), ["Trade License Number", "License Expiry Date"]));
test("Passport takes passport expiry, dates do not", () => {
  assert.equal(filterChanges(items, "Passport").length, 2);
  assert.ok(!filterChanges(items, "Registration & Dates").some((c) => /Passport/.test(c.field)));
});
test("Registration & Dates takes registration number", () => assert.ok(filterChanges(items, "Registration & Dates").some((c) => c.field === "Company Registration Number")));
test("search matches client, person and who", () => {
  assert.equal(filterChanges(items, "All", "two").length, 3);
  assert.equal(filterChanges(items, "All", "asha").length, 1);
});
test("changeWhat names the person", () => {
  assert.equal(changeWhat({ person: "Omar", field: "Emirates ID" }), "Omar: Emirates ID");
  assert.equal(changeWhat({ person: "Omar", field: "Shareholder / Partner added" }), "Shareholder / Partner added");
  assert.equal(changeWhat({ field: "Trade License Number" }), "Trade License Number");
});
test("blank shows as (blank)", () => { assert.equal(showValue(null), "(blank)"); assert.equal(showValue(" "), "(blank)"); assert.equal(showValue("x"), "x"); });

const stub = () => { const s = { rpc: async (fn, args) => { s.last = { fn, args }; return { data: { allowed: true }, error: null }; } }; return s; };
test("list and mark seen call their functions", async () => {
  const s = stub();
  await changesMadeList(s, 7, 50);
  assert.deepEqual(s.last, { fn: "changes_made_list", args: { p_days: 7, p_limit: 50 } });
  await changesMadeMarkSeen(s);
  assert.equal(s.last.fn, "changes_made_mark_seen");
});
