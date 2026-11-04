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
