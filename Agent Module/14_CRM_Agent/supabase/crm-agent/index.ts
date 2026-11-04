// Supabase Edge Function "crm-agent": the CRM Agent's answers for Bruno.
//
// POST { messages, router } returns { reply, cost_usd }. It finds lead numbers (LD-YYYY-n) in the
// person's messages and reports each lead's status. No AI model is used, so cost_usd is always 0.
// With no number, or no lead the person may see, the reply is NO_INFO.
//
// Access: the caller's own login is used for every lookup (crm_agent_lead_status_for_me), so
// row-level security decides which leads a person sees. No service role, no secrets.
//
// Logs hold short reason codes only, never lead numbers or message text.
//
// Copy logic.js with this file. Deploy as "crm-agent" with JWT verification on, no secrets.

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildReply, findLeadNumbers } from "./logic.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

const note = (code: string) => console.log(`crm-agent: ${code}`);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
  });
  const { data: auth } = await db.auth.getUser();
  if (!auth?.user) return json({ error: "Sign in first." }, 401);

  let input: { messages?: unknown };
  try {
    input = await req.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const numbers: string[] = findLeadNumbers(input?.messages);
  // A lookup error or an "error" result (not_found) both mean the person gets no information.
  const results = await Promise.all(numbers.map(async (p_lead) => {
    const { data, error } = await db.rpc("crm_agent_lead_status_for_me", { p_lead });
    if (error) {
      note("lookup_failed");
      return null;
    }
    return data && !data.error ? data : null;
  }));
  return json({ reply: buildReply(numbers, results), cost_usd: 0 });
});
