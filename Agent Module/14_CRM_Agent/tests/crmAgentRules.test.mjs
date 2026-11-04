import test from "node:test";
import assert from "node:assert/strict";
import {
  canChangeTable, canReach, checkChange, checkRead, costUsd, cutResult, isSensitiveColumn, KNOWN_TABLES, listReachable,
  MAX_CHANGE_CALLS, MAX_CHANGE_ROWS, MAX_READ_ROWS, MAX_RESULT_CHARS, MAX_ROUNDS, NO_INFO, personFrom, tabForTable,
} from "../supabase/crm-agent/logic.js";

const staff = { isAdmin: false, tabs: ["mytasks", "business-development"] };
const admin = { isAdmin: true, tabs: [] };

test("limits", () => {
  assert.equal(NO_INFO, "NO_INFO");
  assert.equal(MAX_READ_ROWS, 50);
  assert.equal(MAX_CHANGE_ROWS, 20);
  assert.equal(MAX_CHANGE_CALLS, 3);
  assert.equal(MAX_ROUNDS, 6);
  assert.equal(MAX_RESULT_CHARS, 6000);
});

test("a lead table needs the BD tab", () => { assert.equal(canReach("public", "bd_leads", staff), true); assert.equal(canReach("public", "hr_pay_details", staff), false); });
test("an admin passes every tab", () => assert.equal(canReach("public", "hr_pay_details", admin), true));
test("an unmapped table is refused", () => assert.equal(tabForTable("public", "brand_new_table"), null));
test("CEO data needs the ceo tab", () => assert.equal(tabForTable("ceo", "decisions"), "ceo"));
test("names and notifications are open to any tab", () => { assert.equal(canReach("public", "profiles", { isAdmin: false, tabs: [] }), true); assert.equal(tabForTable("public", "notifications"), "any"); });
for (const name of ["HR_PAY_DETAILS", "public.hr_pay_details", "hr_pay_details?select=*", "hr_pay_details ", ""]) test(`refuses ${JSON.stringify(name)}`, () => assert.equal(tabForTable("public", name), null));
test("a non-string name is refused", () => assert.equal(tabForTable("public", undefined), null));

const mapping = [
  ["public", "bd_leads", "business-development"], ["public", "banking_cases", "business-banking"], ["public", "business_setup_services", "business-setup"],
  ["public", "hr_employees", "hr"], ["public", "accounting_jobs", "accounts"], ["public", "voucher_register", "accounts"], ["public", "hub_documents", "quotations"],
  ["public", "quotation_templates", "quotations"], ["public", "service_items", "quotations"], ["public", "wiki_articles", "knowledge"], ["public", "knowledge_entries", "knowledge"],
  ["public", "tasks", "spaces"], ["public", "task_comments", "spaces"], ["public", "spaces", "spaces"], ["public", "space_fields", "spaces"], ["public", "folders", "spaces"],
  ["public", "lists", "spaces"], ["public", "whiteboards", "spaces"], ["public", "messenger_messages", "messenger"], ["public", "crm_news", "dashboard"],
  ["public", "crm_teams", "dashboard"], ["public", "zoho_finance_snapshot", "dashboard"], ["acct", "clients", "clients"], ["public", "client_master", "clients"],
  ["email_base", "threads", "ceo"], ["email_agent", "rules", "ceo"],
];
for (const [s, t, tab] of mapping) test(`${s}.${t} needs ${tab}`, () => assert.equal(tabForTable(s, t), tab));

for (const [s, t] of [["public", "agents"], ["public", "agent_usage"], ["public", "integration_credentials"], ["public", "audit_trail"], ["public", "admin_audit"], ["public", "member_tab_access"], ["public", "hr_access"], ["public", "space_access"], ["public", "banking_user_roles"], ["public", "banking_role_permissions"], ["public", "bd_user_roles"], ["public", "bd_audit_logs"], ["public", "hr_audit_log"], ["public", "banking_activity_logs"], ["public", "hr_finance_managers"], ["public", "bd_platform_connections"], ["public", "messenger_inbox_accounts"], ["public", "microsoft_user_links"], ["public", "automations"], ["public", "ai_usage"], ["public", "crm_agent_tool_calls"], ["public", "banking_excel_import_rows"], ["ceo", "audit_logs"], ["ceo", "mail_accounts"], ["ceo", "agent_permissions"], ["router", "messages"], ["vault", "secrets"], ["auth", "users"]]) test(`never reaches ${s}.${t}`, () => assert.equal(canReach(s, t, admin), false));

test("known tables are all mapped", () => { assert.ok(KNOWN_TABLES.length > 100); for (const k of KNOWN_TABLES) assert.notEqual(tabForTable(k.schema, k.table), null); });
test("known tables hide what a person lacks", () => {
  const list = listReachable(KNOWN_TABLES, staff);
  assert.ok(list.includes("public.bd_leads"));
  assert.ok(list.includes("public.profiles"));
  assert.ok(!list.includes("public.hr_pay_details"));
});

test("sensitive columns", () => {
  for (const c of ["password_plain", "api_key", "apikey", "token", "otp", "secret_value", "private_key", "pin_hash"]) assert.equal(isSensitiveColumn(c), true);
  for (const c of ["name", "status", "monkey"]) assert.equal(isSensitiveColumn(c), false);
});

const info = { columns: [{ name: "id" }, { name: "status" }], primary_key: ["id"] };
test("read needs named known columns", () => assert.ok(checkRead(info, { columns: ["*"] }).error));
test("read needs a column list", () => assert.ok(checkRead(info, {}).error));
test("read refuses a column not offered", () => assert.ok(checkRead(info, { columns: ["password_plain"] }).error));
test("read refuses a table with no info", () => assert.ok(checkRead(null, { columns: ["id"] }).error));
test("filter on an unknown or sensitive column is refused", () => assert.ok(checkRead(info, { columns: ["id"], filters: [{ column: "password_plain", op: "ilike", value: "a%" }] }).error));
test("order on an unknown column is refused", () => assert.ok(checkRead(info, { columns: ["id"], order: { column: "password_plain" } }).error));
test("only known filter ops", () => assert.ok(checkRead(info, { columns: ["id"], filters: [{ column: "id", op: "or", value: "x" }] }).error));
test("is takes only null, true or false", () => { assert.ok(checkRead(info, { columns: ["id"], filters: [{ column: "id", op: "is", value: "x" }] }).error); assert.ok(!checkRead(info, { columns: ["id"], filters: [{ column: "id", op: "is", value: null }] }).error); });
test("in takes a list", () => assert.ok(checkRead(info, { columns: ["id"], filters: [{ column: "id", op: "in", value: "x" }] }).error));
test("limit caps at 50", () => assert.equal(checkRead(info, { columns: ["id"], limit: 500 }).limit, 50));
test("a valid read comes back whole", () => assert.deepEqual(checkRead(info, { columns: ["id"], filters: [{ column: "status", op: "eq", value: "Open" }], order: { column: "id", ascending: false }, limit: 5 }), { columns: ["id"], filters: [{ column: "status", op: "eq", value: "Open" }], order: { column: "id", ascending: false }, limit: 5 }));

test("first change list", () => {
  for (const t of ["tasks", "task_comments", "task_checklist_items"]) assert.equal(canChangeTable("public", t), true);
  assert.equal(canChangeTable("public", "banking_cases"), false);
  assert.equal(canChangeTable("public", "hr_pay_lines"), false);
  assert.equal(canChangeTable("public", "bd_leads"), false);
  assert.equal(canChangeTable("acct", "clients"), false);
  assert.equal(canChangeTable("ceo", "tasks"), false);
});
test("update needs ids", () => assert.ok(checkChange(info, { action: "update", values: { status: "x" } }, 0).error));
test("update takes at most 20 ids", () => assert.ok(checkChange(info, { action: "update", ids: Array(21).fill(1), values: { status: "x" } }, 0).error));
test("a composite key cannot update", () => assert.ok(checkChange({ ...info, primary_key: ["a", "b"] }, { action: "delete", ids: [1] }, 0).error));
test("insert takes at most 20 rows", () => assert.ok(checkChange(info, { action: "insert", rows: Array(21).fill({ status: "x" }) }, 0).error));
test("a change cannot write an unknown column", () => assert.ok(checkChange(info, { action: "update", ids: [1], values: { password_plain: "x" } }, 0).error));
test("an insert cannot write an unknown column", () => assert.ok(checkChange(info, { action: "insert", rows: [{ password_plain: "x" }] }, 0).error));
test("a change cannot rewrite the key", () => assert.ok(checkChange(info, { action: "update", ids: [1], values: { id: 2 } }, 0).error));
test("an unknown action is refused", () => assert.ok(checkChange(info, { action: "truncate", ids: [1] }, 0).error));
test("a fourth change in one message is refused", () => assert.ok(checkChange(info, { action: "delete", ids: [1] }, 3).error));
test("a valid update comes back with its key", () => assert.deepEqual(checkChange(info, { action: "update", ids: [1], values: { status: "x" } }, 2), { action: "update", ids: [1], values: { status: "x" }, pk: "id" }));
test("a valid insert comes back with its rows", () => assert.deepEqual(checkChange(info, { action: "insert", rows: [{ status: "x" }] }, 0), { action: "insert", rows: [{ status: "x" }], pk: "id" }));

test("cost by model", () => assert.equal(costUsd("claude-opus-5-5", { input_tokens: 1000000, output_tokens: 1000000 }), 24));
test("Haiku cost", () => assert.equal(costUsd("claude-haiku-5-5", { input_tokens: 1000000, output_tokens: 1000000 }), 0.6));
test("an unknown model is priced highest", () => assert.equal(costUsd("new-model", { input_tokens: 1000000, output_tokens: 0 }), 10));
test("missing usage costs zero", () => assert.equal(costUsd("claude-opus-5-5", undefined), 0));

test("a long result is cut with a note", () => { const r = cutResult("x".repeat(7000)); assert.ok(r.length <= 6100); assert.match(r, /cut/i); });
test("a short result is left alone", () => assert.equal(cutResult("ok"), "ok"));
test("an object result becomes JSON", () => assert.equal(cutResult({ a: 1 }), '{"a":1}'));

test("a failed tab lookup gives no tabs", () => assert.deepEqual(personFrom("member", null), { isAdmin: false, tabs: [] }));
test("only the admin role is admin", () => { assert.equal(personFrom("Admin ", []).isAdmin, false); assert.equal(personFrom("admin", []).isAdmin, true); assert.equal(personFrom(undefined, []).isAdmin, false); });
test("no tabs reach nothing but open tables", () => assert.equal(canReach("public", "bd_leads", personFrom("member", null)), false));

test("tasks can be added and edited but never hard deleted", () => {
  assert.equal(canChangeTable("public", "tasks", "update"), true);
  assert.equal(canChangeTable("public", "tasks", "insert"), true);
  assert.equal(canChangeTable("public", "tasks", "delete"), false);
  assert.equal(canChangeTable("public", "task_comments", "delete"), true);
});
