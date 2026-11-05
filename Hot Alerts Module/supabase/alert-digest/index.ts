// alert-digest: mails open alerts to staff. Staff only, never clients.
//   POST { kind: "Digest" | "Critical" } with header x-alert-secret  ->  { sent, failed }
// Sends nothing unless alert_settings.email_enabled is true and the mode is Triage or Live: alert_email_build returns nothing otherwise.
// Deploy as "alert-digest" with JWT verification off, and set secret ALERT_DIGEST_SECRET. Logs carry no names, addresses or alert text.
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildMessage, SmtpClient } from "../../../Agent Module/11_Personal_Agent/CEO Agent Module/supabase/ceo-mail-reply/smtp.ts";
import { chooseLogin } from "../../../Agent Module/11_Personal_Agent/CEO Agent Module/supabase/ardentax-mail-send/rules.ts";
import { type DigestAlert, digestSubject, digestText, passwordSecretName, secretMatches } from "./rules.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  if (!secretMatches(req.headers.get("x-alert-secret"), Deno.env.get("ALERT_DIGEST_SECRET"))) return json({ error: "Not allowed." }, 401);
  try {
    const { kind } = await req.json();
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: people, error } = await admin.rpc("alert_email_build", { p_kind: kind });
    if (error) throw new Error(error.message);
    if (!people?.length) return json({ sent: 0, failed: 0 });

    const { data: setting } = await admin.from("alert_settings").select("value").eq("key", "email_sender").single();
    const sender = String(setting?.value || "");
    const { data: mailbox, error: mailboxError } = await admin.schema("email_base").from("mailboxes")
      .select("address, login_user, smtp_host, smtp_port, display_name").eq("address", sender).maybeSingle();
    if (mailboxError) throw new Error(mailboxError.message);
    if (!mailbox?.smtp_host) return json({ error: "The sender mailbox is not set up for sending." }, 400);
    const { data: saved } = await admin.rpc("credential_get", { p_name: passwordSecretName(mailbox.address) });
    const login = chooseLogin({ saved, named: Deno.env.get(passwordSecretName(mailbox.address)) }, mailbox.address, mailbox.login_user);
    if (!login) return json({ error: "No password is saved for the sender mailbox." }, 400);

    let sent = 0, failed = 0;
    for (const person of people as { user_id: string; name: string | null; email: string; alerts: DigestAlert[] }[]) {
      let status = "Sent", detail: string | null = null;
      try {
        const { raw } = buildMessage({
          from: mailbox.address, fromName: mailbox.display_name, to: [person.email], cc: [],
          subject: digestSubject(kind, person.alerts.length), text: digestText(person.name, person.alerts),
        });
        await new SmtpClient(mailbox.smtp_host, mailbox.smtp_port || 465).send(login.user, login.pass, mailbox.address, [person.email], raw);
        sent++;
      } catch (e) {
        status = "Failed";
        detail = (e as Error).message;
        failed++;
      }
      const { error: recordError } = await admin.rpc("alert_email_record", {
        p_items: person.alerts.map((a) => ({ alert_id: a.id, user_id: person.user_id, kind, status, error: detail })),
      });
      if (recordError) console.error("alert-digest: could not record a delivery");
    }
    console.log(`alert-digest ${kind}: sent ${sent}, failed ${failed}`);
    return json({ sent, failed });
  } catch (e) {
    console.error("alert-digest failed", (e as Error).name);
    return json({ error: (e as Error).message }, 500);
  }
});
