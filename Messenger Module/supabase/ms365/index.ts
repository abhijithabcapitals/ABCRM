// Supabase Edge Function "ms365": the CRM's only caller of Microsoft sign-in and Graph.
// Tokens and secrets stay in Vault and this function, and are never returned.
//
// GET with a state or error query: Microsoft's redirect after sign-in. No JWT; the signed state is the proof.
//
// Actions (POST JSON { action, ... }, signed-in staff):
//   connection_status                               own link; admins also get the settings and per-person list
//   connect_start                                   returns { url } for the caller's own profile
//   disconnect                                      the caller's own link
//   admin_test                                      admin only
//   user_links_review { profile_id, decision, upn } admin only; decision is accept or reject; accept needs the upn shown
//   secret_expiry_set { date }                      admin only; a YYYY-MM-DD date or null
//
// Deploy with this folder's files together. JWT verification is off so Microsoft's redirect can arrive;
// every POST checks the JWT below:
//   supabase functions deploy ms365 --project-ref pnnakrhfzyxudjaghoxx --use-api --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";
import { browserMessage, callback, handle, UserError, type BaseDeps } from "./handlers.ts";
import { requireSecret } from "./secrets.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const base: BaseDeps = {
    db: admin,
    secret: (name) => requireSecret(admin, name),
    fetch: (input, init) => fetch(input, init),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    redirectUri: `${url.replace(/\/+$/, "")}/functions/v1/ms365`,
    note: (message) => console.error(message),
  };

  if (req.method === "GET") {
    const params = new URL(req.url).searchParams;
    if (!params.has("state") && !params.has("error")) return json({ error: "Use POST" }, 405);
    try {
      const { redirect } = await callback(params, base);
      // The query held the sign-in code, so it must not travel on as a referrer or sit in a cache.
      return new Response(null, {
        status: 302,
        headers: { Location: redirect, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
      });
    } catch (e) {
      console.error("ms365: no return address:", (e as Error)?.name);
      return new Response("Microsoft sign-in is not set up. Ask an admin to set MESSENGER_APP_URL.", {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
  }

  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const userDb = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    auth: { persistSession: false },
  });
  const { data: auth } = await userDb.auth.getUser();
  if (!auth?.user) return json({ error: "Sign in first." }, 401);
  const userId = auth.user.id;

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid request body." }, 400); }

  const deps = {
    ...base,
    userId,
    isAdmin: async () => {
      const { data: me } = await userDb.from("profiles").select("role").eq("id", userId).maybeSingle();
      return me?.role === "admin";
    },
  };

  try {
    return json(await handle(String(body?.action ?? ""), body, deps));
  } catch (e) {
    if (e instanceof UserError) return json({ error: e.message }, 400);
    console.error("ms365:", (e as Error)?.name);
    return json({ error: browserMessage(e) }, 500);
  }
});
