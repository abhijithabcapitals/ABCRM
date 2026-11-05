// End-to-end check of Bruno -> sub agent -> CRM Agent, running the real three functions against a fake database and model.
// No network to Supabase or OpenRouter. Run from this folder: deno run -A --no-check chain.deno.ts

Deno.env.set("SUPABASE_URL", "http://fake.local");
Deno.env.set("SUPABASE_ANON_KEY", "anon");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service");
Deno.env.set("OPENROUTER_API_KEY", "shared-key");

// deno-lint-ignore no-explicit-any
type Any = any;
const handlers: ((r: Request) => Promise<Response>)[] = [];
Deno.serve = ((h: Any) => { handlers.push(h); return {} as Any; }) as Any;
const log = console.log;
console.log = () => {};

const USER = "11111111-1111-1111-1111-111111111111";
const AGENTS: Record<string, Any> = {
  "AGT-00-ORCHESTRATOR": { enabled: true, provider: "openrouter", model: "bruno/model", instructions: "ROUTING-RULE-FROM-SETTINGS", extra_content: "" },
  "AGT-05-BIZDEV": { id: "AGT-05-BIZDEV", name: "BD Agent", role: "Leads", instructions: "BD-INSTRUCTIONS-FROM-SETTINGS", extra_content: "", approval_rules: "", provider: "openrouter", model: "bd/model", enabled: true, runtime: "gateway" },
  "AGT-14-CRM": { enabled: true, provider: "openrouter", model: "crm/model", instructions: "", extra_content: "", approval_rules: "" },
};
const state = {
  tabs: ["business-development"] as string[],
  scope: [{ schema_name: "public", table_name: "bd_leads" }] as Any[],
  ownKeys: {} as Record<string, string>,
  crmEnabled: true,
  calls: [] as string[],
  keysUsed: [] as string[],
  modelsUsed: [] as string[],
  crmBodies: [] as Any[],
  crmTools: [] as string[][],
  rankingSystem: "",
  gatewaySystem: "",
  rowsRead: 0,
  usage: [] as Any[],
};
const reset = () => Object.assign(state, { tabs: ["business-development"], scope: [{ schema_name: "public", table_name: "bd_leads" }], ownKeys: {}, crmEnabled: true, calls: [], keysUsed: [], modelsUsed: [], crmBodies: [], crmTools: [], rankingSystem: "", gatewaySystem: "", rowsRead: 0, usage: [] });

const toJson = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
const toolCall = (name: string, args: unknown) => ({ id: crypto.randomUUID(), type: "function", function: { name, arguments: JSON.stringify(args) } });
const modelReply = (message: Any) => toJson({ choices: [{ message, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.001 } });

function fakeModel(body: Any) {
  state.modelsUsed.push(body.model);
  const system: string = body.messages[0].content;
  const last = body.messages[body.messages.length - 1];
  if (system.startsWith("Choose which agents")) {
    state.calls.push("bruno:rank");
    state.rankingSystem = system;
    return modelReply({ content: '["AGT-05-BIZDEV"]' });
  }
  if (system.includes("specialist agent")) {
    state.gatewaySystem = system;
    if (last.role === "tool") {
      state.calls.push("sub:answer");
      return modelReply({ content: last.content.includes("ACME") ? "The lead is ACME." : "NO_INFO" });
    }
    state.calls.push("sub:ask-crm");
    return modelReply({ content: null, tool_calls: [toolCall("ask_crm_agent", { question: "Which lead is LD-1?" })] });
  }
  state.crmTools.push(body.tools.map((t: Any) => t.function.name));
  if (last.role === "tool") {
    state.calls.push("crm:answer");
    return modelReply({ content: last.content.includes("ACME") ? "ACME" : "NO_INFO" });
  }
  state.calls.push("crm:read");
  return modelReply({ content: null, tool_calls: [toolCall("read_rows", { schema: "public", table: "bd_leads", columns: ["name"], filters: [], order: null, limit: 1 })] });
}

function fakeDb(url: URL, init: Any, accept: string) {
  const path = url.pathname.replace("/rest/v1/", "");
  const service = String(init?.headers?.apikey ?? new Headers(init?.headers).get("apikey")) === "service";
  const one = accept.includes("vnd.pgrst.object");
  const row = (o: Any) => toJson(one ? o : [o]);
  if (path.startsWith("rpc/")) {
    const fn = path.slice(4);
    const args = init?.body ? JSON.parse(init.body) : {};
    if (fn === "router_context") {
      return toJson({
        agent_name: "Bruno", credit_left: 5, recent: [],
        agents: [
          { id: "AGT-05-BIZDEV", name: "BD Agent", role: "Leads", budget_left: null },
          { id: "AGT-03-TAX", name: "Tax Agent", role: "Tax", budget_left: null },
        ],
      });
    }
    if (fn === "credential_get") return toJson(state.ownKeys[args.p_name] ?? null);
    if (fn === "agent_budget_left") return toJson(null);
    if (fn === "my_tabs") return toJson(state.tabs);
    if (fn === "crm_agent_table_info") return toJson({ columns: [{ name: "name" }], primary_key: ["id"] });
    if (fn === "router_record_usage") { state.usage.push(args); return toJson(null); }
    return toJson(null);
  }
  if (path === "agents") {
    const id = url.searchParams.get("id")!.replace("eq.", "");
    const a = { ...AGENTS[id] };
    if (id === "AGT-14-CRM") a.enabled = state.crmEnabled;
    return row(a);
  }
  if (path === "agent_table_access") return toJson(state.scope);
  if (path === "agent_knowledge") return toJson([]);
  if (path === "profiles") return row({ role: "member", full_name: "Test Person" });
  if (path === "ai_usage") return toJson(null, 201);
  if (path === "bd_leads") {
    if (service) throw new Error("row data read with the service role");
    state.rowsRead += 1;
    return toJson([{ name: "ACME" }]);
  }
  throw new Error(`unexpected table ${path}`);
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Any, init: Any = {}) => {
  const req = input instanceof Request ? input : null;
  const href = req ? req.url : String(input);
  const url = new URL(href);
  const headers = new Headers(init.headers ?? req?.headers);
  const opts = { ...init, headers: Object.fromEntries(headers), body: init.body ?? (req ? await req.clone().text() : undefined) };
  if (url.host === "openrouter.ai") {
    state.keysUsed.push(headers.get("authorization") || "");
    return fakeModel(JSON.parse(opts.body));
  }
  if (url.host !== "fake.local") return realFetch(input, init);
  if (url.pathname === "/auth/v1/user") return toJson({ id: USER, aud: "authenticated", email: "t@example.com" });
  if (url.pathname.startsWith("/functions/v1/")) {
    const fn = url.pathname.split("/").pop()!;
    state.calls.push(`call:${fn}`);
    const body = JSON.parse(opts.body);
    if (fn === "crm-agent") state.crmBodies.push(body);
    const h = fn === "router-agent" ? handlers[0] : fn === "agent-gateway" ? handlers[1] : fn === "crm-agent" ? handlers[2] : null;
    if (!h) throw new Error(`unexpected function ${fn}`);
    return await h(new Request(href, { method: "POST", headers, body: opts.body }));
  }
  return fakeDb(url, opts, headers.get("accept") || "");
}) as typeof fetch;

await import("../supabase/router-agent/index.ts");
await import("../supabase/agent-gateway/index.ts");
await import("../../14_CRM_Agent/supabase/crm-agent/index.ts");

const ask = async () => {
  const res = await handlers[0](new Request("http://fake.local/functions/v1/router-agent", {
    method: "POST", headers: { Authorization: "Bearer user-jwt", "Content-Type": "application/json" }, body: JSON.stringify({ message: "Who is lead LD-1?" }),
  }));
  return await res.json();
};

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (!ok) failed += 1;
  log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`);
};

reset();
let out = await ask();
check("Bruno returns the sub agent's reply, with its name", out.reply === "The lead is ACME." && out.from === "BD Agent", out);
const expected = ["bruno:rank", "call:agent-gateway", "sub:ask-crm", "call:crm-agent", "crm:read", "crm:answer", "sub:answer"];
check("the order is Bruno, sub agent, CRM Agent, sub agent, Bruno", JSON.stringify(state.calls) === JSON.stringify(expected), state.calls);
check("each agent uses its model from Settings", JSON.stringify(state.modelsUsed) === JSON.stringify(["bruno/model", "bd/model", "crm/model", "crm/model", "bd/model"]), state.modelsUsed);
check("Bruno's instructions reach routing", state.rankingSystem.includes("ROUTING-RULE-FROM-SETTINGS"));
check("the sub agent's instructions reach its model", state.gatewaySystem.includes("BD-INSTRUCTIONS-FROM-SETTINGS"));
check("the CRM Agent is told who asks", state.crmBodies[0]?.caller_agent === "AGT-05-BIZDEV", state.crmBodies);
check("a sub agent's CRM question has no write tool", state.crmTools.every((t) => !t.includes("change_rows")), state.crmTools);
check("usage is recorded per agent", ["AGT-05-BIZDEV", "AGT-14-CRM", "AGT-00-ORCHESTRATOR"].every((id) => state.usage.some((u) => u.p_agent_id === id)), state.usage);

reset();
state.scope = [];
out = await ask();
check("a table off the sub agent's list is not read", state.rowsRead === 0 && out.from === null && out.reply === "Opps! I dont Know", { out, rows: state.rowsRead });

reset();
state.tabs = [];
out = await ask();
check("a table the person's tabs do not reach is not read", state.rowsRead === 0 && out.reply === "Opps! I dont Know", { out, rows: state.rowsRead });

reset();
state.ownKeys = { AGENT_KEY_AGT_05_BIZDEV: "bd-own-key" };
await ask();
check("an agent's own key from Settings wins over the shared key", state.keysUsed[0] === "Bearer shared-key" && state.keysUsed[1] === "Bearer bd-own-key" && state.keysUsed[2] === "Bearer shared-key", state.keysUsed);

reset();
state.crmEnabled = false;
out = await ask();
check("switching the CRM Agent off stops sub agents reading data", state.rowsRead === 0 && out.reply === "Opps! I dont Know", { out, rows: state.rowsRead });

reset();
const denied = await handlers[2](new Request("http://fake.local/functions/v1/crm-agent", {
  method: "POST", headers: { Authorization: "Bearer user-jwt", "Content-Type": "application/json" },
  body: JSON.stringify({ messages: [{ role: "user", content: "q" }], caller_agent: "AGT-10-HR" }),
}));
check("a person cannot name a sub agent they are not ticked for", denied.status === 403, denied.status);

const unticked = await handlers[1](new Request("http://fake.local/functions/v1/agent-gateway", {
  method: "POST", headers: { Authorization: "Bearer user-jwt", "Content-Type": "application/json" },
  body: JSON.stringify({ agent_id: "AGT-10-HR", messages: [{ role: "user", content: "q" }] }),
}));
check("the gateway refuses an agent the person is not ticked for", unticked.status === 403, unticked.status);

log(failed ? `${failed} FAILED` : "all passed");
Deno.exit(failed ? 1 : 0);
