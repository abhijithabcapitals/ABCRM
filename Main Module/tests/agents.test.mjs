import test from "node:test";
import assert from "node:assert/strict";
import { agentKeyName, creditLeft, draftError, groupAgents, stepCredit, tablesPayload } from "../../Integrations Module/logic/agents.js";

test("key names pass the credential name rule", () => {
  assert.equal(agentKeyName("AGT-03-TAX"), "AGENT_KEY_AGT_03_TAX");
  assert.match(agentKeyName("AGT-03-TAX"), /^[A-Z][A-Z0-9_]{1,99}$/);
});

test("agents group in sort order", () => {
  const out = groupAgents([
    { id: "b", group_name: "G2", sort_order: 2 },
    { id: "a", group_name: "G1", sort_order: 1 },
    { id: "c", group_name: "G1", sort_order: 3 },
  ]);
  assert.deepEqual(out.map((g) => g.name), ["G1", "G2"]);
  assert.deepEqual(out[0].items.map((a) => a.id), ["a", "c"]);
});

test("credit goes up and down", () => {
  assert.equal(stepCredit(10, 5), 15);
  assert.equal(stepCredit(10, -5), 5);
  assert.equal(stepCredit(null, 5), 5);
});
test("credit never goes below zero", () => assert.equal(stepCredit(3, -5), 0));
test("credit keeps cents exact", () => assert.equal(stepCredit(0.1, 0.2), 0.3));
test("credit left can show an overspend", () => {
  assert.equal(creditLeft(10, 2.5), 7.5);
  assert.equal(creditLeft(1, 2), -1);
  assert.equal(creditLeft(undefined, undefined), 0);
});

test("only read and write tables are sent", () => {
  const tables = [
    { schema_name: "public", table_name: "a" },
    { schema_name: "public", table_name: "b" },
    { schema_name: "acct", table_name: "c" },
  ];
  assert.deepEqual(tablesPayload({ "public.a": "read", "public.b": "none", "acct.c": "write" }, tables), [
    { schema_name: "public", table_name: "a", level: "read" },
    { schema_name: "acct", table_name: "c", level: "write" },
  ]);
});
test("a saved table no longer listed is dropped", () => assert.deepEqual(tablesPayload({ "public.gone": "read" }, []), []));

test("draft checks", () => {
  const ok = { name: "A", model: "m", monthly_budget_usd: "" };
  assert.equal(draftError(ok), "");
  assert.match(draftError({ ...ok, name: " " }), /name/);
  assert.match(draftError({ ...ok, model: "" }), /model/);
  assert.match(draftError({ ...ok, monthly_budget_usd: "-1" }), /budget/);
  assert.match(draftError({ ...ok, monthly_budget_usd: "abc" }), /budget/);
  assert.equal(draftError({ ...ok, monthly_budget_usd: "0" }), "");
  assert.equal(draftError({ ...ok, monthly_budget_usd: null }), "");
});
