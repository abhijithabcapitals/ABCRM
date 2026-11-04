// Supabase Edge Function "messenger-inbox": connects WhatsApp, Telegram and Instagram accounts, receives their webhooks and sends replies.
//
// POST { action, ... } from signed-in staff:
//   connect { channel, label, token, external_id?, app_secret? }    admin; checks the token with the platform, then stores it in Vault
//   info | test | disconnect { account_id }                         admin
//   send { thread_id, body }                                        anyone the account is shared with
// GET or POST ?account=<id> from the platform: Meta's check, or a signed webhook.
//
// JWT verification is off so webhooks can arrive. Staff calls use the caller's own login; webhooks check their signature.
//   supabase functions deploy messenger-inbox --project-ref pnnakrhfzyxudjaghoxx --use-api --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";
import { type Account, type Deps, handle, Refused, webhookReceive, webhookVerify } from "./handlers.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const base = Deno.env.get("SUPABASE_URL")!.replace(/\/+$/, "");
  const admin = createClient(base, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const user = createClient(base, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false }, global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const deps: Deps = {
    userRpc: async (fn, args) => {
      const { data, error } = await user.rpc(fn, args);
      return { data, error };
    },
    serviceRpc: async (fn, args) => {
      const { data, error } = await admin.rpc(fn, args);
      return { data, error };
    },
    account: async (id) => {
      const { data } = await admin.from("messenger_inbox_accounts").select("id, channel, external_id").eq("id", id).maybeSingle();
      return (data as Account) ?? null;
    },
    http: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15000) }),
    randomSecret: () => crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", ""),
    webhookUrl: (id) => `${base}/functions/v1/messenger-inbox?account=${id}`,
    note: (message) => console.error(message),
  };

  const params = new URL(req.url).searchParams;
  const accountId = params.get("account");
  if (accountId) {
    if (req.method === "GET") {
      const challenge = await webhookVerify(accountId, params, deps);
      return challenge ? new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } }) : new Response("Refused", { status: 403 });
    }
    if (req.method !== "POST") return new Response("Use POST", { status: 405 });
    const status = await webhookReceive(accountId, await req.text(), req.headers, deps);
    return new Response(status === 200 ? "ok" : "refused", { status });
  }

  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  try {
    return json(await handle(await req.json(), deps));
  } catch (e) {
    if (e instanceof Refused) return json({ error: e.message });
    console.error("messenger-inbox failed");   // never the error itself: it could quote a token
    return json({ error: "The Inbox is not available right now." });
  }
});
