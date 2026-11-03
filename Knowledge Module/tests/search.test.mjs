import test from "node:test";
import assert from "node:assert/strict";
import { escapeLike, groupPriceLines } from "../logic/search.js";

const BS = String.fromCharCode(92);

test("escapeLike escapes %, _ and backslash, and keeps commas literal", () => {
  assert.equal(escapeLike("50%_off" + BS + "a,b"), "50" + BS + "%" + BS + "_off" + BS + BS + "a,b");
  assert.equal(escapeLike("plain"), "plain");
});
test("groupPriceLines keeps template and group order", () => {
  const rows = [
    { template: "Mainland", line_group: "Visa", item: "a" },
    { template: "Freezone", line_group: "Setup", item: "b" },
    { template: "Mainland", line_group: "License", item: "c" },
    { template: "Mainland", line_group: "Visa", item: "d" },
  ];
  const out = groupPriceLines(rows);
  assert.deepEqual(out.map((t) => t.template), ["Mainland", "Freezone"]);
  assert.deepEqual(out[0].groups.map((g) => g.line_group), ["Visa", "License"]);
  assert.deepEqual(out[0].groups[0].lines.map((l) => l.item), ["a", "d"]);
  assert.deepEqual(groupPriceLines([]), []);
});
