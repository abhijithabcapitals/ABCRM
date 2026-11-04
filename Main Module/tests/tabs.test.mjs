import test from "node:test";
import assert from "node:assert/strict";
import { barId, isTabBar } from "../src/jsx/DragTabs.js";
import { GRANTABLE_TABS, moveTab, orderTabs, readTabOrder, toggleAllTabs } from "../src/tabs.js";

const every = GRANTABLE_TABS.map((t) => t.key);

test("All selects every tab from none", () => assert.deepEqual(toggleAllTabs([]), every));
test("All selects every tab from some", () => assert.deepEqual(toggleAllTabs(["hr"]), every));
test("All clears when every tab is on", () => assert.deepEqual(toggleAllTabs(every), []));
test("All only grants grantable tabs, never admin-only ones", () => {
  for (const k of ["settings", "ceo", "email-agent"]) assert.ok(!toggleAllTabs([]).includes(k));
});

test("dragging down lands on the target's place", () => assert.deepEqual(moveTab(["a", "b", "c", "d"], "a", "c"), ["b", "c", "a", "d"]));
test("dragging up lands on the target's place", () => assert.deepEqual(moveTab(["a", "b", "c", "d"], "d", "b"), ["a", "d", "b", "c"]));
test("dropping on itself or an unknown tab changes nothing", () => {
  assert.deepEqual(moveTab(["a", "b"], "a", "a"), ["a", "b"]);
  assert.deepEqual(moveTab(["a", "b"], "x", "a"), ["a", "b"]);
});
test("saved order applies; tabs not in it stay last in their usual order", () => {
  const items = ["a", "b", "c", "d"].map((key) => ({ key }));
  assert.deepEqual(orderTabs(items, ["c", "a"]).map((i) => i.key), ["c", "a", "b", "d"]);
  assert.deepEqual(orderTabs(items, ["gone", "d"]).map((i) => i.key), ["d", "a", "b", "c"]);
});
test("no browser storage reads as no saved order", () => assert.deepEqual(readTabOrder("u"), []));

test("tab bars are found by their class; onboarding stages stay fixed", () => {
  assert.equal(isTabBar("nav", { className: "bk-nav" }), true);
  assert.equal(isTabBar("div", { className: "x bk-tabs" }), true);
  assert.equal(isTabBar("div", { className: "bk-tabs bk-cm-stages" }), false);
  assert.equal(isTabBar("button", { className: "bk-tabs" }), false);
  assert.equal(isTabBar("div", { className: "bk-tabset" }), false);
  assert.equal(isTabBar("div", { className: "tabs" }), true);
  assert.equal(isTabBar("div", {}), false);
});
test("a named bar keeps its identity when a tab is added; an unnamed one is known by its tabs", () => {
  assert.equal(barId("HR", ["a", "b"]), barId("HR", ["a", "b", "c"]));
  assert.notEqual(barId("Status", ["a"]), barId("Status", ["z"]));
  assert.equal(barId(undefined, ["b", "a"]), "a,b");
});
