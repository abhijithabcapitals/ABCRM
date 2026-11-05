import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { oldDeskRows, showAccountingDesk, showViewSwitch } from "../logic/serviceDocs.js";

const Q = "AB Capital/Accounting Quote";
const A = "AB Capital/Accounting Agreement";
const rows = [
  { id: 1, library_template: Q },
  { id: 2, library_template: A },
  { id: 3, library_template: null },
  { id: 4 },
  { id: 5, library_template: "AB Capital/Other Letter" },
];

test("oldDeskRows drops both Accounting values, keeps null and other templates", () => {
  assert.deepEqual(oldDeskRows(rows).map((r) => r.id), [3, 4, 5]);
  assert.deepEqual(oldDeskRows(null), []);
});

test("showAccountingDesk: only Accounting, no onDocument, Quote mode", () => {
  assert.equal(showAccountingDesk({ department: "Accounting", onDocument: undefined, mode: "quote" }), true);
  assert.equal(showAccountingDesk({ department: "Accounting", onDocument: () => {}, mode: "quote" }), false);
  assert.equal(showAccountingDesk({ department: "Accounting", mode: "old" }), false);
  assert.equal(showAccountingDesk({ department: "Business Setup", mode: "quote" }), false);
  assert.equal(showViewSwitch({ department: "Accounting" }), true);
  assert.equal(showViewSwitch({ department: "Accounting", onDocument: () => {} }), false);
});

test("hubApi list readers use oldDeskRows", () => {
  const src = readFileSync(new URL("../services/hubApi.js", import.meta.url), "utf8");
  for (const name of ["listLibraryDocuments", "listLetterableQuotes"]) {
    const body = src.slice(src.indexOf(name));
    assert.match(body.slice(0, body.indexOf("\nexport", 5) > 0 ? body.indexOf("\nexport", 5) : undefined), /oldDeskRows/, name);
  }
  const desk = readFileSync(new URL("../components/ServiceDesk.jsx", import.meta.url), "utf8");
  assert.match(desk, /oldDeskRows/);
  const acc = readFileSync(new URL("../components/AccountingDocuments.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(acc, /oldDeskRows/);
});
