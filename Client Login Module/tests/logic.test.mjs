// node --test "Client Login Module/tests/logic.test.mjs"   (no extra packages)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { bankingProgress } from "../logic/progress.js";
import { FIELDS, fieldState } from "../logic/fields.js";

test("bankingProgress percent follows the 15 visible steps", () => {
  const pct = (current_stage) => bankingProgress({ current_stage, outcome: null }).percent;
  assert.equal(pct(1), 7);
  assert.equal(pct(13), 87);
  assert.equal(pct(14), 93);
  assert.equal(pct(17), 93);
  assert.equal(pct(18), 100);
});

test("bankingProgress outcomes override the stage", () => {
  assert.deepEqual(bankingProgress({ current_stage: 8, outcome: "Approved" }), { state: "approved", percent: 100, label: "Account opened" });
  assert.deepEqual(bankingProgress({ current_stage: 17, outcome: "Rejected" }), { state: "rejected", percent: null, label: "Not approved" });
  const open = bankingProgress({ current_stage: 8, outcome: null });
  assert.equal(open.state, "open");
  assert.equal(open.label, "Document Collection & Verification");
});

test("FIELDS lists the 16 editable keys", () => {
  assert.deepEqual(FIELDS.map((f) => f.key).sort(), [
    "business_activity", "company_email", "company_phone", "ct_registration_number", "financial_year_end", "issuing_authority",
    "legal_name", "legal_structure", "license_expiry_date", "license_issue_date", "license_number", "office_address",
    "registered_address", "trade_name", "vat_trn", "website",
  ]);
  assert.deepEqual(FIELDS.filter((f) => f.masterOnly).map((f) => f.key).sort(), ["ct_registration_number", "financial_year_end"]);
  assert.deepEqual([...new Set(FIELDS.map((f) => f.group))].sort(), ["Company", "Contact", "Licence", "Tax"]);
});

test("fieldState reads the record and the open change request", () => {
  const f = FIELDS.find((x) => x.key === "trade_name");
  const rec = { trade_name: "A" };
  const pending = fieldState(f, rec, [{ field_key: "trade_name", status: "pending", new_value: "B" }]);
  assert.equal(pending.value, "A");
  assert.equal(pending.pending, "B");
  assert.equal(pending.locked, false);
  assert.equal(fieldState(f, rec, [{ field_key: "trade_name", status: "in_review", new_value: "B" }]).locked, true);
  assert.equal(fieldState(f, rec, [{ field_key: "trade_name", status: "rejected", review_note: "No" }]).rejectedNote, "No");
  const none = fieldState(f, rec, [{ field_key: "vat_trn", status: "pending", new_value: "X" }]);
  assert.deepEqual(none, { value: "A", pending: null, rejectedNote: null, locked: false });
});

test("no file still points at the old portal locations", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === "node_modules" ? [] : walk(join(d, e.name))) : [join(d, e.name)]);
  const old = /@client-module\/portal|crm\/ClientPortalAdmin|\.\.\/portal\/ClientPortal/;
  const bad = ["Main Module/src", "Client Module/crm"].flatMap((d) => walk(join(root, d))).filter((f) => /\.(jsx?|mjs)$/.test(f) && old.test(readFileSync(f, "utf8")));
  assert.deepEqual(bad, []);
});

// ── 002_change_requests.sql: its field table must stay equal to FIELDS, and master dates must be in the format the CRM reads ──
const sql002 = () => readFileSync(fileURLToPath(new URL("../../Database Module/Client Login Base/migrations/002_change_requests.sql", import.meta.url)), "utf8");
const sqlFields = () => {
  const block = sql002().split("-- FIELDS:begin")[1]?.split("-- FIELDS:end")[0] ?? "";
  return [...block.matchAll(/^\s*\('([a-z_]+)',\s*'(text|email|date)',\s*(null|'[a-z_]+'),\s*'([^']+)',\s*(true|false)\)/gm)]
    .map((m) => ({ key: m[1], kind: m[2], kycCol: m[3] === "null" ? null : m[3].slice(1, -1), masterKey: m[4], masterOnly: m[5] === "true" }));
};

test("002 SQL field list equals FIELDS (keys, date type, masterOnly)", () => {
  const sql = sqlFields();
  assert.deepEqual(sql.map((f) => f.key).sort(), FIELDS.map((f) => f.key).sort());
  assert.equal(new Set(sql.map((f) => f.key)).size, FIELDS.length);
  for (const f of FIELDS) {
    const s = sql.find((x) => x.key === f.key);
    assert.equal(s.masterOnly, !!f.masterOnly, `${f.key} masterOnly`);
    assert.equal(s.kind, f.type === "date" ? "date" : f.type === "email" ? "email" : "text", `${f.key} kind`);
    assert.equal(s.kycCol === null, !!f.masterOnly, `${f.key} KYC column`);
  }
});

test("002 SQL maps every field to its Client Master key", () => {
  const expected = {
    legal_name: "Client Legal Name", trade_name: "Trade Name", legal_structure: "Entity Type", business_activity: "Main Business Activity",
    registered_address: "Registered Address", office_address: "Office Address", website: "Website", company_email: "General Email",
    company_phone: "General Phone", vat_trn: "TRN", license_number: "Trade License Number", license_issue_date: "License Issue Date",
    license_expiry_date: "License Expiry Date", issuing_authority: "License Issuing Authority", ct_registration_number: "CT Registration Number",
    financial_year_end: "Financial Year End",
  };
  assert.deepEqual(Object.fromEntries(sqlFields().map((f) => [f.key, f.masterKey])), expected);
});

test("a master date written as DD/MM/YYYY is what fmtUae writes and parseUaeDate reads", async () => {
  const { fmtUae, parseUaeDate } = await import("../../Client Module/crm/masterLogic.js");
  assert.match(sql002(), /'DD\/MM\/YYYY'/);
  const d = new Date(Date.UTC(2027, 11, 31));
  assert.equal(fmtUae(d), "31/12/2027");
  assert.equal(parseUaeDate("31/12/2027")?.getTime(), d.getTime());
  assert.equal(parseUaeDate("2027-12-31"), null);
});

// ── Edge Function: submit_change and gallery_url (static checks on source) ──
const fnSrc = () => readFileSync(fileURLToPath(new URL("../supabase/client-portal/index.ts", import.meta.url)), "utf8");
const caseBlock = (name) => {
  const src = fnSrc();
  const start = src.indexOf(`case "${name}"`);
  assert.ok(start >= 0, `case ${name} exists`);
  const rest = src.slice(start + 1);
  const next = rest.search(/\n\s*case "|\n\s*default:/);
  return src.slice(start, start + 1 + (next < 0 ? rest.length : next));
};

test("submit_change and gallery_url sit after the session check and use the session account only", () => {
  const src = fnSrc();
  const sessionAt = src.indexOf('rpc("client_portal_session"');
  for (const name of ["submit_change", "gallery_url"]) {
    const block = caseBlock(name);
    assert.ok(src.indexOf(`case "${name}"`) > sessionAt, `${name} after session check`);
    assert.match(block, /p_account: accountId/);
    assert.doesNotMatch(block, /body\.(account|account_id|p_account)/);
  }
  assert.match(caseBlock("submit_change"), /client_change_submit/);
  assert.match(caseBlock("gallery_url"), /client_portal_gallery_path/);
});

test("gallery_url validates source and id, signs from banking-documents for 120 seconds, response has no path field", () => {
  const block = caseBlock("gallery_url");
  assert.match(block, /"kyc"/);
  assert.match(block, /"generated"/);
  assert.match(block, /Document not found\./);
  assert.match(block, /GALLERY_BUCKET/);
  assert.match(fnSrc(), /const GALLERY_BUCKET = "banking-documents"/);
  assert.match(block, /return json\(\{ url:/);
  assert.match(block, /return json\(\{ url: await signed\(data\.storage_path, [^)]*GALLERY_BUCKET\) \}\)/);
  assert.doesNotMatch(block, /json\(data|storage_path:/);
  assert.match(fnSrc(), /createSignedUrl\(path, 120, \{ download: name \}\)/);
});

test("submit_change shows only P0001 SQL messages and bounds its inputs", () => {
  const block = caseBlock("submit_change").replace(/\/\/.*$/gm, "");
  assert.match(block, /error\.code === "P0001"\) throw new InputError\(error\.message\)/);
  assert.match(block, /throw new Error\(error\.message\)/);
  assert.equal((block.match(/new InputError\(error\.message\)/g) || []).length, 1);
  assert.match(block, /slice\(0, 60\)/);
  assert.match(block, /slice\(0, 600\)/);
  assert.match(block, /return json\(\{ id/);
});

test("portalApi exports submitChange and galleryUrl", () => {
  const api = readFileSync(fileURLToPath(new URL("../portal/portalApi.js", import.meta.url)), "utf8");
  assert.match(api, /submitChange:[^\n]*call\("submit_change", \{ field, value \}\)/);
  assert.match(api, /galleryUrl:[^\n]*call\("gallery_url", \{ source, id \}\)/);
});

test("function header lists the new actions", () => {
  assert.match(fnSrc().split("import ")[0], /submit_change[\s\S]*gallery_url/);
});

// ── Portal screens (static checks on source) ──
const portalDir = fileURLToPath(new URL("../portal/", import.meta.url));
const portalSrc = (name) => readFileSync(join(portalDir, name), "utf8");
const portalFiles = ["ClientPortal.jsx", "ServicesTab.jsx", "AccountsTab.jsx", "DocumentsTab.jsx", "InformationTab.jsx", "portal.css"];
const allPortal = () => portalFiles.map(portalSrc).join("\n");

test("portal files read nothing from the database directly", () => {
  for (const f of portalFiles.filter((n) => n.endsWith(".jsx"))) {
    const s = portalSrc(f);
    assert.doesNotMatch(s, /\.from\(/, f);
    assert.doesNotMatch(s, /supabase/i, f);
  }
});

test("readOnly gates edit and file opening", () => {
  assert.match(portalSrc("InformationTab.jsx"), /readOnly/);
  assert.match(portalSrc("DocumentsTab.jsx"), /readOnly/);
  assert.match(portalSrc("ClientPortal.jsx"), /readOnly/);
});

test("portal carries the exact client-facing strings", () => {
  const s = allPortal();
  for (const text of ["Payment history is not held in this system. Contact your account manager.", "Held by AB Capital", "Pending review", "Not recorded yet", "Not accepted:", "In credit"]) assert.ok(s.includes(text), text);
});

test("portal never shows tax basis text, links the website, or imports Client Module from portal", () => {
  const s = allPortal();
  assert.doesNotMatch(s, /\.basis\b/);
  assert.doesNotMatch(s, /href=/);
  assert.match(portalSrc("AccountsTab.jsx"), /@client-module\/crm\/taxLogic/);
  assert.match(portalSrc("ClientPortal.jsx"), /export { fmtSize }/);
});

test("progress bar is accessible and cards use a wrapping grid", () => {
  const s = portalSrc("ServicesTab.jsx");
  for (const a of ['role="progressbar"', "aria-valuenow", 'aria-valuemin="0"', 'aria-valuemax="100"']) assert.ok(s.includes(a), a);
  assert.match(portalSrc("portal.css"), /auto-fill, minmax/);
});

test("Client Module imports only fmtSize from the portal", () => {
  const dir = fileURLToPath(new URL("../../Client Module/crm/", import.meta.url));
  for (const f of readdirSync(dir).filter((n) => /\.jsx?$/.test(n))) {
    const lines = readFileSync(join(dir, f), "utf8").split(/\r?\n/).filter((l) => /^import .* from ".*\/portal\/.*"/.test(l));
    for (const l of lines) assert.match(l, /^import \{ fmtSize \} from "@client-login\/portal\/ClientPortal";$/, `${f}: ${l}`);
  }
});

test("filterClients narrows by access, KYC and business line", async () => {
  const { filterClients } = await import("../logic/adminFilters.js");
  const A = { id: "A", status: "active", kyc_percent: 100, lines: ["Business Banking"] };
  const B = { id: "B", status: "revoked", kyc_percent: 6, lines: [] };
  const C = { id: "C", status: null, kyc_percent: null, lines: [] };
  const rows = [A, B, C];
  assert.deepEqual(filterClients(rows, { access: "on" }), [A]);
  assert.deepEqual(filterClients(rows, { access: "revoked" }), [B]);
  assert.deepEqual(filterClients(rows, { access: "none" }), [C]);
  assert.deepEqual(filterClients(rows, { kyc: "complete" }), [A]);
  assert.deepEqual(filterClients(rows, { kyc: "incomplete" }), [B, C]);
  assert.deepEqual(filterClients(rows, { line: "Business Banking" }), [A]);
  assert.deepEqual(filterClients(rows, { access: "on", kyc: "incomplete" }), []);
  assert.deepEqual(filterClients(rows, {}), rows);
  assert.deepEqual(filterClients(rows), rows);
});
