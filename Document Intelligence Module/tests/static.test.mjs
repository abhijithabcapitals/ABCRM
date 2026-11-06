import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const files = {
  panel: read("../components/OneDriveCopyPanel.jsx"),
  box: read("../components/ClientDocumentsBox.jsx"),
  api: read("../services/odCopyApi.js"),
  view: read("../logic/odCopyView.js"),
};
const ALLOWED = [/^react$/, /^@banking\/components\/shared$/, /^@banking\/components\/banking\.css$/, /^@app\/supabase$/, /^\.\.?\//];
const importsOf = (src) => [...src.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((m) => m[1]);

test("components and service import only from existing aliases or the module", () => {
  for (const [name, src] of Object.entries(files)) {
    for (const spec of importsOf(src)) assert.ok(ALLOWED.some((re) => re.test(spec)), `${name} imports ${spec}`);
  }
});
test("the service uses the shared supabase client and the od_copy schema", () => {
  assert.match(files.api, /from "@app\/supabase"/);
  assert.match(files.api, /schema\("od_copy"\)/);
});
test("no raw HTML injection", () => {
  for (const [name, src] of Object.entries(files)) assert.ok(!/dangerouslySetInnerHTML|innerHTML/.test(src), name);
});
test("the panel never renders without the admin check", () => {
  assert.match(files.panel, /export default function OneDriveCopyPanel\(\{[^)]*isAdmin/);
  const body = files.panel.slice(files.panel.indexOf("export default function OneDriveCopyPanel"));
  const guard = body.indexOf("if (!isAdmin)");
  assert.ok(guard > 0, "guard missing");
  assert.ok(body.indexOf("return <", guard) > guard);
  assert.ok(body.indexOf("<Button") > guard, "no button before the guard");
});
test("the panel does not fetch before the admin check", () => {
  // The loading lives in an inner component that is only mounted after the guard.
  assert.match(files.panel, /function Loaded\(/);
  const outer = files.panel.slice(files.panel.indexOf("export default function OneDriveCopyPanel"));
  assert.ok(!/loadReport|loadSettings|useLoad\(/.test(outer.replace(/return <Loaded[\s\S]*/, "")));
});
test("external links open safely", () => {
  assert.match(files.box, /target="_blank"/);
  assert.match(files.box, /rel="noopener noreferrer"/);
  assert.match(files.box, /No OneDrive folder linked yet\./);
  assert.match(files.box, /Open in OneDrive/);
});
test("panel has the required buttons", () => {
  for (const label of ["Start listing", "Approve matched and fixed", "Approve unmatched", "Pause", "Resume"]) assert.ok(files.panel.includes(label), label);
});
