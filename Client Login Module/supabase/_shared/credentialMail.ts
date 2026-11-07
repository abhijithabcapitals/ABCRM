// Sends a login email from info@abcapital.ae, through the same mail server as the CEO Inbox.
// No copy goes to the Sent folder: the CRM syncs that mailbox, which would leave the password readable there.
// Paths are as deployed: this file sits in supabase/functions/_shared, next to ceo-mail-reply.
import { buildMessage, SmtpClient } from "../ceo-mail-reply/smtp.ts";
import { type CredentialMail, credentialEmail, type NoticeMail, noticeEmail, type RequestMail, requestEmail } from "./credentialText.ts";

const FROM = "info@abcapital.ae";
const PASSWORD_SECRET = "MAIL_PASSWORD_INFO_ABCAPITAL_AE";

// deno-lint-ignore no-explicit-any
async function sendText(admin: any, to: string, { subject, text }: { subject: string; text: string }) {
  const { data: box } = await admin.schema("email_base").from("mailboxes").select("login_user, smtp_host, smtp_port").eq("address", FROM).maybeSingle();
  const { data: saved } = await admin.rpc("credential_get", { p_name: PASSWORD_SECRET });
  const pass = (typeof saved === "string" && saved) || Deno.env.get(PASSWORD_SECRET);
  if (!box?.smtp_host || !pass) throw new Error(`Sending is not set up for ${FROM}.`);
  const { raw } = buildMessage({ from: FROM, fromName: "AB Capital Services FZE", to: [to], cc: [], subject, text });
  await new SmtpClient(box.smtp_host, box.smtp_port || 465, 20_000).send(box.login_user || FROM, pass, FROM, [to], raw);
}

// deno-lint-ignore no-explicit-any
export async function sendCredentials(admin: any, to: string, mail: CredentialMail) {
  await sendText(admin, to, credentialEmail(mail));
}

// A plain notice to a client who already has a login: it carries the username and no password. Same mailbox, same failure handling as emailCredentials.
// deno-lint-ignore no-explicit-any
export async function emailNotice(admin: any, actor: string | null, to: string, mail: NoticeMail) {
  try {
    await sendText(admin, to, noticeEmail(mail));
    await admin.from("admin_audit").insert({ actor, action: "quote_notice_emailed", target: mail.username, detail: { to } });
    return { emailed: true, email_error: null };
  } catch (e) {
    const reason = String((e as Error)?.message || e).slice(0, 300);
    console.error("notice email", reason);
    await admin.from("admin_audit").insert({ actor, action: "quote_notice_email_failed", target: mail.username, detail: { to, reason } });
    return { emailed: false, email_error: reason };
  }
}

// A client request with its sign-in link. The request already exists when this runs, so a failed email is reported, never thrown.
// The audit row holds no link: the link is a sign-in.
// deno-lint-ignore no-explicit-any
export async function emailRequest(admin: any, actor: string | null, to: string, requestId: string, mail: RequestMail) {
  try {
    await sendText(admin, to, requestEmail(mail));
    await admin.from("admin_audit").insert({ actor, action: "client_request_emailed", target: requestId, detail: { to } });
    return { emailed: true, email_error: null };
  } catch (e) {
    const reason = String((e as Error)?.message || e).split(mail.link).join("[hidden]").slice(0, 300);
    console.error("request email", reason);
    await admin.from("admin_audit").insert({ actor, action: "client_request_email_failed", target: requestId, detail: { to, reason } });
    return { emailed: false, email_error: reason };
  }
}

// The login already exists when this runs, so a failed email is reported, never thrown. The audit row holds no password.
// deno-lint-ignore no-explicit-any
export async function emailCredentials(admin: any, actor: string | null, to: string, mail: CredentialMail) {
  try {
    await sendCredentials(admin, to, mail);
    await admin.from("admin_audit").insert({ actor, action: "credentials_emailed", target: mail.username, detail: { to, audience: mail.audience, reset: mail.reset } });
    return { emailed: true, email_error: null };
  } catch (e) {
    const reason = String((e as Error)?.message || e).split(mail.password).join("[hidden]").slice(0, 300);
    console.error("credential email", reason);
    await admin.from("admin_audit").insert({ actor, action: "credentials_email_failed", target: mail.username, detail: { to, audience: mail.audience, reason } });
    return { emailed: false, email_error: reason };
  }
}
