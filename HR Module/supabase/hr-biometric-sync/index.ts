// Supabase Edge Function "hr-biometric-sync" (CRM Project): copies punches from e-timeoffice into HR Base and rolls them up into
// hr_attendance (see Database Module/HR Base/migrations/009_hr_biometric.sql). Read-only towards e-timeoffice.
//
// Every 15 minutes (pg_cron, Biometric Base/schedule.sql) it re-reads the last 3 days. Re-reading is safe: punches are unique per code and
// time. "Sync now" on the Attendance tab does the same; with { from, to } (YYYY-MM-DD) it catches up a date range, HR only.
//
// Deploy with JWT verification OFF: the scheduler sends x-sync-secret (checked by hr_biometric_secret_ok, created in schedule.sql) and
// "Sync now" sends the user's session token (checked here with hr_is_admin_or_hr).
// Credentials: ETIMEOFFICE_CORPORATE_ID, ETIMEOFFICE_USERNAME, ETIMEOFFICE_PASSWORD, as Edge Function secrets or, where credential_get is
// on the database, saved in Settings > Integrations (which wins).

import { createClient } from "npm:@supabase/supabase-js@2";
import { authHeader, dateRangeWindow, fetchPunches, recentWindow } from "./etimeoffice.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
async function requireSecret(admin: any, name: string) {
  const { data } = await admin.rpc("credential_get", { p_name: name });
  const value = (typeof data === "string" && data ? data : Deno.env.get(name))?.trim();
  if (!value) throw new Error(`${name} is not set. Add the e-timeoffice login first`);
  return value;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply(405, { error: "POST only" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const given = req.headers.get("x-sync-secret");
  const fromScheduler = !!given && (await admin.rpc("hr_biometric_secret_ok", { p_secret: given })).data === true;
  if (!fromScheduler) {
    const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: { persistSession: false },
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: isHr, error } = await user.rpc("hr_is_admin_or_hr");
    if (error || isHr !== true) return reply(403, { error: "Only HR can run the biometric sync" });
  }

  let window;
  try {
    const body = await req.json().catch(() => ({}));
    window = !fromScheduler && (body.from || body.to) ? dateRangeWindow(body.from, body.to) : recentWindow(Date.now());
  } catch (e) {
    return reply(400, { error: (e as Error).message });
  }

  try {
    const auth = authHeader(
      await requireSecret(admin, "ETIMEOFFICE_CORPORATE_ID"),
      await requireSecret(admin, "ETIMEOFFICE_USERNAME"),
      await requireSecret(admin, "ETIMEOFFICE_PASSWORD"),
    );
    const { punches, bad } = await fetchPunches({ auth, window });
    const { data, error } = await admin.rpc("hr_biometric_ingest", { p_punches: punches });
    if (error) throw new Error(error.message);
    const stats = { ...data, unreadable: bad, from: window.from, to: window.to };
    await admin.rpc("hr_biometric_sync_record", { p_ok: true, p_error: null, p_stats: stats });
    return reply(200, stats);
  } catch (e) {
    const message = (e as Error).message;
    await admin.rpc("hr_biometric_sync_record", { p_ok: false, p_error: message, p_stats: null });
    return reply(502, { error: message });
  }
});
