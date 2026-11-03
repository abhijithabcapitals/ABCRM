// Checks what no database is needed for: every rpc call names a real function with real parameters, every table
// used exists, every permission the UI asks for is one the database knows, and the navigation follows permissions.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { NAV, visibleNav } from "../logic/nav.js";

const here = fileURLToPath(new URL("..", import.meta.url));
const dbDir = join(here, "../Database Module/Business Setup Base/migrations");
const sql = readdirSync(dbDir).map((f) => readFileSync(join(dbDir, f), "utf8")).join("\n");
const src = ["components", "components/workspace", "services", "logic"].flatMap((d) => readdirSync(join(here, d)).filter((f) => /\.jsx?$/.test(f)).map((f) => readFileSync(join(here, d, f), "utf8"))).join("\n");

const fns = {};
for (const m of sql.matchAll(/create or replace function public\.(business_setup_\w+)\(([^)]*)\)/g)) {
  fns[m[1]] = m[2].split(",").map((a) => a.trim().split(/\s+/)[0]).filter(Boolean);
}
const known = new Set([...(sql.match(/array\[\s*('setup\.[\w.]+'|'kyc\.\w+'|,|\s)+\]/)?.[0] || "").matchAll(/'([\w.]+)'/g)].map((m) => m[1]));

test("rpc calls match database functions", () => {
  const bad = [];
  for (const m of src.matchAll(/rpc\("(business_setup_\w+)"(?:,\s*\{([^}]*)\})?/g)) {
    if (!fns[m[1]]) { bad.push(`missing ${m[1]}`); continue; }
    for (const k of (m[2] || "").matchAll(/(?:^|[,\s{])(p(?:_\w+)?)\s*:/g)) if (!fns[m[1]].includes(k[1])) bad.push(`${m[1]} has no ${k[1]}`);
  }
  assert.deepEqual(bad, []);
});

test("tables used in the UI exist", () => {
  const bad = new Set();
  for (const m of src.matchAll(/table\("(business_setup_\w+)"/g)) if (!sql.includes(`public.${m[1]} (`)) bad.add(m[1]);
  assert.deepEqual([...bad], []);
});

test("the foundation functions exist", () => {
  for (const f of ["business_setup_can", "business_setup_require", "business_setup_permissions", "business_setup_my_access", "business_setup_audit", "business_setup_touch", "business_setup_settings_save"]) assert.ok(fns[f], f);
});

test("the navigation asks only for permissions the database knows", () => {
  assert.ok(known.has("setup.access") && known.has("kyc.manage"), "permission list parsed");
  const bad = NAV.flatMap(([, , perm]) => [].concat(perm)).filter((p) => !known.has(p));
  assert.deepEqual(bad, []);
  const used = [...src.matchAll(/can\("([\w.]+)"\)/g)].map((m) => m[1]).filter((p) => !known.has(p));
  assert.deepEqual(used, []);
});

test("navigation follows the spec and is filtered by permission", () => {
  assert.deepEqual(NAV.map(([k]) => k), ["dashboard", "onboarding", "clients", "services", "documents", "tasks", "import", "settings"]);
  assert.deepEqual(visibleNav(() => false), []);
  const readOnly = new Set(["setup.access"]);
  assert.deepEqual(visibleNav((p) => readOnly.has(p)).map(([k]) => k), ["dashboard", "clients", "services", "documents", "tasks", "settings"]);
  const importer = new Set(["setup.access", "setup.import.manage"]);
  assert.ok(visibleNav((p) => importer.has(p)).some(([k]) => k === "import"));
});

test("the shell opens each page of the spec", () => {
  const shell = readFileSync(join(here, "components/BusinessSetup.jsx"), "utf8");
  for (const c of ["Dashboard", "Onboarding", "Clients", "FeeMaster", "Documents", "Tasks", "Import", "Settings"]) assert.match(shell, new RegExp(`<${c} />`));
  assert.match(shell, /myAccess\(\)/);
  assert.match(readFileSync(join(here, "services/businessSetupApi.js"), "utf8"), /rpc\("business_setup_my_access"\)/);
});
