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

test("the admin-users edge function lets admins grant the knowledge tab", () => {
  const edge = readFileSync(join(here, "../Main Module/db/edge-function-admin-users.ts"), "utf8");
  const tabs = edge.match(/const TABS = \[([^\]]*)\]/);
  assert.ok(tabs, "TABS list not found");
  assert.ok(tabs[1].includes('"knowledge"'), "knowledge missing from TABS");
});

const source = (name) => code.find(([f]) => f === name)[1];
const PRIVATE = ["basis", "payee", "confidence"];

test("price line reads and writes list their columns, never *", () => {
  const api = source("services/knowledgeApi.js");
  assert.doesNotMatch(api, /from\("knowledge_price_lines"\)\.select\("\*/);
  assert.match(api, /listPriceLines[\s\S]*?select\(`\$\{PRICE_LINE_COLUMNS\}, knowledge_categories\(name\)`\)/);
  assert.doesNotMatch(api, /\.select\(\)/, "a bare select() returns every column and fails on price lines");
});

test("the service's price line columns are exactly the ones the migration grants", () => {
  const listed = source("services/knowledgeApi.js").match(/PRICE_LINE_COLUMNS = "([^"]+)"/)[1].split(",").map((c) => c.trim());
  const granted = sql.match(/grant select \(([^)]+)\)\s+on public\.knowledge_price_lines/)[1].split(",").map((c) => c.trim());
  assert.deepEqual([...listed].sort(), [...granted].sort());
  for (const column of PRIVATE) assert.ok(!listed.includes(column), column);
});

test("service rows leave out inactive categories", () => {
  assert.match(source("services/knowledgeApi.js"), /service_categories!inner\(name, department\)[\s\S]*?\.eq\("service_categories\.is_active", true\)/);
});

test("PricingView formats money through copyText, not its own rule", () => {
  const view = source("components/PricingView.jsx");
  assert.doesNotMatch(view, /toLocaleString/);
  assert.match(view, /import \{[^}]*\baed\b[^}]*\} from "\.\.\/logic\/copyText\.js"/);
});

test("PricingView hides the Business Setup empty message under the Banking filter", () => {
  assert.match(source("components/PricingView.jsx"), /inBanking \? null : \(?\s*<Empty>\{rows\.length \? "No Business Setup/);
});

test("NeedsReview bulk buttons stay disabled while busy or with nothing chosen", () => {
  const review = source("components/NeedsReview.jsx");
  assert.equal([...review.matchAll(/disabled=\{busy \|\| !chosen\.length\}/g)].length, 3);
  assert.doesNotMatch(review, /disabled=\{!chosen\.length\}/);
});

test("EditForm sends the private columns only through privateChanges", () => {
  const form = source("components/EditForm.jsx");
  assert.match(form, /\.\.\.privateChanges\(v, loaded\)/);
  for (const column of PRIVATE) assert.doesNotMatch(form, new RegExp(`\\b${column}: blank\\(`), column);
  for (const column of PRIVATE) assert.doesNotMatch(form, new RegExp(`row\\?\\.${column}`), column);
});
