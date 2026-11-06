// The review's screen fixes. The screens have no render harness here, so these read their source, as Main Module's summaryBoard test does.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isHttpsUrl } from "../logic/alertLogic.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const drawer = read("../components/AlertDrawer.jsx");
const register = read("../components/ComplianceRegister.jsx");
const regulatory = read("../components/RegulatoryUpdates.jsx");
const client = read("../../Client Module/crm/ClientComplianceItems.jsx");

test("only an https address counts as a link", () => {
  assert.equal(isHttpsUrl("https://tax.gov.ae/x"), true);
  for (const bad of ["javascript:alert(1)", "http://tax.gov.ae", "HTTPS://tax.gov.ae", " https://x", "", null, undefined]) assert.equal(isHttpsUrl(bad), false, String(bad));
});
test("the source link renders only for https", () => assert.match(regulatory, /isHttpsUrl\(u\.official_url\) \? <a href=\{u\.official_url\}/));
test("UpdateForm shows errors, wherever it opens", () => {
  assert.match(regulatory, /function UpdateForm\(\{[^}]*\berror\b[^}]*\}\)/);
  assert.match(regulatory, /\{error && <Note tone="bad">\{error\}<\/Note>\}\s*<div style=\{\{ fontWeight: 700, fontSize: 13, marginBottom: 8 \}\}>\{value\.id/);
  assert.equal((regulatory.match(/<UpdateForm value=\{\w+\} error=\{error\}/g) || []).length, 2);
});
test("AlertDrawer clears its fields on every mode change", () => assert.match(drawer, /useEffect\(\(\) => \{ setText\(""\); setPerson\(""\); setDate\(""\); \}, \[mode\]\)/));
test("ClientComplianceItems ignores work loaded for an earlier client", () => {
  assert.match(client, /latest\.current = clientId/);
  assert.match(client, /if \(latest\.current !== asked\) return;/);
});
test("the register debounces the client box", () => {
  assert.match(register, /setTimeout\(\(\) => setClientQuery\(client\), \d+\)/);
  assert.match(register, /\[supabase, clientQuery, type, status, reload\]/);
  assert.match(register, /clientQuery\.trim\(\) \|\| null/);
});
test("the register's Due prefers the review date", () => assert.match(register, /daysLabel\(r\.next_review_date \|\| r\.expiry_date, today\)/));
test("the register's reference label is honest", () => {
  assert.ok(register.includes("Reference (shown on the register and client page only)"));
  assert.ok(!register.includes("shown on this screen only"));
});
test("client and type are read-only when editing", () => {
  assert.match(register, /value=\{form\.client_id\} readOnly=\{!!form\.id\}/);
  assert.match(register, /value=\{form\.item_type\} disabled=\{!!form\.id\}/);
});
