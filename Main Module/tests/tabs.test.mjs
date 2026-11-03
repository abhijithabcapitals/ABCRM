import test from "node:test";
import assert from "node:assert/strict";
import { GRANTABLE_TABS, toggleAllTabs } from "../src/tabs.js";

const every = GRANTABLE_TABS.map((t) => t.key);

test("All selects every tab from none", () => assert.deepEqual(toggleAllTabs([]), every));
test("All selects every tab from some", () => assert.deepEqual(toggleAllTabs(["hr"]), every));
test("All clears when every tab is on", () => assert.deepEqual(toggleAllTabs(every), []));
test("All only grants grantable tabs, never admin-only ones", () => {
  for (const k of ["settings", "ceo", "email-agent"]) assert.ok(!toggleAllTabs([]).includes(k));
});
