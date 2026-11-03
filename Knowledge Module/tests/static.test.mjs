// Checks that need no database: every knowledge_* table turns row-level security on, only services/knowledgeApi.js talks to Supabase,
// and no Knowledge code reads the private banking columns. The service is read as text because "@app/supabase" does not resolve under node --test.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const here = fileURLToPath(new URL("..", import.meta.url));
const migDir = join(here, "../Database Module/Knowledge Base/migrations");
const sql = readdirSync(migDir).filter((f) => f.endsWith(".sql")).map((f) => readFileSync(join(migDir, f), "utf8")).join("\n");

test("every knowledge_* table enables row level security", () => {
  const tables = new Set([...sql.matchAll(/create table if not exists public\.(knowledge_\w+)/gi)].map((m) => m[1]));
  // 3 today: categories, entries, price_lines. A floor, so the regex cannot quietly match nothing. Raise it when a table is added.
  assert.ok(tables.size >= 3, `expected at least 3 knowledge_ tables, found ${tables.size}`);
  const bare = [...sql.matchAll(/create table (?!if not exists)public\.(knowledge_\w+)/gi)].map((m) => m[1]);
  assert.deepEqual(bare, [], "create table without if not exists");
  // Tables are switched on in a loop over an array of names, so accept either a literal statement or the name in that array.
  const off = [...tables].filter((t) =>
    !new RegExp(`alter table public\.${t} enable row level security`, "i").test(sql)
    && !(/enable row level security/i.test(sql) && new RegExp(`'${t}'`).test(sql)));
  assert.deepEqual(off, []);
});

// The test file itself holds the forbidden strings, so only these three folders are scanned. components/ may not exist yet.
function files(dir) {
  const full = join(here, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full).filter((f) => /\.(jsx?|mjs)$/.test(f)).map((f) => [`${dir}/${f}`, readFileSync(join(full, f), "utf8")]);
}
const code = [...files("components"), ...files("services"), ...files("logic")];

test("only services/knowledgeApi.js imports the Supabase client", () => {
  const users = code.filter(([, src]) => /@app\/supabase|@supabase\/supabase-js|from\s+["'][^"']*supabase["']/.test(src)).map(([f]) => f);
  assert.deepEqual(users, ["services/knowledgeApi.js"]);
});

test("no Knowledge code reads the private banking columns", () => {
  const hits = code.filter(([, src]) => /service_fee_min|service_fee_max|banking_pricing/.test(src)).map(([f]) => f);
  assert.deepEqual(hits, []);
});
