// Supabase Edge Function "zoho-books": lets the CRM read from and create documents in Zoho Books.
// Only the calls listed in zohoClient.ts can leave this function. Credentials are read from
// Settings > Integrations (or Edge Function secrets) and are never returned.
//
// Actions (POST JSON { action, ... }):
//   connection_test                                  admin only
//   taxes_list                                       admin only
//   contacts_search { query, department }            needs manage permission
//   contact_link    { client_id, zoho_contact_id, department }
//   contact_get     { client_id, department }        needs view permission
//
// Deploy with this folder's files together:
//   supabase functions deploy zoho-books --project-ref pnnakrhfzyxudjaghoxx --use-api

import { createClient } from "npm:@supabase/supabase-js@2";
import { browserMessage, handle, permissionCheck, UserError } from "./handlers.ts";
import { requireSecret } from "./secrets.ts";
import { createZohoClient, scrub, type ZohoConfig } from "./zohoClient.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

// One client per warm instance, so the access token is reused. Rebuilt when any setting changes.
let cached: { key: string; client: ReturnType<typeof createZohoClient> } | undefined;
function zohoFor(cfg: ZohoConfig) {
  const key = JSON.stringify([cfg.clientId, cfg.refreshToken, cfg.orgId, cfg.dc]);
  if (cached?.key !== key) cached = { key, client: createZohoClient(cfg) };
  return cached.client;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const userDb = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    auth: { persistSession: false },
  });
  const { data: auth } = await userDb.auth.getUser();
  if (!auth?.user) return json({ error: "Sign in first." }, 401);
  const userId = auth.user.id;

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid request body." }, 400); }

  const names = ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN", "ZOHO_BOOKS_ORG_ID", "ZOHO_DC"];
  let secretValues: string[] = [];

  const deps = {
    isAdmin: async () => {
      const { data: me } = await userDb.from("profiles").select("role").eq("id", userId).maybeSingle();
      return me?.role === "admin";
    },
    can: (department: string, permission: string) =>
      permissionCheck(async (name, args) => {
        const { data, error } = await userDb.rpc(name, args);
        return { data, error };
      }, department, permission),
    db: admin,
    zoho: async () => {
      const [clientId, clientSecret, refreshToken, orgId, dc] = await Promise.all(names.map((n) => requireSecret(admin, n)));
      secretValues = [clientId, clientSecret, refreshToken, orgId];
      return { ...zohoFor({ clientId, clientSecret, refreshToken, orgId, dc }), orgId };
    },
    userId,
    now: () => new Date(),
  };

  try {
    return json(await handle(String(body?.action ?? ""), body, deps));
  } catch (e) {
    if (e instanceof UserError) return json({ error: e.message }, 400);
    const detail = scrub((e as Error)?.message ?? "Unexpected error", secretValues);
    console.error("zoho-books:", (e as Error)?.name, detail);
    return json({ error: browserMessage(e) }, 500);
  }
});
