import test from "node:test";
import assert from "node:assert/strict";
import { alertList, alertEscalate, clientOwnerList } from "../services/alertsApi.js";
import { isNotSwitchedOn } from "../logic/alertLogic.js";

const stub = (result) => ({ rpc: async (fn, args) => { stub.last = { fn, args }; return result; } });

test("wrapper passes named parameters and returns data", async () => {
  const r = await alertList(stub({ data: { rows: [], total: 0 }, error: null }), "My", "Urgent");
  assert.deepEqual(r, { rows: [], total: 0 });
  assert.equal(stub.last.fn, "alert_list");
  assert.equal(stub.last.args.p_filter, "Urgent");
});
test("client_owner_list sends the department", async () => {
  await clientOwnerList(stub({ data: [], error: null }), "Accounting");
  assert.deepEqual(stub.last.args, { p_department: "Accounting" });
});
test("wrapper throws the database sentence", async () => {
  await assert.rejects(() => alertEscalate(stub({ data: null, error: { message: "You do not have permission.", code: "P0001" } }), "x", "r"), /You do not have permission\./);
});
test("a missing function surfaces as not switched on", async () => {
  await assert.rejects(
    () => alertList(stub({ data: null, error: { message: "no function", code: "PGRST202" } }), "My"),
    (e) => isNotSwitchedOn(e),
  );
});
test("alertList sends the limit and offset for Load more", async () => {
  await alertList(stub({ data: { rows: [], total: 0 }, error: null }), "Department", "Backlog", "Accounting", 100, 200);
  assert.deepEqual(stub.last.args, { p_scope: "Department", p_filter: "Backlog", p_department: "Accounting", p_limit: 100, p_offset: 200 });
});
