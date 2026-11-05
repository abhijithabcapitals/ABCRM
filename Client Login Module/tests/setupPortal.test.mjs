// Checks the client-portal Edge Function without running it: every Business Setup action works only from the
// account of the live session, and nothing from the browser can name another client's records.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { formProgress, portalSections, visibleDocuments } from "../../Business Setup Module/logic/formDefinition.js";

const src = readFileSync(fileURLToPath(new URL("../supabase/client-portal/index.ts", import.meta.url)), "utf8");
const ACTIONS = ["setup_view", "form_get", "form_save", "form_submit", "setup_file"];

function branch(name) {
  const start = src.indexOf(`case "${name}":`);
  assert.notEqual(start, -1, `${name} is missing`);
  const next = src.indexOf("\n      case ", start + 1);
  const def = src.indexOf("\n      default:", start + 1);
  return src.slice(start, Math.min(next === -1 ? Infinity : next, def));
}

test("every Business Setup action sits after the session check", () => {
  const session = src.indexOf('"client_portal_session"');
  assert.ok(session > 0);
  for (const a of ACTIONS) assert.ok(src.indexOf(`case "${a}":`) > session, `${a} runs before the session check`);
});

test("the browser cannot name a client, account or form", () => {
  for (const a of ACTIONS) {
    const b = branch(a);
    assert.doesNotMatch(b, /body\.(client_id|client|account_id|account|form_id)/, `${a} reads an identity from the browser`);
    assert.match(b, /accountId/, `${a} does not use the session's account`);
  }
});

test("setup_file asks the database whether the file is this client's", () => {
  const b = branch("setup_file");
  assert.match(b, /business_setup_portal_file/);
  assert.match(b, /p_account: accountId/);
  assert.match(b, /createSignedUrl\(.*300/s);
});

test("form uploads are tied to this account's own form", () => {
  const b = branch("upload_start");
  assert.match(b, /for_form/);
  assert.match(b, /business_setup_form_get/);
  assert.doesNotMatch(b, /body\.form_id/);
});

test("a preview needs the Setup right or admin", () => {
  assert.match(src, /setup\.portal\.manage/);
});

const DEF = {
  sections: [
    { key: "contact", title: "Contact", fields: [{ key: "email", label: "Email", required: true }, { key: "note", label: "Note" }] },
    { key: "request", title: "Request", fields: [{ key: "services", label: "Services", type: "multi", required: true }, { key: "company_status", label: "Status", required: true }] },
    { key: "existing", title: "Existing", show_when: { company_status: "Existing" }, fields: [{ key: "licence_number", label: "Licence number", required: true }] },
    { key: "partners", title: "Partners", type: "repeat", required: true, fields: [{ key: "name", label: "Name", required: true }] },
  ],
  documents: [
    { group: "Current", types: [{ type: "Passport", required: true }, { type: "Emirates ID" }] },
    { group: "Address proof", one_of: true, required: true, types: [{ type: "Ejari" }, { type: "Utility bill" }] },
    { group: "Renewal documents", show_when: { services_has: "Renewal" }, types: [{ type: "Old visa", required: true }] },
  ],
};
const full = { email: "a@b.c", services: ["Visa"], company_status: "New", partners: [{ name: "P" }] };
const docs = [{ doc_type: "Passport", status: "pending" }, { doc_type: "Ejari", status: "pending" }];

test("form progress lists what is missing, and only what is shown", () => {
  assert.deepEqual(formProgress(DEF, full, docs), { missing: [], complete: true });
  assert.deepEqual(formProgress(DEF, {}, []).missing, ["Email", "Services", "Status", "Partners", "Passport", "Address proof"]);
  assert.deepEqual(formProgress(DEF, { ...full, company_status: "Existing" }, docs).missing, ["Licence number"]);
});

test("renewal documents show only when a renewal is requested", () => {
  assert.ok(!visibleDocuments(DEF, full).some((g) => g.group === "Renewal documents"));
  assert.ok(visibleDocuments(DEF, { ...full, services: ["Renewal"] }).some((g) => g.group === "Renewal documents"));
  assert.deepEqual(formProgress(DEF, { ...full, services: ["Renewal"] }, docs).missing, ["Old visa"]);
});

test("a rejected document does not count", () => {
  assert.deepEqual(formProgress(DEF, full, [{ doc_type: "Passport", status: "rejected" }, docs[1]]).missing, ["Passport"]);
});

test("a client with no Business Setup work sees only today's portal", () => {
  assert.deepEqual(portalSections({ form: null, services: [], quotes: [], payments: [], invoices: [], documents: [] }), []);
  assert.deepEqual(portalSections(null), []);
  assert.deepEqual(portalSections({ form: {}, services: [{}], quotes: [], payments: [{}], invoices: [], documents: [] }), ["form", "services", "payments"]);
});

test("the portal imports nothing from staff modules beyond the form definition and shared components", () => {
  for (const f of ["SetupView.jsx", "SetupForm.jsx"]) {
    const s = readFileSync(fileURLToPath(new URL(`../portal/${f}`, import.meta.url)), "utf8");
    for (const m of s.matchAll(/from "(@[^"]+)"/g)) assert.ok(["@banking/components/shared", "@business-setup/logic/formDefinition"].includes(m[1]), `${f} imports ${m[1]}`);
  }
});

test("the client has no signed quote upload: no action, no limit code, no SQL function", () => {
  assert.doesNotMatch(src, /setup_signed_upload/); assert.doesNotMatch(src, /business_setup_portal_signed_add/); assert.doesNotMatch(src, /SIGNED_EXT/);
  const view = readFileSync(fileURLToPath(new URL("../portal/SetupView.jsx", import.meta.url)), "utf8");
  assert.doesNotMatch(view, /can_sign|signedUpload|FilePick/);
  const api = readFileSync(fileURLToPath(new URL("../portal/portalApi.js", import.meta.url)), "utf8");
  assert.doesNotMatch(api, /signedUpload|setup_signed_upload/);
});

test("staff open a signed copy through the SQL right check, never a path from the browser", () => {
  const i = src.indexOf('if (action === "staff_signed_url")');
  assert.ok(i > 0);
  const b = src.slice(i, i + 500);
  assert.match(b, /staff\.rpc\("business_setup_signed_file"/);
  assert.doesNotMatch(b, /body\.(path|storage_path)/);
});

test("a quote of a closed case does not read as waiting for the client", () => {
  const view = readFileSync(fileURLToPath(new URL("../portal/SetupView.jsx", import.meta.url)), "utf8");
  assert.match(view, /q\.status === "issued" && q\.closed \? "Closed" : QUOTE\[q\.status\]/);
});

test("setup_payment_claim runs after the session check and takes the account from the session only", () => {
  assert.ok(src.indexOf('case "setup_payment_claim":') > src.indexOf('"client_portal_session"'), "it runs before the session check");
  const b = branch("setup_payment_claim");
  assert.doesNotMatch(b, /body\.(client_id|client|account_id|account|case_id|case|status)/, "it reads an identity or a status from the browser");
  assert.match(b, /business_setup_portal_claim_add/);
  assert.match(b, /p_account: accountId/);
  assert.match(b, /eq\("account_id", accountId\)/, "the proof is not tied to the session's account");
});

test("a proof of payment is a PDF, JPG or PNG up to 10 MB and is filed as the login's own upload", () => {
  const b = branch("upload_start");
  assert.match(b, /for_claim/);
  assert.match(src, /MAX_CLAIM_PROOF_BYTES = 10 \* 1024 \* 1024/);
  assert.match(src, /CLAIM_PROOF_EXT = \["pdf", "jpg", "jpeg", "png"\]/);
  assert.match(b, /"Payment proof"/);
  assert.match(b, /incoming\/\$\{accountId\}/);
});
