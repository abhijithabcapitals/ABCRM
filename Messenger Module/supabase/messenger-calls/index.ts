// Supabase Edge Function "messenger-calls": LiveKit join tokens for people in a call, and LiveKit's webhook.
// The database decides who may join, using the caller's own login. The API secret stays here.
//
// POST { action: "token", call_id } from signed-in staff: returns { url, token, media }.
// POST from LiveKit with its signed Authorization header: updates the call.
//
// Secrets: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET. See docs/calls-setup.md.
// JWT verification is off so LiveKit's webhook can arrive. Tokens need the caller's own login; the webhook checks its own signature:
//   supabase functions deploy messenger-calls --project-ref pnnakrhfzyxudjaghoxx --use-api --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";
import { handle, Refused, verifyWebhook, webhookCall } from "./handlers.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const liveUrl = Deno.env.get("LIVEKIT_URL");
  const apiKey = Deno.env.get("LIVEKIT_API_KEY");
  const apiSecret = Deno.env.get("LIVEKIT_API_SECRET");
  const livekit = liveUrl && apiKey && apiSecret ? { url: liveUrl, apiKey, apiSecret } : null;
  const raw = await req.text();

  // LiveKit sends application/webhook+json; browsers send application/json.
  if ((req.headers.get("content-type") || "").includes("webhook")) {
    if (!livekit) return json({ error: "Not set up" }, 503);
    const event = await verifyWebhook({ authorization: req.headers.get("authorization"), rawBody: raw, apiKey: livekit.apiKey, apiSecret: livekit.apiSecret, now: Date.now() });
    if (!event) return json({ error: "Refused" }, 401);
    const call = webhookCall(event);
    if (call) {
      const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
      const { error } = await admin.rpc("messenger_call_event", call);
      if (error) {
        console.error("messenger-calls webhook failed", error.message);
        return json({ error: "Try again" }, 500);   // LiveKit retries
      }
    }
    return json({ ok: true });
  }

  const authorization = req.headers.get("authorization") ?? "";
  const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false }, global: { headers: { Authorization: authorization } } });
  try {
    return json(await handle(JSON.parse(raw), {
      rpc: async (fn, args) => {
        const { data, error } = await client.rpc(fn, args);
        return { data, error };
      },
      userId: async () => (await client.auth.getUser(authorization.replace(/^Bearer\s+/i, ""))).data.user?.id ?? null,
      livekit,
      now: () => Date.now(),
    }));
  } catch (e) {
    if (e instanceof Refused) return json({ error: e.message });
    console.error("messenger-calls failed", e);
    return json({ error: "Calls are not available right now." });
  }
});
