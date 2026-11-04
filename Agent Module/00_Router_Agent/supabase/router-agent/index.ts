// Supabase Edge Function "router-agent": Bruno, the chat agent every CRM user has.
//
// POST { message } returns { reply, from }. `reply` is one agent's reply, word for word, with its
// name in `from`; or the fixed reply with `from` null when no agent gave information. Bruno adds no
// words of its own. The browser sends only the message, so it cannot choose an agent.
//
// Access: router_context applies Settings > Agents (on switch, access tick, credit, budget) and
// ROUTES in logic.js is the fixed list of functions that may be called. Agents are called with the
// caller's own login, so row-level security and each agent's own checks still apply. The service
// role is used only for the router_* functions, always with the verified person's id.
//
// Logs hold short reason codes only, never message text.
//
// Copy logic.js with this file. Deploy as "router-agent" with JWT verification on.
// Secret: OPENROUTER_API_KEY, for ranking between agents.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  agentHistory, agentRequest, canAfford, eligibleAgents, fallbackAgents, FIXED_REPLY, MAX_MESSAGE, parseRanking, rankingFailureReason, rankingPrompt, readAgentReply, ROUTES,
} from "./logic.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const RANKING_MODEL = "deepseek/deepseek-v4.1-flash";
const ORCHESTRATOR_ID = "AGT-00-ORCHESTRATOR";
const CEO_ID = "AGT-11-CEO";
const REQUEST_MS = 140_000;
const RANKING_MS = 15_000;
const AGENT_MS = 70_000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

const note = (code: string) => console.log(`router-agent: ${code}`);

type Agent = { id: string; name: string; role: string; budget_left: number | null };
type Turn = { admin: SupabaseClient; uid: string; question: string };

async function recordUsage(admin: SupabaseClient, agentId: string, uid: string, cost: number) {
  const { error } = await admin.rpc("router_record_usage", { p_agent_id: agentId, p_profile: uid, p_cost: cost });
  if (error) note("usage_failed");
}

// A failed save is logged and never changes what the person is told.
async function saveTurn({ admin, uid, question }: Turn, answer: string, agentId: string | null) {
  const saved = await admin.rpc("router_save_message", { p_profile: uid, p_role: "user", p_content: question, p_agent_id: null });
  const answered = await admin.rpc("router_save_message", { p_profile: uid, p_role: "assistant", p_content: answer, p_agent_id: agentId });
  if (saved.error || answered.error) note("save_failed");
}

// Records the call in public.ai_usage (counts only, never content) and returns the ranked agent ids.
async function rankAgents({ admin, uid, question }: Turn, agents: Agent[]) {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) {
    note("ranking_no_key");
    return { ids: [] as string[], cost: 0, failed: true };
  }
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: RANKING_MODEL,
      provider: { data_collection: "deny" },
      temperature: 0,
      max_tokens: 100,
      usage: { include: true },
      messages: rankingPrompt(question, agents),
    }),
    signal: AbortSignal.timeout(RANKING_MS),
  });
  const data = await res.json().catch(() => ({}));
  const u = data?.usage;
  if (u) {
    const { error } = await admin.from("ai_usage").insert({
      function_name: "router-agent", user_id: uid, model: RANKING_MODEL, prompt_tokens: u.prompt_tokens,
      completion_tokens: u.completion_tokens, reasoning_tokens: u.completion_tokens_details?.reasoning_tokens ?? null,
      cached_tokens: u.prompt_tokens_details?.cached_tokens ?? null, cost_usd: u.cost ?? null,
    });
    if (error) note("ledger_failed");
  }
  const cost = typeof u?.cost === "number" ? u.cost : 0;
  if (!res.ok) {
    note(`ranking_${res.status}`);
    const reason = rankingFailureReason(data, question);
    if (reason) note(`ranking_reason: ${reason}`);
    return { ids: [] as string[], cost, failed: true };
  }
  return { ids: parseRanking(data?.choices?.[0]?.message?.content, agents.map((a) => a.id)) as string[], cost, failed: false };
}

async function route(turn: Turn, authHeader: string) {
  const { admin, uid, question } = turn;
  const deadline = Date.now() + REQUEST_MS;
  const fixed = async (code: string) => {
    note(code);
    await saveTurn(turn, FIXED_REPLY, null);
    return { reply: FIXED_REPLY, from: null };
  };

  const { data: ctx, error } = await admin.rpc("router_context", { p_profile: uid });
  if (error || !ctx) return await fixed("context_failed");

  const agents: Agent[] = eligibleAgents(ctx.agents || []);
  if (!agents.length) return await fixed("no_agent");

  let spent = 0;
  let order = [agents[0].id];
  if (agents.length > 1) {
    const ranked = await rankAgents(turn, agents).catch(() => {
      note("ranking_failed");
      return { ids: [] as string[], cost: 0, failed: true };
    });
    if (ranked.cost > 0) {
      spent += ranked.cost;
      await recordUsage(admin, ORCHESTRATOR_ID, uid, ranked.cost);
    }
    order = ranked.failed ? fallbackAgents(agents) : ranked.ids;
    if (!order.length) return await fixed("no_ranking");
  }

  const messages = agentHistory(ctx.recent, question);
  for (const id of order) {
    const agent = agents.find((a) => a.id === id)!;
    if (!canAfford(agent, ctx.credit_left, spent)) return await fixed("no_credit");
    const left = deadline - Date.now();
    if (left <= 0) return await fixed("deadline");

    let status = 0;
    // deno-lint-ignore no-explicit-any
    let body: any = null;
    try {
      const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/${ROUTES[id].fn}`, {
        method: "POST",
        headers: { Authorization: authHeader, apikey: Deno.env.get("SUPABASE_ANON_KEY")!, "Content-Type": "application/json" },
        body: JSON.stringify(agentRequest(id, messages, { threadId: ctx.ceo_thread_id ?? undefined, idempotencyKey: crypto.randomUUID() })),
        signal: AbortSignal.timeout(Math.min(AGENT_MS, left)),
      });
      status = res.status;
      body = await res.json().catch(() => null);
    } catch {
      note("agent_timeout");
      continue;
    }

    if (typeof body?.cost_usd === "number") {
      spent += body.cost_usd;
      await recordUsage(admin, id, uid, body.cost_usd);
    } else {
      note("no_cost");
    }
    if (id === CEO_ID && typeof body?.threadId === "string" && body.threadId !== ctx.ceo_thread_id) {
      const { error: threadError } = await admin.rpc("router_set_ceo_thread", { p_profile: uid, p_thread: body.threadId });
      if (threadError) note("thread_failed");
    }

    const result = readAgentReply(status, body);
    if (result.answer !== undefined) {
      await saveTurn(turn, result.answer, id);
      return { reply: result.answer, from: agent.name };
    }
    note(result.code!);
  }
  return await fixed("no_answer");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: auth } = await db.auth.getUser();
  if (!auth?.user) return json({ error: "Sign in first." }, 401);

  let input: { message?: unknown };
  try {
    input = await req.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }
  const question = typeof input.message === "string" ? input.message.trim() : "";
  if (!question || question.length > MAX_MESSAGE) return json({ error: "Send a question of up to 4,000 characters." }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    return json(await route({ admin, uid: auth.user.id, question }, authHeader));
  } catch {
    note("failed");
    return json({ reply: FIXED_REPLY, from: null });
  }
});
