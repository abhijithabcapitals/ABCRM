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

test("components never mention client_secret or refresh_token", () => {
  const dir = join(here, "components");
  for (const f of readdirSync(dir).filter((f) => /\.jsx?$/.test(f))) {
    const text = readFileSync(join(dir, f), "utf8");
    assert.ok(!/client_secret|refresh_token/i.test(text), `${f} mentions a token word`);
  }
});

test("zoho-books has no PUT or DELETE outside tests", () => {
  const dir = join(here, "supabase", "zoho-books");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
    assert.ok(!/\b(PUT|DELETE)\b/.test(readFileSync(join(dir, f), "utf8")), `${f} has PUT or DELETE`);
  }
});

test("zoho-books/secrets.ts matches the shared copy", () => {
  const norm = (s) => s.replace(/\r\n/g, "\n");
  assert.equal(norm(read("supabase", "zoho-books", "secrets.ts")), norm(read("supabase", "_shared", "secrets.ts")));
});
