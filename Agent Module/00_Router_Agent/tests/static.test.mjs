// Checks that need no network or database: what router-agent must never do, read from its source.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const here = fileURLToPath(new URL("..", import.meta.url));
const root = join(here, "..", "..");
const read = (...p) => readFileSync(join(here, ...p), "utf8");
const src = read("supabase/router-agent/index.ts");

test("the browser cannot name an agent", () => assert.doesNotMatch(src, /body\.(agent|agent_id|to|fn)\b/));
test("agents get the person's own login", () => assert.match(src, /Authorization: authHeader/));
test("function URLs come from the fixed list", () => assert.match(src, /ROUTES\[/));
test("log lines hold no message text", () => assert.doesNotMatch(src, /console\.\w+\([^)]*(message|question|reply)/));
test("the audit job does not cover the router schema", () => {
  const sql = readFileSync(join(root, "Database Module/Admin Base/migrations/003_audit_trail.sql"), "utf8");
  assert.match(sql, /n\.nspname in \('public', 'acct', 'ceo', 'email_base', 'email_agent'\)/);
  assert.doesNotMatch(sql, /'router'/);
});
