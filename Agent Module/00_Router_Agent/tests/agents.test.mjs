// The three agents Bruno can reach must support router mode and keep their normal replies.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = join(fileURLToPath(new URL("..", import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const support = read("Hot Alerts Module/supabase/support-agent/index.ts");
const bd = read("Business Development Module/supabase/bd-agent/index.ts");
const ceo = read("Agent Module/11_Personal_Agent/CEO Agent Module/supabase/ceo-agent/index.ts");

for (const [name, src] of [["Support", support], ["BD", bd], ["CEO", ceo]]) {
  test(`${name} has a router mode`, () => assert.match(src, /body\.router === true/));
  test(`${name} can report no information`, () => assert.match(src, /NO_INFO/));
  test(`${name} reports its cost`, () => assert.match(src, /cost_usd/));
  test(`${name} carries the router rule`, () => assert.match(src, /ROUTER_RULE/));
}

test("Support keeps its normal fallback", () => assert.match(support, /"I don't have an answer for that\."/));
test("CEO keeps its normal fallback", () => assert.match(ceo, /"That took too many steps\. Try splitting the request\."/));
test("CEO keeps Done for a saved item", () => assert.match(ceo, /"Done\."/));
