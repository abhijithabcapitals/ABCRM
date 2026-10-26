// Supabase Edge Function — send queued automation emails via Resend.
// Drains automation_email_queue: resolves each recipient's email, sends via
// Resend, and marks the row sent/error. Invoked periodically by pg_cron
// (see db/phase4_email_cron.sql). The Resend key lives in Supabase secrets —
// never in the browser.
//
// Deploy: Supabase Dashboard → Edge Functions → create "send-automation-emails"
//         → paste this → Deploy.
// Secrets (Edge Functions → Manage secrets):
//   RESEND_API_KEY   - from resend.com
//   FROM_EMAIL       - e.g. "AB Capital <notifications@send.abcapital.ae>"
//   EMAIL_WEBHOOK_SECRET - secret the cron sends in the x-webhook-secret header
//                          (distinct from the lead-ingest function's WEBHOOK_SECRET,
//                           since Edge Function secrets are shared project-wide)
//   (SUPABASE_URL is provided automatically. SERVICE_SECRET_KEY = a new secret
//    API key (sb_secret_…); falls back to the injected SUPABASE_SERVICE_ROLE_KEY
//    until you disable legacy JWT keys.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

const APP_URL = "https://ab-capital-crm-dashboard.vercel.app";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // Only the scheduled caller (with the shared secret) may drain the queue.
    if (req.headers.get("x-webhook-secret") !== Deno.env.get("EMAIL_WEBHOOK_SECRET")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("FROM_EMAIL") || "AB Capital <onboarding@resend.dev>";
    if (!resendKey) return json({ error: "RESEND_API_KEY not set" }, 500);

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SERVICE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Pull a batch of pending emails.
    const { data: pending, error: qErr } = await db
      .from("automation_email_queue")
      .select("id, user_id, task_id, subject, body")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(50);
    if (qErr) return json({ error: qErr.message }, 500);
    if (!pending || pending.length === 0) return json({ ok: true, sent: 0, message: "queue empty" });

    // Resolve recipient emails in one query.
    const userIds = [...new Set(pending.map((r) => r.user_id).filter(Boolean))];
    const { data: profiles } = await db.from("profiles").select("id, email, full_name").in("id", userIds);
    const emailById = new Map((profiles || []).map((p) => [p.id, { email: p.email, name: p.full_name }]));

    let sent = 0, failed = 0;
    for (const row of pending) {
      const prof = emailById.get(row.user_id);
      if (!prof?.email) {
        await db.from("automation_email_queue")
          .update({ status: "error", error: "no email for recipient" }).eq("id", row.id);
        failed++;
        continue;
      }
      const html =
        `<div style="font-family:system-ui,Arial,sans-serif;font-size:14px;color:#111;line-height:1.5">` +
        `<p>${escapeHtml(row.body || "")}</p>` +
        (row.task_id
          ? `<p style="margin-top:16px"><a href="${APP_URL}" style="color:#1d4ed8">Open in AB Capital CRM</a></p>`
          : "") +
        `</div>`;

      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [prof.email],
          subject: row.subject || "AB Capital notification",
          text: row.body || "",
          html,
        }),
      });
      if (resp.ok) {
        await db.from("automation_email_queue")
          .update({ status: "sent", sent_at: new Date().toISOString(), error: null }).eq("id", row.id);
        sent++;
      } else {
        const msg = await resp.text();
        await db.from("automation_email_queue")
          .update({ status: "error", error: `${resp.status}: ${msg}`.slice(0, 500) }).eq("id", row.id);
        failed++;
      }
    }
    return json({ ok: true, sent, failed, processed: pending.length });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
