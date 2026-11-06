// node --test "Template Module/tests/accountingList.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { ACCOUNTING_TEMPLATES, ID_CHUNK, loadAccountingDocs, readAll } from "../services/accountingList.js";

const at = (i) => new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString();

test("the two library_template values are the filter", () => {
  assert.deepEqual(ACCOUNTING_TEMPLATES, ["AB Capital/Accounting Quote", "AB Capital/Accounting Agreement"]);
});

test("readAll pages until a short page, well past 2000 rows", async () => {
  const total = 2600;
  const asked = [];
  const rows = await readAll(async (from, to) => { asked.push([from, to]); return Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, i) => ({ n: from + i })); });
  assert.equal(rows.length, 2600);
  assert.deepEqual(asked, [[0, 999], [1000, 1999], [2000, 2999]]);
  assert.equal(rows[2599].n, 2599);
});

test("readAll stops on an empty first page and on the ceiling", async () => {
  assert.deepEqual(await readAll(async () => []), []);
  let calls = 0;
  const rows = await readAll(async (from, to) => { calls += 1; return Array.from({ length: to - from + 1 }, () => ({})); }, { page: 10, max: 35 });
  assert.equal(rows.length, 35);
  assert.equal(calls, 4);
});

test("mail rows are read for every document, in chunks, and merged newest first", async () => {
  const docs = Array.from({ length: 2150 }, (_, i) => ({ id: `d${i}`, created_at: at(10000 - i), library_template: ACCOUNTING_TEMPLATES[i % 2] }));
  const chunks = [];
  const out = await loadAccountingDocs({
    readDocs: async (from, to) => docs.slice(from, to + 1),
    readMail: async (ids, from, to) => { if (from === 0) chunks.push(ids.length); return ids.slice(from, to + 1).map((id) => ({ id: `m-${id}`, doc_type: "mail", parent_id: id, created_at: at(10000 - Number(id.slice(1))) })); },
  });
  assert.equal(out.filter((r) => r.doc_type === "mail").length, 2150);
  assert.equal(out.filter((r) => r.library_template).length, 2150);
  assert.ok(chunks.every((n) => n <= ID_CHUNK));
  assert.equal(chunks.reduce((a, b) => a + b, 0), 2150);
  for (let i = 1; i < out.length; i += 1) assert.ok(out[i - 1].created_at >= out[i].created_at);
  assert.ok(out.some((r) => r.id === "m-d2149"), "the oldest document's mail is kept");
});
