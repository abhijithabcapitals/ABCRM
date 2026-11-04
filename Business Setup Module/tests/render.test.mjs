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
  assert.match(bare, /Link client/); assert.match(bare, /Mark lost/); assert.match(bare, /Invoice: Later/); assert.match(bare, /Quote accepted: Open/);
  const withClient = await html("DocumentationPage.jsx", "CaseDocs", { c: { ...c, client_id: "CL000001", reassign: { id: "r1", to_user: "u2", to_name: "Docs" } }, onBack() {} });
  assert.match(withClient, /Reassign to Docs/); assert.match(withClient, /Approve/); assert.match(withClient, /Refuse/);
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
  const c = { id: "c1", case_number: "BSC000001", stage: "Documentation", client_id: "CL000001", docs: { quote: true, paid: false } };
  const out = await html("workspace/Payments.jsx", "default", { w, reload() {}, caseId: "c1", caseRow: c });
  assert.match(out, /\+ Record payment/); assert.match(out, /Advance/); assert.match(out, /Waive payment/);
  assert.doesNotMatch(out, /A payment needs an accepted quote/);
  const paid = await html("workspace/Payments.jsx", "default", { w, reload() {}, caseId: "c1", caseRow: { ...c, docs: { paid: true } } });
  assert.doesNotMatch(paid, /Waive payment/);
});
