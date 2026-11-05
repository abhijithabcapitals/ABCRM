import { test } from "node:test";
import assert from "node:assert/strict";
import { cellIndexAt, compareText, distinctValues, filterIsOn, groupRows, passesFilter, sortValue } from "../src/jsx/tableSortLogic.js";

const sorted = (list, dir) => [...list].sort((a, b) => compareText(a, b, dir));

test("numbers sort as numbers, with currency and commas", () => {
  assert.deepEqual(sorted(["AED 1,200", "90", "1000.50"]), ["90", "1000.50", "AED 1,200"]);
});
test("dates read DD/MM/YYYY", () => {
  assert.deepEqual(sorted(["05/11/2026", "11/05/2026", "01/12/2025"]), ["01/12/2025", "11/05/2026", "05/11/2026"]);
});
test("named and ISO dates sort with each other", () => {
  assert.deepEqual(sorted(["05 Nov 2026", "2026-01-02", "1 Feb 2026"]), ["2026-01-02", "1 Feb 2026", "05 Nov 2026"]);
});
test("codes keep their number order", () => {
  assert.deepEqual(sorted(["CL000010", "CL000002"]), ["CL000002", "CL000010"]);
  assert.equal(sortValue("CL000010").kind, "text");
});
test("blanks go last in both directions", () => {
  assert.deepEqual(sorted(["b", "–", "a"], "asc"), ["a", "b", "–"]);
  assert.deepEqual(sorted(["b", "", "a"], "desc"), ["b", "a", ""]);
});
test("a filter takes typed text and unticked values", () => {
  assert.equal(passesFilter("Open", { text: "op", excluded: [] }), true);
  assert.equal(passesFilter("Closed", { text: "op", excluded: [] }), false);
  assert.equal(passesFilter("Open", { text: "", excluded: ["Open"] }), false);
  assert.equal(passesFilter("", { text: "", excluded: ["(Blank)"] }), false);
  assert.equal(passesFilter("x", undefined), true);
});
test("an empty filter is off", () => {
  assert.equal(filterIsOn({ text: " ", excluded: [] }), false);
  assert.equal(filterIsOn({ text: "", excluded: ["a"] }), true);
});
test("values are counted, A to Z, blank last", () => {
  assert.deepEqual(distinctValues(["b", "", "a", "b"]), [{ label: "a", count: 1 }, { label: "b", count: 2 }, { label: "(Blank)", count: 1 }]);
});
test("a wide row stays with the row above, or in place when first", () => {
  const row = { cells: 3, colSpan: 1 };
  const wide = { cells: 1, colSpan: 3 };
  assert.deepEqual(groupRows([wide, row, wide, row]), { pinned: [0], groups: [[1, 2], [3]] });
});
test("a column finds its cell across spans", () => {
  assert.equal(cellIndexAt([2, 1], 1), 0);
  assert.equal(cellIndexAt([2, 1], 2), 1);
  assert.equal(cellIndexAt([1], 3), -1);
});
