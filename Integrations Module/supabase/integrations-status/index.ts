// Supabase Edge Function "integrations-status": tells CRM admins which
// integration secrets have a value. It returns only true/false per name,
// never a value. Deploy with secrets.ts and registry.json beside this file.

import { createClient } from "npm:@supabase/supabase-js@2";
import { getSecret, secretNames } from "./secrets.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
  });
  const { data: auth } = await db.auth.getUser();
  if (!auth?.user) return json({ error: "Sign in first." }, 401);
  const { data: profile } = await db.from("profiles").select("role").eq("id", auth.user.id).single();
  if (profile?.role !== "admin") return json({ error: "Only CRM admins can view integrations." }, 403);

  const configured: Record<string, boolean> = {};
  for (const name of secretNames) configured[name] = !!getSecret(name);
  return json({ configured });
});
