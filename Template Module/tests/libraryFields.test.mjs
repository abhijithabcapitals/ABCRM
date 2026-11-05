// node --test "Template Module/tests/libraryFields.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readTags, fieldsFor, checkRequired } from "../logic/libraryFields.js";

const require = createRequire(new URL("../../Main Module/package.json", import.meta.url));
const JSZip = require("jszip");

const para = (...runs) => `<w:p>${runs.map((t) => `<w:r><w:t>${t}</w:t></w:r>`).join("")}</w:p>`;
const wrap = (body) => `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${body}</w:body></w:document>`;
async function build({ body = "", header, footer } = {}) {
  const z = new JSZip();
  z.file("word/document.xml", wrap(body));
  if (header) z.file("word/header1.xml", wrap(header));
  if (footer) z.file("word/footer2.xml", wrap(footer));
  return z.generateAsync({ type: "nodebuffer" });
}
const field = (list, name) => list.find((f) => f.name === name);

test("finds tags split across runs", async () => {
  const t = await readTags(await build({ body: para("{{ da", "te }}") }), JSZip);
  assert.deepEqual(t.fields, ["date"]);
  assert.equal(t.hasTags, true);
});
test("finds tags in text boxes, headers and footers", async () => {
  const box = `<w:p><w:r><w:txbxContent>${para("{{client_name}}")}</w:txbxContent></w:r></w:p>`;
  const t = await readTags(await build({ body: box, header: para("{{ contact_name }}"), footer: para("{{contact_", "email}}") }), JSZip);
  assert.deepEqual([...t.fields].sort(), ["client_name", "contact_email", "contact_name"]);
});
test("items loop tags go to loop, not fields", async () => {
  const body = para("{{client_name}}") + para("{{#items}}") + ["label", "amount", "amount_usd", "remarks", "rate", "sl"].map((n) => para(`{{ ${n} }}`)).join("") + para("{{/items}}");
  const t = await readTags(await build({ body }), JSZip);
  assert.deepEqual(t.fields, ["client_name"]);
  assert.deepEqual([...t.loop].sort(), ["amount", "amount_usd", "label", "rate", "remarks", "sl"]);
});
test("system tags are not form fields", async () => {
  const t = await readTags(await build({ body: para("{{ref_no}} {{total}} {{total_usd}} {{client_name}}") }), JSZip);
  assert.deepEqual(t.fields, ["client_name"]);
});
test("no tags gives hasTags false", async () => {
  const t = await readTags(await build({ body: para("Plain text") }), JSZip);
  assert.deepEqual(t, { fields: [], loop: [], hasTags: false });
});
test("unknown tag becomes optional text labelled from its name", () => {
  const f = field(fieldsFor({ fields: ["business_sector"] }, "Ardentax"), "business_sector");
  assert.deepEqual(f, { name: "business_sector", label: "Business sector", required: false, type: "text", full: false });
});
test("AB Capital requires client, contact, email, phone; address optional", () => {
  const fs = fieldsFor({ fields: ["client_name", "contact_name", "contact_email", "contact_phone", "client_address", "date"] }, "AB Capital");
  for (const n of ["client_name", "contact_name", "contact_email", "contact_phone"]) assert.equal(field(fs, n).required, true, n);
  assert.equal(field(fs, "client_address").required, false);
  assert.equal(field(fs, "client_address").full, true);
  assert.equal(field(fs, "date").type, "date");
});
test("Ardentax requires only client_name", () => {
  const fs = fieldsFor({ fields: ["client_name", "contact_name", "contact_email", "business_activity"] }, "Ardentax");
  assert.deepEqual(fs.filter((f) => f.required).map((f) => f.name), ["client_name"]);
});
test("checkRequired names the empty fields", () => {
  const fs = fieldsFor({ fields: ["client_name", "contact_name", "contact_email", "contact_phone"] }, "AB Capital");
  const msg = checkRequired(fs, { client_name: "X", contact_name: "  ", contact_phone: "1" }, [{ label: "Fee" }], "AB Capital");
  assert.equal(msg, "Fill in: Contact person, Email.");
});
test("AB Capital needs one fee row; Ardentax does not", () => {
  const ab = fieldsFor({ fields: ["client_name"] }, "AB Capital");
  const ar = fieldsFor({ fields: ["client_name"] }, "Ardentax");
  assert.match(checkRequired(ab, { client_name: "X" }, [{ label: "" }, {}], "AB Capital"), /fee row/i);
  assert.equal(checkRequired(ab, { client_name: "X" }, [{ label: "Fee" }], "AB Capital"), null);
  assert.equal(checkRequired(ar, { client_name: "X" }, [], "Ardentax"), null);
});
test("checkRequired rejects a bad email", () => {
  const fs = fieldsFor({ fields: ["client_name", "contact_email"] }, "Ardentax");
  assert.match(checkRequired(fs, { client_name: "X", contact_email: "nope" }, [], "Ardentax"), /email/i);
  assert.equal(checkRequired(fs, { client_name: "X", contact_email: "a@b.co" }, [], "Ardentax"), null);
});
test("Ardentax Master tags get proper labels and only client_name is required", () => {
  const fs = fieldsFor({ fields: ["client_name", "vat_trn", "scope", "prepared_date"] }, "Ardentax");
  assert.deepEqual(fs.map((f) => [f.name, f.label, f.required, f.type, f.full]), [
    ["client_name", "Client name", true, "text", false],
    ["vat_trn", "TRN", false, "text", false],
    ["scope", "Scope or deliverables", false, "text", true],
    ["prepared_date", "Prepared on", false, "date", false],
  ]);
});
