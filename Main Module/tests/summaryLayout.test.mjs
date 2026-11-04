import test from "node:test";
import assert from "node:assert/strict";
import {
  SUMMARY_CARDS, ZOHO_CARDS_LIVE, visibleCards, mergeLayout, readLayout, saveLayout, clearLayout, canSaveLayout, layoutToStore,
  moveCard, stepCard, toggleCollapsed, setGroupCollapsed, nextDragMove,
} from "../../Dashboard Module/logic/summaryLayout.js";

const mk = (id, group = "departments") => ({ id, group, title: id, tab: null, view: null });
const cards = [mk("bd"), mk("hr"), mk("tax")];
const base = () => ({ order: { departments: ["bd", "hr", "tax"], zoho: [] }, collapsed: [] });
const withStorage = (impl, fn) => {
  const prev = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { value: impl, configurable: true, writable: true });
  try { return fn(); } finally { prev ? Object.defineProperty(globalThis, "localStorage", prev) : delete globalThis.localStorage; }
};

test("card titles match the spec", () => {
  assert.deepEqual(Object.fromEntries(SUMMARY_CARDS.map((c) => [c.id, c.title])), {
    bd: "Business Development", banking: "Business Banking", setup: "Business Setup", accounting: "Accounting",
    hr: "HR", tax: "Tax Compliance", notifications: "Notifications", health: "Company Health",
    ar: "Accounts Receivable", ap: "Accounts Payable", ratios: "Financial Ratios", revenue: "Revenue", cost: "Cost", cash: "Cash",
  });
});
test("admin sees all 14 cards", () => {
  assert.equal(SUMMARY_CARDS.length, 14);
  assert.equal(visibleCards(SUMMARY_CARDS, { isAdmin: true, tabs: [] }).length, 14);
});
test("staff see their tab cards plus notifications", () => {
  const ids = visibleCards(SUMMARY_CARDS, { isAdmin: false, tabs: ["hr"] }).map((c) => c.id);
  assert.deepEqual(ids.sort(), ["hr", "notifications"]);
});
test("no tab list shows notifications only", () => {
  assert.deepEqual(visibleCards(SUMMARY_CARDS, { isAdmin: false, tabs: null }).map((c) => c.id), ["notifications"]);
});

test("no saved layout gives list order, nothing collapsed", () => {
  assert.deepEqual(mergeLayout(null, cards), base());
});
test("saved order applies, unknown ids drop, new cards go last", () => {
  const saved = { order: { departments: ["hr", "gone", "bd"] }, collapsed: [] };
  assert.deepEqual(mergeLayout(saved, cards).order.departments, ["hr", "bd", "tax"]);
});
test("junk saved layouts give the default", () => {
  assert.deepEqual(mergeLayout("rubbish", cards), base());
  assert.deepEqual(mergeLayout({ order: 5 }, cards), base());
});
test("collapsed drops ids no longer in cards", () => {
  assert.deepEqual(mergeLayout({ collapsed: ["hr", "gone"] }, cards).collapsed, ["hr"]);
});

test("readLayout gives the default when storage throws or holds bad JSON", () => {
  const throwing = { getItem() { throw new Error("blocked"); } };
  assert.deepEqual(withStorage(throwing, () => readLayout("u", cards)), base());
  const bad = { getItem: () => "{not json" };
  assert.deepEqual(withStorage(bad, () => readLayout("u", cards)), base());
});
test("readLayout and saveLayout use the per-user key", () => {
  const store = {};
  const ls = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  withStorage(ls, () => {
    saveLayout("u1", { order: { departments: ["tax", "hr", "bd"], zoho: [] }, collapsed: ["hr"] });
    assert.ok("crm-dashboard-layout:u1" in store);
    const got = readLayout("u1", cards);
    assert.deepEqual(got.order.departments, ["tax", "hr", "bd"]);
    assert.deepEqual(got.collapsed, ["hr"]);
  });
});
test("saveLayout does not throw when storage throws", () => {
  const ls = { setItem() { throw new Error("full"); } };
  withStorage(ls, () => assert.doesNotThrow(() => saveLayout("u", base())));
});

test("moveCard puts the dragged card on the target's place", () => {
  assert.deepEqual(moveCard(base(), "departments", "bd", "tax").order.departments, ["hr", "tax", "bd"]);
});
test("moveCard onto itself changes nothing; across groups does nothing", () => {
  assert.deepEqual(moveCard(base(), "departments", "hr", "hr").order, base().order);
  assert.deepEqual(moveCard(base(), "zoho", "bd", "hr").order, base().order);
});
test("stepCard moves by one and stops at the ends", () => {
  assert.deepEqual(stepCard(base(), "departments", "hr", 1).order.departments, ["bd", "tax", "hr"]);
  assert.deepEqual(stepCard(base(), "departments", "bd", -1).order, base().order);
  assert.deepEqual(stepCard(base(), "departments", "tax", 1).order, base().order);
});

test("toggleCollapsed flips one card", () => {
  const a = toggleCollapsed(base(), "hr");
  assert.deepEqual(a.collapsed, ["hr"]);
  assert.deepEqual(toggleCollapsed(a, "hr").collapsed, []);
});
test("setGroupCollapsed collapses or expands a set of cards", () => {
  const a = setGroupCollapsed({ ...base(), collapsed: ["tax"] }, ["bd", "hr"], true);
  assert.deepEqual(a.collapsed.sort(), ["bd", "hr", "tax"]);
  assert.deepEqual(setGroupCollapsed(a, ["bd", "hr"], false).collapsed, ["tax"]);
});

test("nextDragMove swaps once and ignores that card until the pointer leaves it", () => {
  let step = nextDragMove(null, "b", "a");
  assert.deepEqual(step, { move: "b", lastTarget: "b" });
  step = nextDragMove(step.lastTarget, "b", "a");
  assert.deepEqual(step, { move: null, lastTarget: "b" });
  step = nextDragMove(step.lastTarget, "a", "a");
  assert.deepEqual(step, { move: null, lastTarget: null });
  assert.deepEqual(nextDragMove(step.lastTarget, "b", "a"), { move: "b", lastTarget: "b" });
});

test("nextDragMove clears the last card over a gap and moves on to a different card", () => {
  assert.deepEqual(nextDragMove("b", undefined, "a"), { move: null, lastTarget: null });
  assert.deepEqual(nextDragMove("b", "c", "a"), { move: "c", lastTarget: "c" });
});

test("the Zoho cards are switched on", () => {
  assert.equal(ZOHO_CARDS_LIVE, true);
});

test("canSaveLayout waits for a member's tabs, and never for an admin", () => {
  assert.equal(canSaveLayout({ isAdmin: false, tabs: null }), false);
  assert.equal(canSaveLayout({ isAdmin: false, tabs: undefined }), false);
  assert.equal(canSaveLayout({ isAdmin: false, tabs: [] }), true);
  assert.equal(canSaveLayout({ isAdmin: true, tabs: null }), true);
});

const memory = (start = {}) => {
  const data = { ...start };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
};

test("layoutToStore keeps hidden cards in their slots while shown cards take the new order", () => {
  const all = [mk("a"), mk("h"), mk("b"), mk("c")];
  const stored = { order: { departments: ["a", "h", "b", "c"] }, collapsed: [] };
  const layout = { order: { departments: ["c", "a", "b"], zoho: [] }, collapsed: [] };
  assert.deepEqual(layoutToStore(stored, layout, all).order.departments, ["c", "h", "a", "b"]);
});

test("layoutToStore keeps a hidden card's collapsed state, and takes the shown cards' from the layout", () => {
  const all = [mk("a"), mk("h"), mk("b")];
  const stored = { order: { departments: ["a", "h", "b"] }, collapsed: ["h", "a"] };
  const layout = { order: { departments: ["a", "b"], zoho: [] }, collapsed: ["b"] };
  assert.deepEqual(layoutToStore(stored, layout, all).collapsed.sort(), ["b", "h"]);
});

test("layoutToStore with nothing stored places hidden cards in default order", () => {
  const all = [mk("a"), mk("h"), mk("b")];
  const layout = { order: { departments: ["b", "a"], zoho: [] }, collapsed: [] };
  assert.deepEqual(layoutToStore(null, layout, all).order.departments, ["b", "h", "a"]);
});

test("a small card list saving does not lose the rest of the stored layout", () => {
  const all = [mk("a"), mk("h"), mk("b")];
  const ls = memory();
  withStorage(ls, () => {
    saveLayout("u", { order: { departments: ["b", "h", "a"], zoho: [] }, collapsed: ["h"] }, all);
    // Only a and b show now. This is what used to wipe h.
    const shown = [mk("a"), mk("b")];
    const layout = readLayout("u", shown);
    assert.deepEqual(layout.order.departments, ["b", "a"]);
    saveLayout("u", { ...layout, order: { ...layout.order, departments: ["a", "b"] } }, all);
    const back = readLayout("u", all);
    assert.deepEqual(back.order.departments, ["a", "h", "b"]);
    assert.deepEqual(back.collapsed, ["h"]);
  });
});

test("saveLayout over unreadable stored data still saves", () => {
  const all = [mk("a"), mk("b")];
  const ls = memory({ "crm-dashboard-layout:u": "{oops" });
  withStorage(ls, () => {
    saveLayout("u", { order: { departments: ["b", "a"], zoho: [] }, collapsed: [] }, all);
    assert.deepEqual(readLayout("u", all).order.departments, ["b", "a"]);
  });
});

test("clearLayout forgets the layout, and does not throw when storage throws", () => {
  const ls = memory({ "crm-dashboard-layout:u": "{}" });
  withStorage(ls, () => clearLayout("u"));
  assert.deepEqual(ls.data, {});
  const throwing = { removeItem() { throw new Error("blocked"); } };
  withStorage(throwing, () => assert.doesNotThrow(() => clearLayout("u")));
});
