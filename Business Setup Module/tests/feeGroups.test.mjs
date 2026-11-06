// Services & Fees grouping (025): Category, then Group.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FEE_CATEGORIES, categoryOptions, feeCategory, groupFees, unlinkedLists } from "../logic/feeGroups.js";

const lists = [{ id: "s1", category: "Visa & Immigration", name: "Visa Renewal", steps: [{}, {}] }, { id: "s9", category: "Corporate Compliance", name: "Loose list", steps: [{}] }];
const fees = [
  { id: "a", grp: "Visa & Immigration", name: "Visa Renewal", category: "Visa & Immigration", checkpoint_set_id: "s1" },
  { id: "b", grp: "Visa renewal", name: "Medical & EID", category: "Visa & Immigration", sort_order: 2 },
  { id: "c", grp: "Visa renewal", name: "ILUE", category: "Visa & Immigration", sort_order: 1 },
  { id: "d", grp: "Mainland", name: "New Client", category: "Company Formation" },
  { id: "e", grp: "Odd", name: "Courier", category: null },
];

test("the ten categories follow the service list's sections A to J", () => {
  assert.equal(FEE_CATEGORIES.length, 10);
  assert.equal(FEE_CATEGORIES[0], "Company Formation");
  assert.equal(FEE_CATEGORIES[9], "Additional Business Support Services");
});

test("a fee's category: its own, else its checklist's, else its group", () => {
  assert.equal(feeCategory({ category: "X", grp: "G" }), "X");
  assert.equal(feeCategory({ category: null, grp: "G", checkpoint_set_id: "s1" }, { s1: lists[0] }), "Visa & Immigration");
  assert.equal(feeCategory({ category: " ", grp: "G" }), "G");
});

test("groups: categories in A to J order then others, the category's own group first, items by sort order", () => {
  const g = groupFees(fees, lists);
  assert.deepEqual(g.map((c) => c.category), ["Company Formation", "Visa & Immigration", "Odd"]);
  const visa = g[1];
  assert.equal(visa.count, 3);
  assert.deepEqual(visa.groups.map((x) => x.grp), ["Visa & Immigration", "Visa renewal"]);
  assert.deepEqual(visa.groups[1].items.map((x) => x.name), ["ILUE", "Medical & EID"]);
  assert.equal(visa.groups[0].items[0].list.steps.length, 2);
});

test("search matches item, group, category or checklist, every word", () => {
  assert.deepEqual(groupFees(fees, lists, "medical").map((c) => c.count), [1]);
  assert.deepEqual(groupFees(fees, lists, "mainland client").map((c) => c.category), ["Company Formation"]);
  assert.deepEqual(groupFees(fees, lists, "visa").map((c) => c.count), [3]);
  assert.deepEqual(groupFees(fees, lists, "nothing here"), []);
});

test("lists no fee item uses, and the form's category choices", () => {
  assert.deepEqual(unlinkedLists(fees, lists).map((l) => l.id), ["s9"]);
  const opts = categoryOptions(fees, "Mine");
  assert.deepEqual(opts.slice(0, 10), FEE_CATEGORIES);
  assert.deepEqual(opts.slice(10), ["Mine"]);
});

test("the fee form carries the category, and the checklist opens from the fee row", () => {
  const src = readFileSync(fileURLToPath(new URL("../components/FeeMaster.jsx", import.meta.url)), "utf8");
  assert.match(src, /name: "category"[^}]*type: "select"/);
  assert.match(src, /steps<\/Button>/);
  assert.match(src, /Expand all/); assert.match(src, /Collapse all/);
  assert.match(src, /const \{ list, \.\.\.rest \} = r/);
});
