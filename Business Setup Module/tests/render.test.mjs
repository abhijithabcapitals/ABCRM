// Renders the case pages to HTML on the server, with no browser, through Vite from Main Module (already installed). A page that
// throws on its first render (an undefined name, a bad hook) fails here. Effects do not run, so lists show their loading state.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const main = fileURLToPath(new URL("../../Main Module/", import.meta.url));
const skip = !existsSync(main + "node_modules/vite") && "run npm ci in Main Module first";
let server; let React; let renderToString; let SetupContext;

before(async () => {
  if (skip) return;
  const req = createRequire(main + "package.json");
  React = req("react"); ({ renderToString } = req("react-dom/server"));
  const { createServer } = await import(pathToFileURL(req.resolve("vite")).href);
  server = await createServer({ root: main, configFile: main + "vite.config.js", server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true }, logLevel: "silent",
    // A client that never connects: nothing is fetched while rendering to a string.
    define: { "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://127.0.0.1:1"), "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("test") } });
  ({ SetupContext } = await server.ssrLoadModule("/../Business Setup Module/components/SetupContext.jsx"));
});
after(async () => { await server?.close(); });

const setup = (can = true) => ({ can: () => can, profile: { id: "u1" }, role: "ADMIN", people: [], personName: () => "", personOptions: [], goTo() {} });
const html = async (file, name, props, can) => {
  const mod = await server.ssrLoadModule(`/../Business Setup Module/components/${file}`);
  return renderToString(React.createElement(SetupContext.Provider, { value: setup(can) }, React.createElement(mod[name], props))).replaceAll("<!-- -->", "");
};

test("Documentation page renders its case list", { skip }, async () => {
  assert.match(await html("DocumentationPage.jsx", "default", {}), /Documentation/);
});

test("a case page renders with no client (Link client) and with a client, with Mark lost for lead staff", { skip }, async () => {
  const c = { id: "c1", case_number: "BSC000001", stage: "Documentation", lead_name: "Lead", docs: {} };
  const bare = await html("DocumentationPage.jsx", "CaseDocs", { c, onBack() {} });
  assert.match(bare, /Link client/); assert.match(bare, /Mark lost/); assert.match(bare, /Invoice: Open/); assert.match(bare, /Quote accepted: Open/);
  const withClient = await html("DocumentationPage.jsx", "CaseDocs", { c: { ...c, client_id: "CL000001", reassign: { id: "r1", to_user: "u2", to_name: "Docs" } }, onBack() {} });
  assert.match(withClient, /Reassign to Docs/); assert.match(withClient, /Approve/); assert.match(withClient, /Refuse/);
  // A case with a client has an Invoices panel with the record button; without a client the button is off and says why.
  assert.match(bare, /Invoices/); assert.match(bare, /Link a client to this case before recording an invoice/);
  assert.match(await html("workspace/Invoices.jsx", "default", { caseId: "c1", caseRow: { id: "c1", client_id: "CL000001", stage: "Documentation", docs: { quote: true } } }), /\+ Record invoice/);
  assert.match(await html("workspace/Invoices.jsx", "default", { caseId: "c1", caseRow: { id: "c1", client_id: "CL000001", stage: "Documentation", docs: { quote: true } } }), /Waive invoice/);
  assert.doesNotMatch(await html("workspace/Invoices.jsx", "default", { caseId: "c1", caseRow: { id: "c1", client_id: "CL000001", stage: "Documentation", docs: { quote: true } } }, false), /Record invoice/);
  const limited = await html("DocumentationPage.jsx", "CaseDocs", { c, onBack() {} }, false);
  assert.doesNotMatch(limited, /Mark lost/); assert.doesNotMatch(limited, /Link client/);
});

test("Leads and Cases render", { skip }, async () => {
  assert.match(await html("Leads.jsx", "default", {}), /Leads/);
  assert.match(await html("Cases.jsx", "default", {}), /Cases/);
});

test("the quote screen renders a fresh line and a revision, with net, VAT and total and no VAT select", { skip }, async () => {
  const w = { client: { legal_name: "Acme", email: "a@b.ae", phone: "050", data: {} }, kyc: {} };
  const fresh = await html("NewServiceFlow.jsx", "default", { w, clientId: "CL000001", caseId: "c1", onClose() {}, onDone() {} });
  assert.match(fresh, /Scope of work/); assert.match(fresh, /Net: AED 0/); assert.match(fresh, /VAT: AED 0/); assert.match(fresh, /Total: AED 0/);
  assert.doesNotMatch(fresh, /id="bs-vat"/);
  const revise = await html("NewServiceFlow.jsx", "default", { w, clientId: "CL000001", revises: { id: "q1", document_number: "Q1", vat_mode: "exclusive", lines: [{ service_name: "Visa", description: "Visa", amount: 1000 }] }, onClose() {}, onDone() {} });
  assert.match(revise, /Revise Q1/); assert.match(revise, /Net: AED 1,000/); assert.match(revise, /VAT: AED 50/); assert.match(revise, /Total: AED 1,050/);
});

test("revising an older quote shows the VAT note; an exclusive one does not", { skip }, async () => {
  const w = { client: { legal_name: "Acme", email: "a@b.ae", phone: "050", data: {} }, kyc: {} };
  const r = (vat_mode) => html("NewServiceFlow.jsx", "default", { w, clientId: "CL000001", revises: { id: "q1", document_number: "Q1", vat_mode, lines: [{ service_name: "Visa", description: "Visa", amount: 1000 }] }, onClose() {}, onDone() {} });
  assert.match(await r("inclusive"), /lines included VAT\. Check each fee/);
  assert.doesNotMatch(await r("exclusive"), /lines included VAT/);
});

test("a case with no client lists its quote and letter read-only and offers no issuing actions", { skip }, async () => {
  const c = { id: "c1", case_number: "BSC000001", stage: "Documentation", lead_name: "Lead", docs: {} };
  const bare = await html("DocumentationPage.jsx", "CaseDocs", { c, onBack() {} });
  assert.match(bare, /Read-only until a client is linked/); assert.match(bare, /No quote or letter for this case yet/);
  assert.match(bare, /\+ Record payment/); assert.match(bare, /first creates the client from the lead details/);
  assert.doesNotMatch(bare, /New quote/); assert.doesNotMatch(bare, /Add signed copy/); assert.doesNotMatch(bare, /Create engagement letter/); assert.doesNotMatch(bare, /Waive payment/);
});

test("the payments panel of a case has no quote picker, and the ledger shows advances", { skip }, async () => {
  const w = { client: { legal_name: "Acme" }, quotes: [], letters: [], services: [], payments: [{ id: "p1", type: "Payment", amount: 500, paid_on: "2026-11-04", quote_id: null, case_id: "c1", receipt_number: "R1" }] };
  const c = { id: "c1", case_number: "BSC000001", stage: "Documentation", client_id: "CL000001", docs: { quote: true } };
  const out = await html("workspace/Payments.jsx", "default", { w, reload() {}, caseId: "c1", caseRow: c });
  assert.match(out, /\+ Record payment/); assert.match(out, /Advance/); assert.doesNotMatch(out, /Waive payment/);
  assert.doesNotMatch(out, /A payment needs an accepted quote/);
});

test("the quote message area shows the login ID and link and never a password (rendered with a stubbed login)", { skip }, async () => {
  const { quoteMessage } = await import("../logic/quoteMessage.js");
  const q = { id: "q1", document_number: "Q1", contact_name: "Sara", contact_email: "a@b.ae" };
  const a = { id: "acc1", username: "acme.llc", status: "active", password: "S3cret!pass" };
  const text = quoteMessage({ contact: q.contact_name, number: q.document_number, url: "https://portal.example/", username: a.username });
  const ready = await html("workspace/PortalMessage.jsx", "PortalMessageView", { q, a, state: "ready", text, isAdmin: false });
  assert.match(ready, /Login ID: acme\.llc/); assert.match(ready, /https:\/\/portal\.example\//); assert.match(ready, /Only an admin can email the password/);
  assert.doesNotMatch(ready, /S3cret/); assert.doesNotMatch(ready, /Password:/);
  assert.match(await html("workspace/PortalMessage.jsx", "PortalMessageView", { q, a, state: "ready", text, isAdmin: true }), /Send password/);
  assert.match(await html("workspace/PortalMessage.jsx", "PortalMessageView", { q, a: null, state: "error" }), /could not be read/);
  assert.match(await html("workspace/PortalMessage.jsx", "PortalMessageView", { q, a: null, state: "nologin" }), /has no login yet/);
});

test("Record refund is offered in case mode only when the case has money, with no quote picker", { skip }, async () => {
  const mk = (amount) => ({ client: { legal_name: "Acme" }, quotes: [], letters: [], services: [], payments: [{ id: "p1", type: "Payment", amount, paid_on: "2026-11-04", quote_id: null, case_id: "c1", receipt_number: "R1" }] });
  const c = { id: "c1", case_number: "BSC000001", stage: "Documentation", client_id: "CL000001", docs: {} };
  const funded = await html("workspace/Payments.jsx", "default", { w: mk(500), reload() {}, caseId: "c1", caseRow: c });
  assert.doesNotMatch(funded, /Record refund<\/button>[^]*disabled/);
  assert.match(funded, /<button[^>]*>Record refund<\/button>/);
  assert.doesNotMatch(funded.match(/<button[^>]*>Record refund<\/button>/)[0], /disabled/);
  const empty = await html("workspace/Payments.jsx", "default", { w: { ...mk(0), payments: [] }, reload() {}, caseId: "c1", caseRow: c });
  assert.match(empty.match(/<button[^>]*>Record refund<\/button>/)[0], /disabled/);
});

test("a case that moved on says so, and shows no false no-client note or stale checklist", { skip }, async () => {
  const c = { id: "c1", case_number: "BSC000001", stage: "Documentation", lead_name: "Lead", docs: {}, client_id: "CL000001" };
  const moved = await html("DocumentationPage.jsx", "CaseDocs", { c, moved: true, onBack() {} });
  assert.match(moved, /This case has moved to Assignment/); assert.match(moved, /Back to the list/);
  assert.doesNotMatch(moved, /no client yet/); assert.doesNotMatch(moved, /Invoice: Open/); assert.doesNotMatch(moved, /Mark lost/);
  const bare = await html("DocumentationPage.jsx", "CaseDocs", { c: { id: "c1", case_number: "BSC000001" }, moved: true, onBack() {} });
  assert.match(bare, /This case has moved to Assignment/); assert.doesNotMatch(bare, /no client yet/);
  assert.doesNotMatch(await html("DocumentationPage.jsx", "CaseDocs", { c, onBack() {} }), /moved to Assignment/);
});

test("a lead's payment panel works in case mode for a client-less lead", { skip }, async () => {
  const c = { id: "c1", case_number: "BSC000001", stage: "Lead", lead_name: "Lead", docs: {} };
  const panel = await html("Leads.jsx", "LeadPayments", { c, onClose() {}, onChanged() {} });
  assert.match(panel, /Record payment/); assert.match(panel, /first creates the client from the lead details/);
});
