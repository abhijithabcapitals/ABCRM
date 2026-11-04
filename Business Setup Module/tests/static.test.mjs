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
// Every permission list in the migrations (001 first, 013 adds setup.leads.manage and setup.cases.approve).
const known = new Set([...sql.matchAll(/array\[\s*(?:'(?:setup|kyc)\.[\w.]+'|,|\s)+\]/g)].flatMap((a) => [...a[0].matchAll(/'([\w.]+)'/g)].map((m) => m[1])));

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
  assert.deepEqual(NAV.map(([k]) => k), ["dashboard", "leads", "review", "documentation", "cases", "clients", "services", "tasks", "settings"]);
  assert.deepEqual(visibleNav(() => false), []);
  assert.ok(!visibleNav((p) => p === "setup.access").some(([k]) => k === "review"));
  const readOnly = new Set(["setup.access"]);
  assert.deepEqual(visibleNav((p) => readOnly.has(p)).map(([k]) => k), ["dashboard", "leads", "documentation", "cases", "clients", "services", "tasks", "settings"]);
  assert.ok(visibleNav((p) => p === "setup.access" || p === "setup.kyc.manage").some(([k]) => k === "review"));
});

test("the shell opens each page of the spec", () => {
  const shell = readFileSync(join(here, "components/BusinessSetup.jsx"), "utf8");
  for (const c of ["Dashboard", "Leads", "Onboarding", "DocumentationPage", "Cases", "Clients", "FeeMaster", "Tasks", "Settings"]) assert.match(shell, new RegExp(`<${c} />`));
  assert.doesNotMatch(shell, /<Import \/>/);
  assert.match(readFileSync(join(here, "components/Settings.jsx"), "utf8"), /<Import \/>/);
  assert.match(shell, /myAccess\(\)/);
  assert.match(readFileSync(join(here, "services/businessSetupApi.js"), "utf8"), /rpc\("business_setup_my_access"\)/);
});

test("the dashboard shows the six planned figures, each opening its list", () => {
  const src = readFileSync(join(here, "components/Dashboard.jsx"), "utf8");
  const block = src.slice(src.indexOf("export const FIGURES"), src.indexOf("const STAGES"));
  const rows = [...block.matchAll(/\["(\w+)", "([^"]+)", "(\w+)"\]/g)].map((m) => m.slice(1));
  assert.deepEqual(rows.map((r) => r[0]), ["processes_pending", "receivables", "cases_completed_month", "pipeline_total", "forms_to_review", "pending_after_kyc"]);
  // Targets: leads, review, documentation and cases are screens of the case pipeline, all in NAV.
  for (const k of ["cases", "clients", "leads", "review", "documentation"]) assert.ok(NAV.some(([n]) => n === k), k);
  assert.deepEqual(rows.map((r) => r[2]), ["cases", "clients", "cases", "leads", "review", "documentation"]);
  assert.match(src, /Cases by stage/);
});

test("the new pages call the case functions with the right parameters", () => {
  const api = readFileSync(join(here, "services/businessSetupApi.js"), "utf8");
  for (const f of ["case_new", "case_take", "case_link_client", "case_shared", "case_lost", "case_confirm", "case_assign", "reassign_request", "reassign_respond", "case_list", "form_staff_save", "form_doc_add"]) assert.ok(api.includes(`rpc("business_setup_${f}"`), f);
  for (const c of ["Leads", "DocumentationPage", "Cases", "ShareLink"]) assert.ok(readFileSync(join(here, `components/${c}.jsx`), "utf8").length > 200, c);
  const flow = readFileSync(join(here, "components/NewServiceFlow.jsx"), "utf8");
  assert.match(flow, /caseId/);
  assert.match(flow, /case_id: caseId/);
});

test("staff uploads for a form go under staff/<client_id>/ in the portal bucket", () => {
  const api = readFileSync(join(here, "services/businessSetupApi.js"), "utf8");
  assert.match(api, /`staff\/\$\{[^}]+\}\//);
  assert.match(api, /from\("client-portal"\)/);
});

test("Resend reuses the login and never saves a new one", () => {
  const share = readFileSync(join(here, "components/ShareLink.jsx"), "utf8");
  const part = (from, to) => share.slice(share.indexOf(from), share.indexOf(to));
  assert.match(part("const send =", "const issue"), /emailLogin\(/);
  assert.doesNotMatch(part("const send =", "const issue"), /loginSave/);
  assert.doesNotMatch(part("const resend", "return ("), /loginSave/);
  assert.match(part("const issue", "const resend"), /loginSave/);
});
