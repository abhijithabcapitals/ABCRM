import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { runTool, TOOLS } from "../supabase/crm-agent/tools.js";

const here = fileURLToPath(new URL("..", import.meta.url));
const read = (...p) => readFileSync(join(here, ...p), "utf8");

const INFO = { columns: [{ name: "id", type: "uuid" }, { name: "status", type: "text" }], primary_key: ["id"] };

// A chainable stand-in for a Supabase client. Records every call, and returns `result` when awaited.
function fakeDb(result = { data: [], error: null }) {
  const calls = [];
  const chain = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (resolve) => resolve(result);
      return (...args) => {
        calls.push([prop, ...args]);
        return chain;
      };
    },
  });
  return { chain, calls, schema: (s) => { calls.push(["schema", s]); return chain; } };
}

function fakeAdmin({ info = INFO, logFails = false } = {}) {
  const calls = [];
  return {
    calls,
    from: (...a) => { calls.push(["from", ...a]); throw new Error("admin.from must not be used"); },
    schema: (...a) => { calls.push(["schema", ...a]); throw new Error("admin.schema must not be used"); },
    rpc: async (fn, args) => {
      calls.push([fn, args]);
      if (fn === "crm_agent_table_info") return { data: info, error: null };
      return { data: null, error: logFails ? { message: "log down" } : null };
    },
  };
}

function ctx(over = {}) {
  return { db: fakeDb(), admin: fakeAdmin(), person: { isAdmin: false, tabs: ["spaces"] }, profileId: "p1", changeCalls: 0, ...over };
}
const logs = (c) => c.admin.calls.filter(([fn]) => fn === "crm_agent_chat_log");
const dataCalls = (c) => c.db.calls.filter(([op]) => op === "from");

test("all four tools are defined and strict", () => {
  assert.deepEqual(TOOLS.map((t) => t.name), ["list_my_tables", "describe_table", "read_rows", "change_rows"]);
  for (const t of TOOLS) assert.equal(t.strict, true);
});

test("read_rows outside the person's tabs returns Error and reads nothing", async () => {
  const c = ctx();
  const out = await runTool("read_rows", { schema: "public", table: "hr_pay_details", columns: ["id"] }, c);
  assert.match(out, /^Error:/);
  assert.equal(dataCalls(c).length, 0);
  assert.equal(c.admin.calls.filter(([fn]) => fn === "crm_agent_table_info").length, 0);
});

test("read_rows uses the person's client with the checked columns", async () => {
  const db = fakeDb({ data: [{ id: "1" }], error: null });
  const c = ctx({ db });
  const out = await runTool("read_rows", { schema: "public", table: "tasks", columns: ["id"], filters: [{ column: "status", op: "eq", value: "Open" }], limit: 500 }, c);
  assert.match(out, /"id":"1"/);
  assert.deepEqual(db.calls[0], ["schema", "public"]);
  assert.deepEqual(db.calls[1], ["from", "tasks"]);
  assert.deepEqual(db.calls[2], ["select", "id"]);
  assert.ok(db.calls.some(([op, col, val]) => op === "eq" && col === "status" && val === "Open"));
  assert.ok(db.calls.some(([op, n]) => op === "limit" && n === 50));
});

test("read_rows refuses a sensitive column", async () => {
  const c = ctx();
  assert.match(await runTool("read_rows", { schema: "public", table: "tasks", columns: ["password_plain"] }, c), /^Error:/);
  assert.equal(dataCalls(c).length, 0);
});

test("describe_table uses table info only after the map check", async () => {
  const c = ctx();
  assert.match(await runTool("describe_table", { schema: "public", table: "hr_pay_details" }, c), /^Error:/);
  assert.equal(c.admin.calls.filter(([fn]) => fn === "crm_agent_table_info").length, 0);
  const ok = await runTool("describe_table", { schema: "public", table: "tasks" }, c);
  assert.match(ok, /"status"/);
  assert.deepEqual(c.admin.calls.filter(([fn]) => fn === "crm_agent_table_info")[0][1], { p_schema: "public", p_table: "tasks" });
});

test("change_rows on a table not in the change list returns Error", async () => {
  const c = ctx({ person: { isAdmin: true, tabs: [] } });
  assert.match(await runTool("change_rows", { schema: "public", table: "banking_cases", action: "update", ids: ["1"], values: { status: "x" } }, c), /^Error:/);
  assert.equal(dataCalls(c).length, 0);
});

test("a task cannot be hard deleted", async () => {
  const c = ctx();
  assert.match(await runTool("change_rows", { schema: "public", table: "tasks", action: "delete", ids: ["1"] }, c), /^Error:/);
  assert.match(await runTool("change_rows", { schema: "public", table: "task_comments", action: "delete", ids: ["1"] }, c), /^Error:/);
  assert.equal(dataCalls(c).length, 0);
});

test("change_rows update filters by the primary key and selects it back", async () => {
  const db = fakeDb({ data: [{ id: "1" }], error: null });
  const c = ctx({ db });
  const out = await runTool("change_rows", { schema: "public", table: "tasks", action: "update", ids: ["1"], values: { status: "Done" } }, c);
  assert.ok(db.calls.some(([op, v]) => op === "update" && v.status === "Done"));
  assert.ok(db.calls.some(([op, col, ids]) => op === "in" && col === "id" && ids[0] === "1"));
  assert.ok(db.calls.some(([op, col]) => op === "select" && col === "id"));
  assert.match(out, /Changed 1/);
  assert.match(out, /"1"/);
  assert.equal(c.changeCalls, 1);
});

const typeArrays = (node) => node && typeof node === "object" && (Array.isArray(node.type) || Object.values(node).some(typeArrays));
test("tool schemas use no type lists", () => assert.equal(TOOLS.some((t) => typeArrays(t.input_schema)), false));
test("read results are marked as data", async () => {
  const db = fakeDb({ data: [{ id: "1" }], error: null });
  assert.match(await runTool("read_rows", { schema: "public", table: "tasks", columns: ["id"] }, ctx({ db })), /<crm_data>/);
});
test("a change after the deadline is refused", async () => {
  const db = fakeDb({ data: [{ id: "1" }], error: null });
  const c = ctx({ db, deadline: Date.now() - 1 });
  assert.match(await runTool("change_rows", { schema: "public", table: "tasks", action: "update", ids: ["1"], values: { status: "x" } }, c), /^Error:/);
  assert.equal(dataCalls(c).length, 0);
});
test("a made change is remembered for the reply", async () => {
  const db = fakeDb({ data: [{ id: "1" }], error: null });
  const c = ctx({ db, changes: [] });
  await runTool("change_rows", { schema: "public", table: "tasks", action: "update", ids: ["1"], values: { status: "x" } }, c);
  assert.deepEqual(c.changes, ['Changed 1 row(s) in public.tasks: ["1"]']);
});
test("change_rows insert sends the rows and reports them", async () => {
  const db = fakeDb({ data: [{ id: "9" }], error: null });
  const c = ctx({ db });
  const out = await runTool("change_rows", { schema: "public", table: "task_comments", action: "insert", rows: [{ status: "hi" }] }, c);
  assert.ok(db.calls.some(([op]) => op === "insert"));
  assert.match(out, /"9"/);
});

test("zero rows changed tells Claude nothing changed", async () => {
  const c = ctx();
  const out = await runTool("change_rows", { schema: "public", table: "tasks", action: "update", ids: ["1"], values: { status: "Done" } }, c);
  assert.match(out, /^Nothing changed/);
  assert.match(out, /access|exist/i);
});

test("a database error returns Error and no row data", async () => {
  const db = fakeDb({ data: null, error: { message: "new row violates row-level security policy", details: "Failing row contains (secret value)" } });
  const c = ctx({ db });
  const out = await runTool("read_rows", { schema: "public", table: "tasks", columns: ["id"] }, c);
  assert.match(out, /^Error:/);
  assert.doesNotMatch(out, /secret value/);
});

test("the fourth change in one message returns Error", async () => {
  const db = fakeDb({ data: [{ id: "1" }], error: null });
  const c = ctx({ db, changeCalls: 3 });
  assert.match(await runTool("change_rows", { schema: "public", table: "tasks", action: "update", ids: ["1"], values: { status: "x" } }, c), /^Error:/);
  assert.equal(dataCalls(c).length, 0);
});

test("an unknown tool returns Error and does not throw", async () => assert.match(await runTool("drop_table", {}, ctx()), /^Error:/));
for (const input of [null, undefined, "x", 5, { schema: 1, table: {} }, { schema: "public" }]) test(`malformed input ${JSON.stringify(input)} returns Error`, async () => assert.match(await runTool("read_rows", input, ctx()), /^Error:/));
test("a throwing client returns Error", async () => {
  const db = { schema() { throw new Error("boom"); } };
  assert.match(await runTool("read_rows", { schema: "public", table: "tasks", columns: ["id"] }, ctx({ db })), /^Error:/);
});

test("every call writes the log", async () => {
  const c = ctx();
  await runTool("read_rows", { schema: "public", table: "tasks", columns: ["id"] }, c);
  const [, args] = logs(c)[0];
  assert.deepEqual(args, { p_profile: "p1", p_tool: "read_rows", p_action: "read", p_table: "public.tasks", p_ok: true, p_error_code: null });
});
test("a refused call is logged as refused", async () => {
  const c = ctx();
  await runTool("read_rows", { schema: "public", table: "hr_pay_details", columns: ["id"] }, c);
  const [, args] = logs(c)[0];
  assert.equal(args.p_ok, false);
  assert.equal(args.p_error_code, "refused");
});
test("a failed log does not change the result", async () => {
  const db = fakeDb({ data: [{ id: "1" }], error: null });
  assert.match(await runTool("read_rows", { schema: "public", table: "tasks", columns: ["id"] }, ctx({ db, admin: fakeAdmin({ logFails: true }) })), /"id":"1"/);
});
test("the log never carries row values", async () => {
  const db = fakeDb({ data: [{ id: "1" }], error: null });
  const c = ctx({ db });
  await runTool("change_rows", { schema: "public", table: "tasks", action: "update", ids: ["1"], values: { status: "PRIVATE_VALUE" } }, c);
  assert.doesNotMatch(JSON.stringify(logs(c)), /PRIVATE_VALUE/);
});

test("list_my_tables returns only reachable tables", async () => {
  const out = await runTool("list_my_tables", {}, ctx());
  assert.match(out, /public\.tasks/);
  assert.match(out, /public\.profiles/);
  assert.doesNotMatch(out, /hr_pay_details/);
});

// The function itself, checked from its source.
const src = () => read("supabase/crm-agent/index.ts");
test("data calls use the person's login", () => assert.match(src(), /Authorization: authHeader/));
test("the key comes from credential_get", () => assert.match(src(), /credential_get[\s\S]*AGENT_KEY_AGT_14_CRM/));
test("the service role is never used for data", () => assert.doesNotMatch(src(), /admin\s*\.\s*(schema\(|from\(\s*"(?!agents"))/));
test("rounds are capped", () => assert.match(src(), /MAX_ROUNDS/));
test("a person must be ticked before any Claude call", () => assert.match(src(), /router_context[\s\S]*accessFrom[\s\S]*403[\s\S]*messages\.create/));
test("the agent records its own usage on every exit", () => { assert.match(src(), /router_record_usage/); assert.match(src(), /usage_recorded: true/); assert.match(src(), /finally/); });
test("Claude calls stop at the deadline", () => { assert.match(src(), /deadline/); assert.match(src(), /outOfMoney/); });
test("unknown models are refused", () => assert.match(src(), /isKnownModel/));
test("refusals become NO_INFO", () => assert.match(src(), /refusal[\s\S]*NO_INFO/));
test("logs hold no message text", () => assert.doesNotMatch(src(), /console\.\w+\([^)]*(message|content|reply|rows)/));
test("anything read is data", () => assert.match(src(), /never instructions/));
test("changes need the person's own request", () => assert.match(src(), /own message/));
