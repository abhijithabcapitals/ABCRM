import test from "node:test";
import assert from "node:assert/strict";
import { recordUse, resetUsageCache, setUsageUser, topValues, usageFor } from "../../Main Module/src/jsx/selectUsage.js";

const store = {};
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };

test("latest choices come first, then the most used", () => {
  const u = { a: [9, 1], b: [1, 5], c: [1, 6], d: [1, 7], e: [4, 2], f: [2, 3], g: [1, 4] };
  assert.deepEqual(topValues(u, Object.keys(u)), ["d", "c", "b", "a", "e", "f"]);
});
test("choices no longer on offer are ignored, and one use is not frequent", () => {
  assert.deepEqual(topValues({ a: [5, 9], b: [1, 1] }, ["b", "c"]), ["b"]);
  assert.deepEqual(topValues(undefined, ["a"]), []);
  assert.deepEqual(topValues({ a: [1, 5], b: [1, 4], c: [1, 3], d: [1, 2] }, ["a", "b", "c", "d"]), ["a", "b", "c"]);
});
test("use is counted per user and per field, and blanks are skipped", () => {
  setUsageUser("u1");
  recordUse("status", "Open", 10);
  recordUse("status", "Open", 20);
  recordUse("status", "", 30);
  recordUse("other", "Open", 40);
  assert.deepEqual(usageFor("status"), { Open: [2, 20] });
  resetUsageCache();
  assert.deepEqual(usageFor("status"), { Open: [2, 20] });
  setUsageUser("u2");
  assert.equal(usageFor("status"), undefined);
});
test("each field keeps a limited history", () => {
  setUsageUser("u3");
  for (let i = 0; i < 40; i++) recordUse("f", `v${i}`, i);
  const kept = Object.keys(usageFor("f"));
  assert.equal(kept.length, 30);
  assert.ok(kept.includes("v39") && !kept.includes("v0"));
});
