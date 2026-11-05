import test from "node:test";
import assert from "node:assert/strict";
import { barId, dropSide, isTabBar } from "../src/jsx/DragTabs.js";
import { GRANTABLE_TABS, canOpenClients, initialView, moveTab, orderTabs, readTabOrder, resolveView, startView, toggleAllTabs } from "../src/tabs.js";

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
test("any tablist and the Messenger tabs are bars too; a fixed sequence stays fixed", () => {
  assert.equal(isTabBar("div", { role: "tablist" }), true);
  assert.equal(isTabBar("div", { className: "msgr-tabs" }), true);
  assert.equal(isTabBar("div", { role: "tablist", className: "bk-tabs bk-cm-stages" }), false);
  assert.equal(isTabBar("button", { role: "tablist" }), false);
  assert.equal(isTabBar("div", { className: "bk-segments" }), false);
});
test("the drop marker shows the side the dragged tab will land on", () => {
  const keys = ["a", "b", "c"];
  assert.equal(dropSide(keys, "a", "c"), "after");
  assert.equal(dropSide(keys, "c", "a"), "before");
  assert.equal(dropSide(keys, "b", "b"), null);
  assert.equal(dropSide(keys, null, "b"), null);
  assert.deepEqual(moveTab(keys, "a", "c"), ["b", "c", "a"]);
  assert.deepEqual(moveTab(keys, "c", "a"), ["c", "a", "b"]);
});
test("two loaded copies of the usage module share one signed-in user", async () => {
  const one = await import("../src/jsx/selectUsage.js?copy=1");
  const two = await import("../src/jsx/selectUsage.js?copy=2");
  one.setUsageUser("person-1");
  assert.equal(two.usageUser(), "person-1");
  one.setUsageUser(null);
  assert.equal(two.usageUser(), null);
});
test("a named bar keeps its identity when a tab is added; an unnamed one is known by its tabs", () => {
  assert.equal(barId("HR", ["a", "b"]), barId("HR", ["a", "b", "c"]));
  assert.notEqual(barId("Status", ["a"]), barId("Status", ["z"]));
  assert.equal(barId(undefined, ["b", "a"]), "a,b");
});

test("ArdentTax (ASP) stays a grant an admin can give", () => assert.ok(GRANTABLE_TABS.some((t) => t.key === "ardentax")));
test("the old ArdentTax page now opens Template Hub", () => {
  assert.equal(resolveView("ardentax", true, []), "quotations");
  assert.equal(resolveView("ardentax", false, ["ardentax", "quotations"]), "quotations");
  assert.equal(initialView("", "ardentax").view, "quotations");
  assert.equal(initialView("", "ardentax").write, true);
});
test("the ArdentTax grant alone opens no page", () => {
  assert.equal(resolveView("ardentax", false, ["ardentax"]), "profile");
  assert.equal(resolveView("ardentax", false, ["hr"]), "hr");
});

test("a saved Email Agent page is retired", () => assert.equal(startView("", "email-agent"), null));
test("an Email Agent address is retired", () => assert.equal(startView("?view=email-agent", "hr"), null));
test("other saved pages still open", () => assert.equal(startView("", "hr"), "hr"));
test("the address still wins", () => assert.equal(startView("?view=messenger", "hr"), "messenger"));

test("Open Client is offered to admins and to holders of the clients tab only", () => {
  assert.equal(canOpenClients(true, null), true);
  assert.equal(canOpenClients(false, ["mytasks", "clients"]), true);
  assert.equal(canOpenClients(false, ["mytasks"]), false);
  assert.equal(canOpenClients(false, null), false);
});
