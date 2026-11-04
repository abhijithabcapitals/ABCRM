// Checks that need no network or database: the registry lists the Zoho names, the browser code holds no Zoho
// token words, and the zoho-books function stays read-only and shares the common secrets helper.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const here = fileURLToPath(new URL("..", import.meta.url));
const read = (...p) => readFileSync(join(here, ...p), "utf8");
const registry = JSON.parse(read("registry.json"));

test("registry lists all six Zoho names with source and use", () => {
  const zoho = registry.groups.flatMap((g) => g.integrations).find((i) => i.id === "zoho-books");
  assert.ok(zoho, "zoho-books entry missing");
  for (const name of ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN", "ZOHO_BOOKS_ORG_ID", "ZOHO_DC", "ZOHO_VAT_TAX_ID"]) {
    const s = zoho.secrets.find((x) => x.name === name);
    assert.ok(s, `${name} missing`);
    assert.ok(s.source && s.use, `${name} needs source and use`);
  }
  assert.equal(zoho.status, "in_use");
  assert.equal(zoho.usedBy, "zoho-books function");
});

test("Zoho sub tabs keep the read-only login apart from the drafts login", () => {
  const zoho = registry.groups.flatMap((g) => g.integrations).find((i) => i.id === "zoho-books");
  const tab = (id) => zoho.subTabs.find((t) => t.id === id);
  assert.deepEqual(tab("invoices").secrets, ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN", "ZOHO_BOOKS_ORG_ID", "ZOHO_DC", "ZOHO_VAT_TAX_ID"]);
  assert.deepEqual(tab("financials").secrets, ["ZOHO_FINANCE_CLIENT_ID", "ZOHO_FINANCE_CLIENT_SECRET", "ZOHO_FINANCE_REFRESH_TOKEN"]);
  const names = new Set(zoho.secrets.map((s) => s.name));
  assert.equal(names.size, zoho.secrets.length, "a Zoho name is listed twice");
  for (const t of zoho.subTabs) for (const n of t.secrets) assert.ok(names.has(n), `${n} is not in secrets`);
  for (const n of names) assert.ok(zoho.subTabs.some((t) => t.secrets.includes(n)), `${n} is on no tab`);
});

test("components never mention client_secret or refresh_token", () => {
  const dir = join(here, "components");
  const files = readdirSync(dir).filter((f) => /\.jsx?$/.test(f));
  assert.ok(files.length > 0, "no component files found");
  for (const f of files) {
    const text = readFileSync(join(dir, f), "utf8");
    assert.ok(!/client_secret|refresh_token/i.test(text), `${f} mentions a token word`);
  }
});

test("zoho-books has no PUT or DELETE outside tests", () => {
  const dir = join(here, "supabase", "zoho-books");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  assert.ok(files.length > 0, "no function files found");
  for (const f of files) {
    assert.ok(!/\b(PUT|DELETE)\b/.test(readFileSync(join(dir, f), "utf8")), `${f} has PUT or DELETE`);
  }
});

test("zoho-books/secrets.ts matches the shared copy", () => {
  const norm = (s) => s.replace(/\r\n/g, "\n");
  const shared = norm(read("supabase", "_shared", "secrets.ts"));
  assert.ok(shared.trim().length > 0, "shared secrets.ts is empty");
  assert.equal(norm(read("supabase", "zoho-books", "secrets.ts")), shared);
});

test("zoho-finance has no PUT or DELETE outside tests", () => {
  const dir = join(here, "supabase", "zoho-finance");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  assert.ok(files.length > 0, "no function files found");
  for (const f of files) {
    assert.ok(!/\b(PUT|DELETE)\b/.test(readFileSync(join(dir, f), "utf8")), `${f} has PUT or DELETE`);
  }
});

test("zoho-finance/secrets.ts matches the shared copy", () => {
  const norm = (s) => s.replace(/\r\n/g, "\n");
  const shared = norm(read("supabase", "_shared", "secrets.ts"));
  assert.ok(shared.trim().length > 0, "shared secrets.ts is empty");
  assert.equal(norm(read("supabase", "zoho-finance", "secrets.ts")), shared);
});

test("zoho-finance reads only the finance refresh token", () => {
  const index = read("supabase", "zoho-finance", "index.ts");
  assert.ok(index.includes("ZOHO_FINANCE_REFRESH_TOKEN"));
  assert.ok(!index.includes(`"ZOHO_REFRESH_TOKEN"`));
});
