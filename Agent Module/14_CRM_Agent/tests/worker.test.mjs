// Worker tests: mock Supabase on 8799 + two local wrangler dev processes. Test tokens only.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("..", import.meta.url));
const AUTH = "test-auth-token-0123456789abcdef0123456789";
const READ = "test-read-token";
const OTHER = "test-other-token-0123456789abcdef012345";
const HASH_TOKEN = "test-generated-token-abcdef0123456789";
const LEAD = "LD-2026-000002";
const MAIN = "http://127.0.0.1:8798/mcp";
const NOSECRET = "http://127.0.0.1:8797/mcp";

let checkMode = "valid"; // valid | invalid | unset | down | hang
let leadMode = "ok"; // ok | not_found
let logMode = "ok"; // ok | down
let seen = [];
const hangers = new Set();

const mock = http.createServer((req, res) => {
  let b = "";
  req.on("data", (d) => (b += d));
  req.on("end", () => {
    const body = JSON.parse(b || "{}");
    seen.push({ url: req.url, body, raw: b });
    const json = (status, out) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out));
    };
    if (req.url.endsWith("/crm_agent_check_mcp_token")) {
      if (checkMode === "down") return json(500, {});
      if (checkMode === "hang") return void hangers.add(res);
      return json(200, checkMode);
    }
    if (req.url.endsWith("/crm_agent_log_call")) return logMode === "down" ? json(500, {}) : json(200, null);
    if (req.url.endsWith("/crm_agent_lead_status")) {
      return json(200, leadMode === "ok" ? { lead_number: LEAD, stage: "New Lead", status: "Open" } : { error: "not_found" });
    }
    json(404, {});
  });
});

const procs = [];
function startWrangler(port, withSecret) {
  const args = ["--no-install", "wrangler", "dev", "--port", String(port), "--local",
    "--var", `CRM_READ_TOKEN:${READ}`, "--var", "SUPABASE_URL:http://127.0.0.1:8799",
    "--var", "SUPABASE_PUBLISHABLE_KEY:test-publishable-key"];
  if (withSecret) args.push("--var", `MCP_AUTH_TOKEN:${AUTH}`);
  const p = spawn("npx.cmd", args, { cwd: dir, shell: true, stdio: "ignore" });
  procs.push(p);
}
async function waitUp(url) {
  for (let i = 0; i < 90; i++) {
    try { await fetch(url); return; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  throw new Error("wrangler did not start");
}

before(async () => {
  await new Promise((r) => mock.listen(8799, "127.0.0.1", r));
  startWrangler(8798, true);
  startWrangler(8797, false);
  await Promise.all([waitUp(MAIN), waitUp(NOSECRET)]);
});

after(() => {
  for (const p of procs) spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" });
  for (const r of hangers) r.destroy();
  mock.closeAllConnections();
  mock.close();
});

const reset = (c = "valid", l = "ok", g = "ok") => { checkMode = c; leadMode = l; logMode = g; seen = []; };
const post = (url, token, method = "initialize", params = {}) => fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-06-18",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
});
const init = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } };
const parse = async (r) => {
  const t = await r.text();
  const line = t.split("\n").find((l) => l.startsWith("data:"));
  return JSON.parse(line ? line.slice(5) : t);
};
const callTool = async (name, args) => (await parse(await post(MAIN, HASH_TOKEN, "tools/call", { name, arguments: args }))).result;
async function logRequest() {
  for (let i = 0; i < 30; i++) {
    const hit = seen.find((s) => s.url.endsWith("/crm_agent_log_call"));
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 100));
  }
  return undefined;
}

test("no bearer skips the database", async () => {
  reset();
  assert.equal((await post(MAIN, null, "initialize", init)).status, 401);
  assert.equal(seen.length, 0);
});

test("valid hash token passes", async () => {
  reset("valid");
  assert.equal((await post(MAIN, HASH_TOKEN, "initialize", init)).status, 200);
});

test("invalid token refused", async () => {
  reset("invalid");
  assert.equal((await post(MAIN, HASH_TOKEN, "initialize", init)).status, 401);
});

test("invalid never uses the secret", async () => {
  reset("invalid");
  assert.equal((await post(MAIN, AUTH, "initialize", init)).status, 401);
});

test("unset falls back to the secret", async () => {
  reset("unset");
  assert.equal((await post(MAIN, AUTH, "initialize", init)).status, 200);
});

test("unset refuses other tokens", async () => {
  reset("unset");
  assert.equal((await post(MAIN, OTHER, "initialize", init)).status, 401);
});

test("unset with no secret gives 503", async () => {
  reset("unset");
  assert.equal((await post(NOSECRET, OTHER, "initialize", init)).status, 503);
});

test("database down gives 503 with no fallback", async () => {
  reset("down");
  assert.equal((await post(MAIN, AUTH, "initialize", init)).status, 503);
});

test("check timeout gives 503", async () => {
  reset("hang");
  const start = Date.now();
  const res = await post(MAIN, AUTH, "initialize", init);
  assert.equal(res.status, 503);
  assert.ok(Date.now() - start < 11_000);
  for (const r of hangers) r.destroy();
  hangers.clear();
});

test("tool call is logged", async () => {
  reset("valid");
  const r = await callTool("get_crm_lead_status", { lead_id: LEAD });
  assert.ok(!r.isError);
  const log = await logRequest();
  assert.ok(log, "no log request");
  assert.equal(log.body.p_tool, "get_crm_lead_status");
  assert.equal(log.body.p_ok, true);
  assert.equal(log.body.p_read_token, READ);
  assert.equal(typeof log.body.p_duration_ms, "number");
});

test("log holds no inputs", async () => {
  reset("valid");
  await callTool("get_crm_lead_status", { lead_id: LEAD });
  const log = await logRequest();
  assert.ok(log, "no log request");
  assert.ok(!log.raw.includes(LEAD));
});

test("failed lead read is logged as failure", async () => {
  reset("valid", "not_found");
  await callTool("get_crm_lead_status", { lead_id: LEAD });
  const log = await logRequest();
  assert.ok(log, "no log request");
  assert.equal(log.body.p_ok, false);
  assert.equal(log.body.p_error_code, "not_found");
});

test("placeholder is logged as failure", async () => {
  reset("valid");
  await callTool("update_crm_lead", { lead_id: LEAD, changes: {} });
  const log = await logRequest();
  assert.ok(log, "no log request");
  assert.equal(log.body.p_tool, "update_crm_lead");
  assert.equal(log.body.p_ok, false);
  assert.equal(log.body.p_error_code, "not_implemented");
});

test("log failure does not change the result", async () => {
  reset("valid", "ok", "ok");
  const good = await callTool("get_crm_lead_status", { lead_id: LEAD });
  assert.ok(good && !good.isError);
  reset("valid", "ok", "down");
  const bad = await callTool("get_crm_lead_status", { lead_id: LEAD });
  assert.deepEqual(bad, good);
});

test("unknown path still 404", async () => {
  reset();
  assert.equal((await post("http://127.0.0.1:8798/other", AUTH)).status, 404);
});
