import test from "node:test";
import assert from "node:assert/strict";
import { quoteContext, DEFAULT_USD_RATE } from "../logic/quoteData.js";

const ifza = { key: "ifza" };
const mainland = { key: "mainland" };
const base = { created_at: "2026-10-19T08:00:00Z", client_name: "Acme", business_activity: "Trading" };
const q750 = { ...base, lines: [{ service_name: "VAT Registration", amount: 750, remarks: "One Time" }], total_amount: 750 };
const q1000 = { ...base, lines: [{ description: "Fee", amount: 400 }, { description: "Licence", amount: 600 }], total_amount: 1000 };
const qZero = { ...base, lines: [], total_amount: 0 };

test("USD uses one rate", () => assert.equal(quoteContext(q750, ifza, 3.6725).items[0].amount_usd, "204"));
test("total USD from rate", () => assert.equal(quoteContext(q1000, ifza, 3.6725).total_usd, "272"));
test("activity and name separate", () => {
  const c = quoteContext({ ...q750, business_activity: "Trading", client_name: "Acme" }, mainland, 3.6725);
  assert.equal(c.business_activity, "Trading");
  assert.equal(c.business_name, "Acme");
});
test("zero total renders", () => {
  const c = quoteContext(qZero, ifza, 3.6725);
  assert.equal(c.total, "0");
  assert.equal(c.total_usd, "0");
  assert.deepEqual(c.items, []);
});
test("thousands get commas", () => {
  const c = quoteContext({ ...base, lines: [{ service_name: "Licence", amount: 14900 }], total_amount: 14900 }, ifza, 3.6725);
  assert.equal(c.items[0].amount, "14,900");
  assert.equal(c.items[0].amount_usd, "4,057");
  assert.equal(c.total, "14,900");
});
test("items number from 1 and keep their label and remarks", () => {
  const c = quoteContext(q1000, ifza, 3.6725);
  assert.deepEqual(c.items.map((i) => i.sl), [1, 2]);
  assert.equal(c.items[0].label, "Fee");
  assert.equal(c.items[0].remarks, "");
  assert.equal(quoteContext(q750, ifza, 3.6725).items[0].label, "VAT Registration");
  assert.equal(quoteContext(q750, ifza, 3.6725).items[0].remarks, "One Time");
});
test("date is day first, in Dubai time", () => {
  assert.equal(quoteContext(q750, ifza, 3.6725).date, "19/10/2026");
  assert.equal(quoteContext({ ...q750, created_at: "2026-10-19T21:00:00Z" }, ifza, 3.6725).date, "20/10/2026");
});
test("a missing or bad rate falls back to the default", () => {
  assert.equal(DEFAULT_USD_RATE, 3.6725);
  assert.equal(quoteContext(q750, ifza).items[0].amount_usd, "204");
  assert.equal(quoteContext(q750, ifza, 0).items[0].amount_usd, "204");
});
