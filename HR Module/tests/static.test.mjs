// Checks that need no database: every hr_* table turns row-level security on, and only services/hrApi.js talks to Supabase.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const here = fileURLToPath(new URL("..", import.meta.url));
const migDir = join(here, "../Database Module/HR Base/migrations");
const sql = readdirSync(migDir).filter((f) => f.endsWith(".sql")).map((f) => readFileSync(join(migDir, f), "utf8")).join("\n");

test("every hr_* table enables row level security", () => {
  const tables = new Set([...sql.matchAll(/create table if not exists public\.(hr_\w+)/gi)].map((m) => m[1]));
  assert.ok(tables.size >= 14, `expected at least 14 hr_ tables, found ${tables.size}`);
  const bare = [...sql.matchAll(/create table (?!if not exists)public\.(hr_\w+)/gi)].map((m) => m[1]);
  assert.deepEqual(bare, [], "create table without if not exists");
  const off = [...tables].filter((t) => !new RegExp(`alter table public\\.${t} enable row level security`, "i").test(sql));
  assert.deepEqual(off, []);
});

function files(dir) {
  return readdirSync(join(here, dir)).filter((f) => /\.(jsx?|mjs)$/.test(f)).map((f) => [`${dir}/${f}`, readFileSync(join(here, dir, f), "utf8")]);
}

test("only services/hrApi.js imports the Supabase client", () => {
  const all = [...files("components"), ...files("services"), ...files("logic"), ["index.js", readFileSync(join(here, "index.js"), "utf8")]];
  const users = all.filter(([, src]) => /@app\/supabase|@supabase\/supabase-js|from\s+["'][^"']*supabase["']/.test(src)).map(([f]) => f);
  assert.deepEqual(users, ["services/hrApi.js"]);
});
