// Client Onboarding (client flow Task 7): the pure rules behind the screen, and checks that the screen is wired to them.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { currentLetter, lastDecision, letterHistory } from "../logic/caseWorkspace.js";
import { issueNotice } from "../logic/issueLogin.js";
import { AB_CAPITAL_TEMPLATE, defaultTemplate, pickerItems } from "../logic/templates.js";
import { visibleDocs } from "../logic/claims.js";

const rd = (f) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");

test("a rejected letter is not the letter: staff can issue a new one", () => {
  const letters = [{ id: "l1", parent_id: "q1", status: "rejected" }, { id: "l2", parent_id: "q2", status: "issued" }];
  assert.equal(currentLetter(letters, "q1"), undefined);
  assert.equal(currentLetter(letters, "q2").id, "l2");
  assert.equal(currentLetter([...letters, { id: "l3", parent_id: "q1", status: "issued" }], "q1").id, "l3");
  assert.equal(currentLetter([{ id: "l4", parent_id: "q1", status: "superseded" }], "q1"), undefined);
});

test("letter history lists every rejected or replaced letter of the case, oldest first", () => {
  const docs = [
    { id: "q", doc_type: "quote", status: "accepted", created_at: "2026-11-01" },
    { id: "l2", doc_type: "letter", status: "issued", created_at: "2026-11-04" },
    { id: "l1", doc_type: "letter", status: "superseded", created_at: "2026-11-03", status_reason: "Replaced by a new letter" },
    { id: "l0", doc_type: "letter", status: "rejected", created_at: "2026-11-02" },
  ];
  assert.deepEqual(letterHistory(docs).map((d) => d.id), ["l0", "l1"]);
  assert.deepEqual(letterHistory([]), []);
});

test("the latest decision on a document is the newest acceptance row", () => {
  const rows = [{ document_id: "q1", decision: "Rejected", note: "Too high", created_at: "2026-11-02T10:00:00Z" }, { document_id: "q1", decision: "Accepted", created_at: "2026-11-03T10:00:00Z" }, { document_id: "q2", decision: "Rejected", note: "No", created_at: "2026-11-01T10:00:00Z" }];
  assert.equal(lastDecision(rows, "q1").decision, "Accepted");
  assert.equal(lastDecision(rows, "q2").note, "No");
  assert.equal(lastDecision(rows, "q9"), null);
  assert.equal(lastDecision(null, "q1"), null);
});

test("issuing the login: emailed says so, not emailed offers Resend, a refusal is shown plainly and the quote stays issued", () => {
  assert.deepEqual(issueNotice({ ok: true, emailed: true, username: "acme" }), { tone: "ok", text: "The login was emailed to the client.", resend: false });
  const no = issueNotice({ ok: true, emailed: false, username: "acme" });
  assert.equal(no.tone, "warn"); assert.equal(no.resend, true); assert.match(no.text, /not emailed/i);
  const email = issueNotice(null, new Error("Add the client's email in Client Master first."));
  assert.equal(email.text, "Add the client's email in Client Master first."); assert.equal(email.tone, "error"); assert.equal(email.resend, false); assert.match(email.note, /quote stays issued/i);
  const revoked = issueNotice(null, new Error("This client's login was revoked. Ask an administrator to restore it."));
  assert.equal(revoked.text, "This client's login was revoked. Ask an administrator to restore it."); assert.equal(revoked.resend, false);
  assert.equal(issueNotice(null, new Error("Network down")).resend, false);
  // A password is never part of what is shown, even if a result carried one.
  assert.doesNotMatch(JSON.stringify(issueNotice({ ok: true, emailed: false, username: "u", password: "S3cret" })), /S3cret/);
});

test("the AB Capital template is the default; zone templates stay selectable", () => {
  const t = [{ key: "ifza", label: "IFZA", active: true }, { key: "service", label: "Visa and other services", active: true }, { key: "rakez", label: "RAKEZ", active: true }];
  assert.equal(AB_CAPITAL_TEMPLATE, "service");
  assert.equal(defaultTemplate(t), "service");
  assert.equal(defaultTemplate(t, "rakez"), "rakez");                         // a revision keeps its own template
  assert.equal(defaultTemplate(t, "gone"), "service");
  assert.equal(defaultTemplate([t[0], { ...t[1], active: false }]), "ifza");  // an inactive default is not offered
  assert.equal(defaultTemplate([]), "service");
});

test("the picker lists services first, then the other fee items, once each, active only", () => {
  const fees = [{ id: 1, name: "Cost line", grp: "Costs", active: true, is_service: false }, { id: 2, name: "Visa", grp: "Visa", active: true, is_service: true },
    { id: 3, name: "Old", grp: "X", active: false, is_service: true }, { id: 4, name: "Visa", grp: "Dup", active: true, is_service: true }, { id: 5, name: "Licence", grp: "L", active: true, is_service: true }];
  assert.deepEqual(pickerItems(fees).map((f) => [f.name, f.is_service]), [["Visa", true], ["Licence", true], ["Cost line", false]]);
  assert.deepEqual(pickerItems(null), []);
});

test("documents shown to staff leave out a payment proof", () => {
  assert.deepEqual(visibleDocs([{ id: 1, doc_type: "Passport" }, { id: 2, doc_type: "Payment proof" }]).map((d) => d.id), [1]);
  assert.deepEqual(visibleDocs(undefined), []);
});

test("the screen replaces DocumentationPage and is wired to the new rules", () => {
  assert.equal(existsSync(fileURLToPath(new URL("../components/DocumentationPage.jsx", import.meta.url))), false);
  assert.match(rd("../components/BusinessSetup.jsx"), /<ClientOnboarding \/>/);
  const q = rd("../components/workspace/Quotes.jsx");
  assert.match(q, /currentLetter\(/); assert.doesNotMatch(q, /w\.letters\.find\(\(l\) => l\.parent_id === q\.id\)/);
  assert.doesNotMatch(q, /<PortalMessage/);
  assert.match(q, /publish=\{/);
  assert.match(rd("../../Template Module/components/ServiceDesk.jsx"), /status !== "rejected"/);
  assert.match(rd("../../Client Module/crm/ClientInputs.jsx"), /Payment proof/);
  const flow = rd("../components/NewServiceFlow.jsx");
  assert.match(flow, /issueLogin\(/); assert.match(flow, /defaultTemplate\(/); assert.match(flow, /pickerItems\(/);
  assert.ok(flow.indexOf("await fileQuote(") < flow.indexOf("login(forCase, false)"), "the login is issued after the quote is saved");
  assert.doesNotMatch(flow, /password/i);
});

test("the OCR reader loads DOC OCR Module's reader on demand and nothing else", () => {
  const s = rd("../services/ocrRead.js");
  assert.match(s, /await import\("\.\.\/\.\.\/DOC OCR Module\/browser\/readDocument\.js"\)/);
  assert.doesNotMatch(s, /^import .*readDocument/m);
  assert.doesNotMatch(s, /fetch\(|DOCUMENT_MODULE_URL/);
  assert.match(rd("../components/onboarding/ReadDocuments.jsx"), /readFiles\(/);
  assert.match(rd("../components/onboarding/ReadDocuments.jsx"), /formStaffSave\(/);
});

test("claims: Confirm goes through payment_add with claim_id, Refuse through claim_refuse, the proof through the staff document link", () => {
  const api = rd("../services/businessSetupApi.js");
  assert.match(api, /business_setup_claim_list/); assert.match(api, /business_setup_claim_refuse/);
  const c = rd("../components/onboarding/Claims.jsx");
  assert.match(c, /staff_url/); assert.match(c, /claimRefuse\(/);
  assert.match(rd("../components/workspace/Payments.jsx"), /claim_id: claim\.id/);
});

test("drag and drop: what the reader recognised becomes a form type, and an unsure file gets none", async () => {
  const { formTypeFor, FORM_DOC_TYPES } = await import("../logic/bulkUpload.js");
  for (const [docai, type] of [["Passport", "Passport"], ["EmiratesID", "Emirates ID"], ["Visa", "Emirates visa"], ["TenancyContract", "Ejari"], ["BankStatement", "Bank statement"], ["ProofOfAddress", "Utility bill"], ["TradeLicence", "Other"], ["MOA", "Other"]]) {
    assert.equal(formTypeFor({ doc_type: docai, classification_confidence: "high" }), type, docai);
    assert.ok(FORM_DOC_TYPES.includes(type));
  }
  assert.equal(formTypeFor({ doc_type: "Passport", classification_confidence: "low" }), null);
  assert.equal(formTypeFor({ doc_type: "Quotation", classification_confidence: "high" }), null);
  assert.equal(formTypeFor(null), null);
});

test("drag and drop: only files the portal accepts are taken, once each", async () => {
  const { sortDropped, fileProblem } = await import("../logic/bulkUpload.js");
  assert.match(fileProblem({ name: "a.exe", size: 5 }), /only PDF/);
  assert.match(fileProblem({ name: "a.pdf", size: 11 * 1024 * 1024 }), /larger than 10 MB/);
  assert.match(fileProblem({ name: "a.pdf", size: 0 }), /empty/);
  assert.equal(fileProblem({ name: "A.JPG", size: 5 }), null);
  const a = { name: "a.pdf", size: 5 }; const b = { name: "b.pdf", size: 5 };
  const out = sortDropped([a, a, b, { name: "c.exe", size: 5 }], [b]);
  assert.deepEqual(out.files, [a]);
  assert.equal(out.problems.length, 1);
});

test("drag and drop sits at the top of the client's form and of Client Onboarding, and never overwrites", () => {
  const read = (f) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");
  const form = read("../../Client Login Module/portal/SetupForm.jsx");
  assert.ok(form.indexOf("<BulkUpload") > 0 && form.indexOf("<BulkUpload") < form.indexOf("visibleSections(form.definition, answers).map"));
  const panel = read("../components/onboarding/FieldsPanel.jsx");
  assert.ok(panel.indexOf("<BulkUpload") > 0 && panel.indexOf("<BulkUpload") < panel.indexOf("!c.form_id ?"));
  const bulk = read("../components/BulkUpload.jsx");
  assert.match(bulk, /mergeOcr\(before, out\.read\)/);
  assert.doesNotMatch(bulk, /client-login\/admin|ClientPortalAdmin|supabase/);
});
