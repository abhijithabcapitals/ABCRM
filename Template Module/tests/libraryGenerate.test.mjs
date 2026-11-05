// node --test "Template Module/tests/libraryGenerate.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { generateLibraryDocument, retryLibraryDocument } from "../services/libraryGenerate.js";

const template = { template_key: "AB Capital/Formation/IFZA", company: "AB Capital" };
const fields = [{ name: "client_name", label: "Client name", required: true }];
const input = (over = {}) => ({
  template, fileId: 7, fields, usdRate: 3.6725, clientId: "CL000001",
  values: { client_name: "Sample Client", contact_name: "Sam", contact_email: "s@example.com", contact_phone: "050", client_address: "Dubai", date: "2026-11-05" },
  rows: [{ label: "Fee", amount: "1,000", remarks: "note", rate: "" }],
  ...over,
});
const created = { id: "d1", document_number: "ABC/2026/11/BSQ005", client_name: "Sample Client" };
function fakes(over = {}) {
  const calls = [];
  const note = (name, value) => (...args) => { calls.push({ name, args }); if (value instanceof Error) throw value; return value; };
  return {
    calls,
    deps: {
      loadFile: note("loadFile", "BUFFER"),
      create: note("create", created),
      render: note("render", "BLOB"),
      save: note("save", { path: "p" }),
      ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, note(k, v)])),
    },
  };
}
const names = (calls) => calls.map((c) => c.name);

test("missing required field calls neither create nor render", async () => {
  const { calls, deps } = fakes();
  const out = await generateLibraryDocument(input({ values: { client_name: "" } }), deps);
  assert.match(out.error, /Client name/);
  assert.equal(out.doc, undefined);
  assert.deepEqual(calls, []);
});

test("a bad fee amount uses no number", async () => {
  const { calls, deps } = fakes();
  const out = await generateLibraryDocument(input({ rows: [{ label: "Fee", amount: "abc" }] }), deps);
  assert.match(out.error, /Fee/);
  assert.deepEqual(calls, []);
});

test("unloadable template file calls no create, so no number is used", async () => {
  const { calls, deps } = fakes({ loadFile: new Error("gone") });
  const out = await generateLibraryDocument(input(), deps);
  assert.equal(out.error, "gone");
  assert.deepEqual(names(calls), ["loadFile"]);
});

test("template file is loaded before create, then render, then save", async () => {
  const { calls, deps } = fakes();
  const out = await generateLibraryDocument(input(), deps);
  assert.deepEqual(names(calls), ["loadFile", "create", "render", "save"]);
  assert.equal(out.error, undefined);
  assert.equal(out.doc, created);
  assert.equal(out.file.name, "ABC-2026-11-BSQ005 Sample Client.docx");
});

test("create receives the template, file, client, stored values and lines", async () => {
  const { calls, deps } = fakes();
  await generateLibraryDocument(input(), deps);
  const p = calls.find((c) => c.name === "create").args[0];
  assert.equal(p.template_key, "AB Capital/Formation/IFZA");
  assert.equal(p.file_id, 7);
  assert.equal(p.client_id, "CL000001");
  assert.equal(p.client_name, "Sample Client");
  assert.equal(p.client_address, "Dubai");
  assert.equal(p.field_values.usd_rate, 3.6725);
  assert.deepEqual(p.lines, [{ description: "Fee", amount: 1000, remarks: "note", rate: "" }]);
});

test("the created document's number is the Ref in the render", async () => {
  const { calls, deps } = fakes();
  await generateLibraryDocument(input(), deps);
  const [buffer, data] = calls.find((c) => c.name === "render").args;
  assert.equal(buffer, "BUFFER");
  assert.equal(data.ref_no, "ABC/2026/11/BSQ005");
  assert.equal(data.usd_rate, "3.6725");
  assert.equal(data.date, "05/11/2026");
});

test("render failure returns the doc with its Ref and an error", async () => {
  const { calls, deps } = fakes({ render: new Error("bad tag") });
  const out = await generateLibraryDocument(input(), deps);
  assert.equal(out.doc, created);
  assert.equal(out.error, "bad tag");
  assert.ok(!names(calls).includes("save"));
});

test("upload failure returns the doc with its Ref and an error", async () => {
  const { deps } = fakes({ save: new Error("offline") });
  const out = await generateLibraryDocument(input(), deps);
  assert.equal(out.doc, created);
  assert.equal(out.error, "offline");
});

test("retry renders with the document's own file_id and stored values, and makes no new row", async () => {
  const { calls, deps } = fakes();
  const doc = {
    ...created, library_file_id: 3,
    field_values: { client_name: "Sample Client", date: "2026-11-05", usd_rate: 4 },
    lines: [{ description: "Fee", amount: 400, remarks: "", rate: "" }],
  };
  const out = await retryLibraryDocument(doc, deps);
  assert.equal(out.error, undefined);
  assert.deepEqual(names(calls), ["loadFile", "render", "save"]);
  assert.equal(calls[0].args[0], 3);
  const data = calls[1].args[1];
  assert.equal(data.ref_no, "ABC/2026/11/BSQ005");
  assert.equal(data.total_usd, "100");
  assert.equal(data.items[0].label, "Fee");
});
