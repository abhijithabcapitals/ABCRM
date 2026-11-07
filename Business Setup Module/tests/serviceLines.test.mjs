import test from "node:test";
import assert from "node:assert/strict";
import { feeGroups, openCase, quoteRows } from "../logic/serviceLines.js";

test("fee list grouped in list order, inactive items left out", () => {
  const g = feeGroups([{ id: 1, grp: "Visa", name: "B", sort_order: 3, active: true }, { id: 2, grp: "Formation", name: "A", sort_order: 1, active: true },
    { id: 3, grp: "Visa", name: "C", sort_order: 2, active: true }, { id: 4, grp: "Visa", name: "Old", sort_order: 0, active: false }]);
  assert.deepEqual(g.map(([grp, items]) => [grp, items.map((f) => f.name)]), [["Formation", ["A"]], ["Visa", ["C", "B"]]]);
  assert.deepEqual(feeGroups(null), []);
});

test("quote rows come from the lines not yet quoted, tied to their line", () => {
  const rows = quoteRows([{ id: "l1", service_name: "Licence", fee_item_id: "f1", amount: "1500.00", vat_rate: "5.00", stored_amount: 1000 }, { id: "l2", quote_id: "q", service_name: "Visa", amount: 1 }]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { service_name: "Licence", action: "New", fee_item_id: "f1", amount: 1500, stored_amount: 1000, vat_rate: 5, scope: "", remarks: "", line_id: "l1" });
});

test("a new quote goes on the latest open case without a live quote", () => {
  const cases = [{ id: "a", client_id: "C1", stage: "Lead", created_at: "2026-11-01" }, { id: "b", client_id: "C1", stage: "Lost", created_at: "2026-11-05" },
    { id: "c", client_id: "C1", stage: "Review", created_at: "2026-11-04" }, { id: "d", client_id: "C2", stage: "Lead", created_at: "2026-11-06" }];
  assert.equal(openCase(cases, "C1").id, "c");
  assert.equal(openCase(cases, "C1", [{ case_id: "c", status: "accepted" }]).id, "a");
  assert.equal(openCase(cases, "C1", [{ case_id: "c", status: "rejected" }]).id, "c");
  assert.equal(openCase(cases, "C1", [{ case_id: "c", status: "issued" }, { case_id: "a", status: "issued" }]), null);
});
