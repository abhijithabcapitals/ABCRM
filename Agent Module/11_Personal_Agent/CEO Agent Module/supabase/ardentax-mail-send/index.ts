// ardentax-mail-send: sends one ArdentTax document's reviewed draft, when a person clicks Send in the tab.
//   POST { document_id, resend? }  ->  { ok: true, sent_at, warnings } or { error }
// Only people with the ArdentTax tab may call it. Mail goes through the Ardentax mailbox's own SMTP server, with the same
// password store as ceo-mail-reply, and a copy goes to its Sent folder. The sent mark is written with the service role
// only after the mail server accepts the message, so nobody can mark a mail sent without sending it.
// Deploy as "ardentax-mail-send" with JWT verification on. Logs carry no mail text, recipients or passwords.
import { createClient } from "npm:@supabase/supabase-js@2";
import { ImapClient } from "../ceo-mail-sync/imap.ts";
import { SmtpClient } from "../ceo-mail-reply/smtp.ts";
import { buildMail, type MailPart } from "./mime.ts";
import { htmlBody, MAX_ATTACHMENT_BYTES, parseRecipients, sendRefusal, totalAttachmentBytes } from "./rules.ts";

const SENDER = "bharat@ardentaxit.tax";
const SENDER_NAME = "Bharat Bajaj";
const BUCKET = "hub-documents";
const BANNER_PATH = "ArdentTax (ASP)/assets/banner.png";
const BANNER_CID = "ardentax-banner";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const passwordSecretName = (address: string) => `MAIL_PASSWORD_${address.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;

// deno-lint-ignore no-explicit-any
async function mailboxLogin(admin: any, address: string, loginUser?: string | null) {
  const { data: saved } = await admin.rpc("credential_get", { p_name: passwordSecretName(address) });
  if (typeof saved === "string" && saved) return { user: loginUser || address, pass: saved };
  const pass = Deno.env.get(passwordSecretName(address));
  return pass ? { user: loginUser || address, pass } : null;
}

// deno-lint-ignore no-explicit-any
async function download(admin: any, path: string, type: string): Promise<MailPart> {
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error) throw new Error(`Could not read ${path.split("/").pop()}: ${error.message}`);
  return { name: path.split("/").pop()!, type, bytes: new Uint8Array(await data.arrayBuffer()) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const userDb = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
    const { data: { user } } = await userDb.auth.getUser();
    if (!user) return json({ error: "Sign in first." }, 401);
    const { data: allowed } = await userDb.rpc("ardentax_can");
    if (allowed !== true) return json({ error: "No access to the ArdentTax tab." }, 403);

    const { document_id: id, resend } = await req.json();
    if (typeof id !== "string") return json({ error: "A document is needed." }, 400);
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: doc, error: docError } = await admin.from("ardentax_documents").select("*").eq("id", id).maybeSingle();
    if (docError) throw new Error(docError.message);
    if (!doc) return json({ error: "Document not found." }, 404);

    const refusal = sendRefusal(doc, { resend: !!resend });
    if (refusal) return json({ error: refusal }, doc.mail_sent_at && !resend ? 409 : 400);
    let to: string[];
    let cc: string[];
    try { to = parseRecipients(doc.mail_to); cc = parseRecipients(doc.mail_cc); } catch (e) { return json({ error: (e as Error).message }, 400); }

    const { data: settings, error: settingsError } = await admin.from("hub_settings").select("value").eq("key", "ardentax_mail").single();
    if (settingsError) throw new Error(settingsError.message);
    const signature = String(settings.value?.signature_html || "");

    const eb = admin.schema("email_base");
    const { data: mailbox, error: mailboxError } = await eb.from("mailboxes").select("id, address, login_user, smtp_host, smtp_port, imap_host, imap_port").eq("address", SENDER).maybeSingle();
    if (mailboxError) throw new Error(mailboxError.message);
    if (!mailbox?.smtp_host) return json({ error: `The mailbox ${SENDER} is not set up for sending.` }, 400);
    const login = await mailboxLogin(admin, mailbox.address, mailbox.login_user);
    if (!login) return json({ error: `No password is saved for ${SENDER}. Add it in Settings > Email Accounts.` }, 400);

    const attachments = [await download(admin, doc.pdf_path, "application/pdf")];
    if (doc.mail_attach_word && doc.word_path) attachments.push(await download(admin, doc.word_path, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
    if (totalAttachmentBytes(attachments) > MAX_ATTACHMENT_BYTES) return json({ error: "The attachments are too large to send." }, 400);
    const inline = signature.includes(`cid:${BANNER_CID}`) ? [{ ...(await download(admin, BANNER_PATH, "image/png")), cid: BANNER_CID }] : [];

    const { messageId, raw } = buildMail({ from: mailbox.address, fromName: SENDER_NAME, to, cc, subject: doc.mail_subject, text: doc.mail_body || "", html: htmlBody(doc.mail_body || "", signature), inline, attachments });

    try {
      await new SmtpClient(mailbox.smtp_host, mailbox.smtp_port || 465).send(login.user, login.pass, mailbox.address, [...to, ...cc], raw);
    } catch (e) {
      return json({ error: `The mail was not sent: ${(e as Error).message}` }, 502);
    }

    const warnings: string[] = [];
    const { data: sentAt, error: sentError } = await admin.rpc("ardentax_mail_sent", { p_id: doc.id, p_user: user.id });
    if (sentError) warnings.push(`The mail was sent, but the CRM could not record it: ${sentError.message}`);

    const { data: sentFolder } = await eb.from("mailbox_folders").select("name").eq("mailbox_id", mailbox.id).eq("role", "sent").order("name").limit(1).maybeSingle();
    if (sentFolder) {
      const client = new ImapClient(mailbox.imap_host, mailbox.imap_port);
      try {
        await client.connect(login.user, login.pass);
        await client.append(sentFolder.name, raw);
        await client.logout();
      } catch (e) {
        warnings.push(`No copy was saved in ${sentFolder.name}: ${(e as Error).message}`);
      } finally {
        client.close();
      }
    } else {
      warnings.push("No Sent folder is known yet, so no copy was saved there.");
    }
    console.log("ardentax-mail-send", doc.document_number, messageId);
    return json({ ok: true, sent_at: sentAt, warnings });
  } catch (e) {
    console.error("ardentax-mail-send failed", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
