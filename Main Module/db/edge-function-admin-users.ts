// Supabase Edge Function: admin-users
// Server-side user management so the service-role key NEVER reaches the browser.
// The client calls this with the logged-in user's JWT; the function verifies
// that caller is an admin, then performs the privileged operation with the
// service key (available only here, in Deno env).
//
// Deploy:  supabase functions deploy admin-users
// Secrets: SUPABASE_URL is injected automatically. Set SERVICE_SECRET_KEY to a
//          new secret API key (sb_secret_…) once you migrate off legacy JWT
//          keys; until then it falls back to the injected SUPABASE_SERVICE_ROLE_KEY.
//
// Actions (POST body):
//   { action: "create_user", email, password, full_name, role }
//   { action: "delete_user", user_id }
//   { action: "update_role", user_id, role }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const ROLES = ["admin", "member"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const URL = Deno.env.get("SUPABASE_URL")!;
    // Prefer the new secret API key (sb_secret_…), set as the SERVICE_SECRET_KEY
    // function secret; fall back to the legacy service_role during migration.
    // Once legacy JWT keys are disabled, SERVICE_SECRET_KEY must be set.
    const SERVICE = Deno.env.get("SERVICE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 1) Identify the caller from their JWT. The apikey here is only the gateway
    // credential; the caller's identity comes from their Authorization bearer,
    // and their admin role is re-checked below with the service client — so
    // using the secret key as the apikey grants no extra privilege to the caller.
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Not authenticated" }, 401);
    const userClient = createClient(URL, SERVICE, { global: { headers: { Authorization: authHeader } } });
    const { data: { user: caller }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !caller) return json({ error: "Not authenticated" }, 401);

    // 2) Authorize: the caller must be an admin (checked with the service client
    //    so it can't be spoofed by RLS-visible rows).
    const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: me } = await admin.from("profiles").select("role").eq("id", caller.id).single();
    if (me?.role !== "admin") return json({ error: "Admin access required" }, 403);

    const body = await req.json();
    const action = body?.action;

    if (action === "create_user") {
      const email = String(body.email || "").trim();
      const full_name = String(body.full_name || "").trim();
      const role = ROLES.includes(body.role) ? body.role : "member";
      const password = String(body.password || "");
      if (!email || !full_name || password.length < 8) return json({ error: "Email, name, and an 8+ char password are required." }, 400);
      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name },
      });
      if (error) return json({ error: error.message }, 400);
      const { error: pErr } = await admin.from("profiles").upsert({ id: data.user.id, email, full_name, role });
      if (pErr) return json({ error: pErr.message }, 400);
      return json({ ok: true, user_id: data.user.id });
    }

    if (action === "delete_user") {
      const user_id = String(body.user_id || "");
      if (!user_id) return json({ error: "user_id required" }, 400);
      if (user_id === caller.id) return json({ error: "You can't delete your own account." }, 400);
      const { error } = await admin.auth.admin.deleteUser(user_id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "update_role") {
      const user_id = String(body.user_id || "");
      const role = body.role;
      if (!user_id || !ROLES.includes(role)) return json({ error: "user_id and a valid role are required." }, 400);
      if (user_id === caller.id) return json({ error: "You can't change your own role." }, 400);
      const { error } = await admin.from("profiles").update({ role }).eq("id", user_id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
