// Supabase Edge Function "agent-gateway": runs any sub agent from its row in Settings > Agents.
//
// POST { agent_id, messages } returns { reply, cost_usd, usage_recorded }. The role, instructions, extra content, knowledge,
// approval rules, model and API key all come from Settings > Agents. Bruno calls this; it replies NO_INFO when it has no answer.
//
// A sub agent reaches CRM data only by asking the CRM Agent, with the person's own login, so it can never see more than
// the person may. It has no write tool.
//
// Access: router_context applies the on switch, access tick, credit and budget, so a direct call gets the same limits as
// Bruno. The service role reads settings and knowledge and writes usage, always after verifying the login.
//
// Logs hold reason codes only, never message text or row data.
// Copy logic.js with this file. Deploy as "agent-gateway" with JWT verification on.
// Secret: OPENROUTER_API_KEY, the shared key. An agent's own key from Settings > Agents wins over it.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  accessFrom, agentKeyName, ASK_CRM_TOOL, buildSystem, cleanHistory, isSubAgent, knowledgeText, MAX_CRM_CALLS, MAX_ROUNDS, NO_INFO,
  openRouterCost, outOfMoney, readQuestion, wrapData,
} from "./logic.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEADLINE_MS = 110_000;
const CRM_CALL_MS = 70_000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

const note = (code: string) => console.log(`agent-gateway: ${code}`);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const db = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: auth } = await db.auth.getUser();
  if (!auth?.user) return json({ error: "Sign in first." }, 401);

  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }
  const agentId = body?.agent_id;
  if (!isSubAgent(agentId)) return json({ error: "That agent does not run here." }, 400);
  const history = cleanHistory(body?.messages);
  if (!history.length || history[history.length - 1].role !== "user") return json({ error: "Send a question." }, 400);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: context } = await admin.rpc("router_context", { p_profile: auth.user.id });
  const access = accessFrom(context, agentId);
  if (!access.allowed) {
    note("not_allowed");
    return json({ error: "You do not have access to this agent, or no credit is left." }, 403);
  }

  const { data: agent } = await admin.from("agents")
    .select("id, name, role, instructions, extra_content, approval_rules, provider, model, enabled, runtime").eq("id", agentId).maybeSingle();
  if (!agent?.enabled || agent.runtime !== "gateway") {
    note("not_connected");
    return json({ error: "This agent is not connected." }, 503);
  }
  if (agent.provider !== "openrouter" || !agent.model) {
    note("model_not_supported");
    return json({ error: "This agent needs an OpenRouter model in Settings > Agents." }, 503);
  }
  const { data: ownKey } = await admin.rpc("credential_get", { p_name: agentKeyName(agentId) });
  const apiKey = ownKey || Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) {
    note("no_key");
    return json({ error: "No OpenRouter key is set." }, 503);
  }

  // Only approved, shareable articles from the categories an admin ticked for this agent.
  const { data: ticks } = await admin.from("agent_knowledge").select("category_id").eq("agent_id", agentId);
  const categories = (ticks || []).map((t) => t.category_id);
  const { data: entries } = categories.length
    ? await admin.from("knowledge_entries").select("title, body")
      .in("category_id", categories).eq("status", "Approved").eq("visibility", "Shareable").is("deleted_at", null)
      .order("updated_at", { ascending: false }).limit(50)
    : { data: [] };
  const { data: profile } = await db.from("profiles").select("full_name").eq("id", auth.user.id).maybeSingle();

  const system = buildSystem(agent, {
    knowledge: knowledgeText(entries),
    today: new Date().toLocaleDateString("en-GB", { timeZone: "Asia/Dubai" }),
    person: profile?.full_name || "a CRM user",
  });
  // deno-lint-ignore no-explicit-any
  const messages: any[] = [{ role: "system", content: system }, ...history];
  const deadline = Date.now() + DEADLINE_MS;
  let own = 0; // recorded here
  let crm = 0; // recorded by crm-agent
  let crmCalls = 0;
  const spent = () => own + crm;
  const done = (reply: string) => json({ reply, cost_usd: spent(), usage_recorded: true });

  const askCrm = async (question: string) => {
    if (!question) return "Error: name the data you need.";
    if (crmCalls >= MAX_CRM_CALLS) return `Error: at most ${MAX_CRM_CALLS} questions per message.`;
    crmCalls += 1;
    try {
      const res = await fetch(`${url}/functions/v1/crm-agent`, {
        method: "POST",
        headers: { Authorization: authHeader, apikey: anon, "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: question }], router: true, caller_agent: agentId }),
        signal: AbortSignal.timeout(Math.min(CRM_CALL_MS, Math.max(deadline - Date.now(), 1))),
      });
      const result = await res.json().catch(() => null);
      if (typeof result?.cost_usd === "number") crm += result.cost_usd;
      if (!res.ok) {
        note(`crm_${res.status}`);
        return "Error: the CRM Agent could not answer.";
      }
      return wrapData(typeof result?.reply === "string" ? result.reply : NO_INFO);
    } catch {
      note("crm_timeout");
      return "Error: the CRM Agent could not answer in time.";
    }
  };

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const left = deadline - Date.now();
      if (left <= 0 || outOfMoney(spent(), access.limit)) {
        note(left <= 0 ? "deadline" : "no_credit");
        return done(NO_INFO);
      }
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Title": "CRM Agent Gateway" },
        body: JSON.stringify({
          model: agent.model,
          max_tokens: 1500,
          temperature: 0.2,
          usage: { include: true },
          tools: [ASK_CRM_TOOL],
          messages,
          // Only providers that support tools and do not retain or train on prompts.
          provider: { require_parameters: true, data_collection: "deny" },
        }),
        signal: AbortSignal.timeout(left),
      });
      const data = await res.json().catch(() => ({}));
      const u = data?.usage;
      const cost = openRouterCost(u);
      own += cost;
      if (u) {
        const { error } = await admin.from("ai_usage").insert({
          function_name: "agent-gateway", user_id: auth.user.id, model: agent.model, prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens,
          reasoning_tokens: u.completion_tokens_details?.reasoning_tokens ?? null, cached_tokens: u.prompt_tokens_details?.cached_tokens ?? null, cost_usd: cost,
        });
        if (error) note("ledger_failed");
      }
      if (!res.ok || data?.error) {
        note(`model_${res.ok ? "error" : res.status}`);
        return json({ error: "This agent could not answer.", cost_usd: spent(), usage_recorded: true }, 502);
      }
      const choice = data?.choices?.[0];
      if (choice?.finish_reason === "content_filter" || !choice?.message) {
        note("refusal");
        return done(NO_INFO);
      }
      // deno-lint-ignore no-explicit-any
      const toolCalls: any[] = choice.message.tool_calls || [];
      if (!toolCalls.length) return done(String(choice.message.content || "").trim() || NO_INFO);

      messages.push({ role: "assistant", content: choice.message.content, tool_calls: toolCalls });
      for (const call of toolCalls) {
        const text = call.function?.name === "ask_crm_agent"
          ? await askCrm(readQuestion(call.function?.arguments))
          : "Error: there is no such tool.";
        messages.push({ role: "tool", tool_call_id: call.id, content: text });
      }
    }
    note("too_many_rounds");
    return done(NO_INFO);
  } catch {
    note("failed");
    return json({ error: "This agent could not answer.", cost_usd: spent(), usage_recorded: true }, 502);
  } finally {
    if (own > 0) {
      const { error } = await admin.rpc("router_record_usage", { p_agent_id: agentId, p_profile: auth.user.id, p_cost: own });
      if (error) note("usage_failed");
    }
  }
});
