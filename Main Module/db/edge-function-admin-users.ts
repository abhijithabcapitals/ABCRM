// Supabase Edge Function: admin-users
// Server-side user management so the service-role key NEVER reaches the browser.
// The client calls this with the logged-in user's JWT; the function verifies
// that caller is an admin, then performs the privileged operation with the
// service key (available only here, in Deno env).
//
// Deploy:  supabase functions deploy admin-users, with _shared and ceo-mail-reply/smtp.ts beside it (see Client Login Module/README.md)
// Secrets: SUPABASE_URL is injected automatically. Set SERVICE_SECRET_KEY to a
//          new secret API key (sb_secret_…) once you migrate off legacy JWT
//          keys; until then it falls back to the injected SUPABASE_SERVICE_ROLE_KEY.
//
// Actions (POST body):
//   { action: "create_user", email, password, full_name, role }
//   { action: "delete_user", user_id }
//   { action: "update_role", user_id, role }
//   { action: "onboard_member", employee_id | new_employee: { full_name, department?, designation? }, email, password, tabs, data_role }
//   { action: "set_access", user_id, tabs, data_role }
//   { action: "reset_password", user_id, password }
//   { action: "set_suspended", user_id, suspended }
//   { action: "openrouter_status" }   -> usage and limit of the key, never the key

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emailCredentials } from "../_shared/credentialMail.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const ROLES = ["admin", "member"];
const TABS = ["mytasks", "dashboard", "business-development", "business-setup", "business-banking", "accounts", "quotations", "clients", "tax", "hr", "spaces"];
const DATA_ROLES = ["READ_ONLY", "SALES_EXECUTIVE", "DOCUMENT_EXECUTIVE", "BANKING_EXECUTIVE", "FINANCE", "ACCOUNTS", "MANAGER", "ADMIN"];
const cleanTabs = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).filter((t) => TABS.includes(t)))];

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
    // Passwords are never written to the log.
    const audit = (what: string, target: string, detail: unknown = null) =>
      admin.from("admin_audit").insert({ actor: caller.id, action: what, target, detail });
    // deno-lint-ignore no-explicit-any
    const setAccess = async (userId: string, tabs: string[], dataRole: any) => {
      const { error: delErr } = await admin.from("member_tab_access").delete().eq("profile_id", userId);
      if (delErr) throw new Error(delErr.message);
      if (tabs.length) {
        const { error: insErr } = await admin.from("member_tab_access").insert(tabs.map((tab_key) => ({ profile_id: userId, tab_key, granted_by: caller.id })));
        if (insErr) throw new Error(insErr.message);
      }
      if (DATA_ROLES.includes(dataRole)) {
        const { error: roleErr } = await admin.from("banking_user_roles").upsert({ user_id: userId, role: dataRole });
        if (roleErr) throw new Error(roleErr.message);
      } else {
        await admin.from("banking_user_roles").delete().eq("user_id", userId);
      }
    };

    if (action === "onboard_member") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const tabs = cleanTabs(body.tabs);
      if (!email || password.length < 8) return json({ error: "An email and an 8+ character password are required." }, 400);
      if (!tabs.length) return json({ error: "Choose at least one tab." }, 400);
      const fresh = body.new_employee;
      const freshName = String(fresh?.full_name || "").trim();
      let employee: { id: string | null; employee_code: string; full_name: string; profile_id?: string | null };
      if (fresh) {
        if (!freshName) return json({ error: "Enter the person's full name." }, 400);
        const { data: sameEmail } = await admin.from("hr_employees").select("employee_code").ilike("work_email", email).limit(1);
        if (sameEmail?.length) return json({ error: `This email already belongs to employee ${sameEmail[0].employee_code}. Select them from HR Base instead.` }, 400);
        employee = { id: null, employee_code: "", full_name: freshName };
      } else {
        const { data: found } = await admin.from("hr_employees").select("id, employee_code, full_name, profile_id").eq("id", String(body.employee_id || "")).maybeSingle();
        if (!found) return json({ error: "Choose an employee from HR Base." }, 400);
        if (found.profile_id) return json({ error: `${found.employee_code} already has a login.` }, 400);
        employee = found;
      }
      const { data: made, error: makeErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { must_change_password: true, full_name: employee.full_name, ...(employee.employee_code ? { employee_code: employee.employee_code } : {}) },
      });
      if (makeErr) return json({ error: makeErr.message }, 400);
      const id = made.user.id;
      try {
        const { error: pErr } = await admin.from("profiles").upsert({ id, email, full_name: employee.full_name, role: "member" });
        if (pErr) throw new Error(pErr.message);
        await setAccess(id, tabs, body.data_role);
        if (fresh) {
          // Next free number; retry if another admin takes the same code at the same moment.
          const { data: codes } = await admin.from("hr_employees").select("employee_code");
          let next = Math.max(0, ...(codes || []).map((c) => /^\d+$/.test(c.employee_code) ? Number(c.employee_code) : 0)) + 1;
          for (let attempt = 0; ; attempt++, next++) {
            const { error: hrErr } = await admin.from("hr_employees").insert({
              employee_code: String(next), full_name: freshName, work_email: email, status: "Active", profile_id: id,
              department: String(fresh.department || "").trim() || null, designation: String(fresh.designation || "").trim() || null,
            });
            if (!hrErr) { employee.employee_code = String(next); break; }
            if (hrErr.code !== "23505" || attempt >= 4) throw new Error(hrErr.message);
          }
        } else {
          const { error: eErr } = await admin.from("hr_employees").update({ profile_id: id, updated_at: new Date().toISOString() }).eq("id", employee.id);
          if (eErr) throw new Error(eErr.message);
        }
      } catch (e) {
        // No half-made logins: remove it so the admin can simply try again.
        await admin.auth.admin.deleteUser(id);
        return json({ error: (e as Error).message }, 400);
      }
      await audit("onboard_member", email, { employee_code: employee.employee_code, new_employee: !!fresh, tabs, data_role: body.data_role || null });
      const sent = await emailCredentials(admin, caller.id, email, { audience: "staff", reset: false, name: employee.full_name, username: email, password });
      return json({ ok: true, user_id: id, email, ...sent });
    }

    if (action === "set_access") {
      const user_id = String(body.user_id || "");
      const tabs = cleanTabs(body.tabs);
      if (!user_id) return json({ error: "user_id required" }, 400);
      await setAccess(user_id, tabs, body.data_role);
      await audit("set_access", user_id, { tabs, data_role: body.data_role || null });
      return json({ ok: true });
    }

    if (action === "reset_password") {
      const user_id = String(body.user_id || "");
      const password = String(body.password || "");
      if (!user_id || password.length < 8) return json({ error: "A password needs at least 8 characters." }, 400);
      // Someone resetting their own password has chosen it, so nothing is mailed or forced.
      const self = user_id === caller.id;
      const { data: updated, error } = await admin.auth.admin.updateUserById(user_id, { password, ...(self ? {} : { user_metadata: { must_change_password: true } }) });
      if (error) return json({ error: error.message }, 400);
      await audit("reset_password", user_id);
      const email = updated.user?.email;
      if (self || !email) return json({ ok: true, emailed: false, self });
      const sent = await emailCredentials(admin, caller.id, email, { audience: "staff", reset: true, name: String(updated.user?.user_metadata?.full_name || ""), username: email, password });
      return json({ ok: true, email, ...sent });
    }

    if (action === "set_suspended") {
      const user_id = String(body.user_id || "");
      if (!user_id) return json({ error: "user_id required" }, 400);
      if (user_id === caller.id) return json({ error: "You can't suspend your own account." }, 400);
      const { error } = await admin.auth.admin.updateUserById(user_id, { ban_duration: body.suspended ? "876000h" : "none" });
      if (error) return json({ error: error.message }, 400);
      await audit(body.suspended ? "suspend" : "reactivate", user_id);
      return json({ ok: true });
    }

    if (action === "openrouter_status") {
      const key = Deno.env.get("OPENROUTER_API_KEY")?.trim();
      if (!key) return json({ error: "OPENROUTER_API_KEY is not set for this function." });
      const res = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${key}` } });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) return json({ error: out?.error?.message || `OpenRouter answered ${res.status}` });
      return json({ usage: out.data?.usage ?? null, limit: out.data?.limit ?? null, limit_remaining: out.data?.limit_remaining ?? null });
    }

    if (action === "create_user") {
      const email = String(body.email || "").trim();
      const full_name = String(body.full_name || "").trim();
      const role = ROLES.includes(body.role) ? body.role : "member";
      const password = String(body.password || "");
      if (!email || !full_name || password.length < 8) return json({ error: "Email, name, and an 8+ char password are required." }, 400);
      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name, must_change_password: true },
      });
      if (error) return json({ error: error.message }, 400);
      const { error: pErr } = await admin.from("profiles").upsert({ id: data.user.id, email, full_name, role });
      if (pErr) return json({ error: pErr.message }, 400);
      const sent = await emailCredentials(admin, caller.id, email, { audience: "staff", reset: false, name: full_name, username: email, password });
      return json({ ok: true, user_id: data.user.id, email, ...sent });
    }

    if (action === "delete_user") {
      const user_id = String(body.user_id || "");
      if (!user_id) return json({ error: "user_id required" }, 400);
      if (user_id === caller.id) return json({ error: "You can't delete your own account." }, 400);
      const { error } = await admin.auth.admin.deleteUser(user_id);
      if (error) return json({ error: error.message }, 400);
      await audit("delete_user", user_id);
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
