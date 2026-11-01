import test from "node:test";
import assert from "node:assert/strict";
import { fieldsFromRead } from "../logic/documentFields.js";

const doc = (fields) => ({ extraction: { fields } });

test("fills number and dates the reader found with confidence", () => {
  const got = fieldsFromRead(doc([
    { key: "document_number", value: "784-1990-1234567-1", confidence: "high" },
    { key: "issue_date", value: "2024-02-01", confidence: "medium" },
    { key: "expiry_date", value: "2027-01-31", confidence: "high" },
  ]));
  assert.deepEqual(got, { doc_number: "784-1990-1234567-1", issue_date: "2024-02-01", expiry_date: "2027-01-31" });
});
test("ignores low-confidence values and dates in other formats", () => {
  const got = fieldsFromRead(doc([
    { key: "expiry_date", value: "2027-01-31", confidence: "low" },
    { key: "issue_date", value: "01/02/2024", confidence: "high" },
  ]));
  assert.deepEqual(got, {});
});
test("nothing read leaves the form manual", () => {
  assert.deepEqual(fieldsFromRead(null), {});
  assert.deepEqual(fieldsFromRead({}), {});
});
