// proposal-mail-send: mails one proposal's PDF, and only the PDF, when a person clicks Send in the Proposal screen.
//   POST { document_id, resend? }  ->  { ok: true, sent_at, warnings } or { error }
// The caller must pass hub_proposal_can_send under their own JWT. Subject and body come from the proposal's child mail
// draft; the recipient is the proposal's contact_email. Mail goes through info@abcapital.ae's own SMTP server with the same
// password store as ardentax-mail-send, and a copy goes to its Sent folder. The sent mark is written with the service role
// only after the mail server accepts the message. No signature is added: no AB Capital signature setting exists yet.
// Deploy as "proposal-mail-send" with JWT verification on. Logs carry no mail text, recipients or passwords.
import { createClient } from "npm:@supabase/supabase-js@2";
import { ImapClient } from "../ceo-mail-sync/imap.ts";
import { SmtpClient } from "../ceo-mail-reply/smtp.ts";
import { buildMail } from "../ardentax-mail-send/mime.ts";
import { chooseLogin, htmlBody, MAX_ATTACHMENT_BYTES, parseRecipients, totalAttachmentBytes } from "../ardentax-mail-send/rules.ts";
import { attachmentsFor, claimFilter, PROPOSAL_TEMPLATE, refusal } from "./rules.ts";

const SENDER = "info@abcapital.ae";
const SENDER_NAME = "AB Capital Services FZE";
const BUCKET = "hub-documents";

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
  return chooseLogin({ saved, named: Deno.env.get(passwordSecretName(address)), legacyUser: Deno.env.get("MAIL_IMAP_USER"), legacyPass: Deno.env.get("MAIL_IMAP_PASSWORD") }, address, loginUser);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const userDb = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
    const { data: { user } } = await userDb.auth.getUser();
    if (!user) return json({ error: "Sign in first." }, 401);
    const { data: allowed } = await userDb.rpc("hub_proposal_can_send");
    if (allowed !== true) return json({ error: "No permission to send proposals." }, 403);

    const { document_id: id, resend } = await req.json();
    if (typeof id !== "string") return json({ error: "A document is needed." }, 400);
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: doc, error: docError } = await admin.from("hub_documents").select("id, document_number, library_template, storage_path, word_path, contact_email, mail_sent_at").eq("id", id).eq("library_template", PROPOSAL_TEMPLATE).maybeSingle();
    if (docError) throw new Error(docError.message);
    if (!doc) return json({ error: "Proposal not found." }, 404);
    const { data: draft, error: draftError } = await admin.from("hub_documents").select("mail_subject, mail_body").eq("parent_id", id).eq("doc_type", "mail").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (draftError) throw new Error(draftError.message);

    const full = { ...doc, mail_subject: draft?.mail_subject };
    const refused = refusal(full, { resend: !!resend });
    if (refused) return json({ error: refused }, doc.mail_sent_at && !resend ? 409 : 400);
    const to = parseRecipients(doc.contact_email);

    const eb = admin.schema("email_base");
    const { data: mailbox, error: mailboxError } = await eb.from("mailboxes").select("id, address, login_user, smtp_host, smtp_port, imap_host, imap_port").eq("address", SENDER).maybeSingle();
    if (mailboxError) throw new Error(mailboxError.message);
    if (!mailbox?.smtp_host) return json({ error: `The mailbox ${SENDER} is not set up for sending.` }, 400);
    const login = await mailboxLogin(admin, mailbox.address, mailbox.login_user);
    if (!login) return json({ error: `No password is saved for ${SENDER}. Add it in Settings > Email Accounts.` }, 400);

    const attachments = [];
    for (const path of attachmentsFor(full)) {
      const { data, error } = await admin.storage.from(BUCKET).download(path);
      if (error) throw new Error(`Could not read ${path.split("/").pop()}: ${error.message}`);
      attachments.push({ name: path.split("/").pop()!, type: "application/pdf", bytes: new Uint8Array(await data.arrayBuffer()) });
    }
    if (totalAttachmentBytes(attachments) > MAX_ATTACHMENT_BYTES) return json({ error: "The PDF is too large to send." }, 400);

    const body = draft?.mail_body || "";
    const { messageId, raw } = buildMail({ from: mailbox.address, fromName: SENDER_NAME, to, cc: [], subject: draft!.mail_subject, text: body, html: htmlBody(body, ""), inline: [], attachments });

    // Claim the send atomically, so a double click cannot mail twice. Everything that can fail has already run.
    const { staleBefore, requireUnsent } = claimFilter(new Date(), { resend: !!resend });
    let claim = admin.from("hub_documents").update({ mail_sending_at: new Date().toISOString() }).eq("id", doc.id)
      .or(`mail_sending_at.is.null,mail_sending_at.lt.${staleBefore}`);
    if (requireUnsent) claim = claim.is("mail_sent_at", null);
    const { data: claimed, error: claimError } = await claim.select("id");
    if (claimError) throw new Error(claimError.message);
    if (!claimed?.length) return json({ error: "This proposal is already being sent, or was sent. Refresh and check." }, 409);

    try {
      await new SmtpClient(mailbox.smtp_host, mailbox.smtp_port || 465).send(login.user, login.pass, mailbox.address, to, raw);
    } catch (e) {
      await admin.from("hub_documents").update({ mail_sending_at: null }).eq("id", doc.id);
      return json({ error: `The mail was not sent: ${(e as Error).message}` }, 502);
    }

    const warnings: string[] = [];
    const sentAt = new Date().toISOString();
    const { error: sentError } = await admin.from("hub_documents").update({ mail_sent_at: sentAt, mail_sent_by: user.id, mail_sent_to: to.join(", "), mail_sending_at: null }).eq("id", doc.id);
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
    console.log("proposal-mail-send", doc.document_number, messageId);
    return json({ ok: true, sent_at: sentAt, warnings });
  } catch (e) {
    console.error("proposal-mail-send failed", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
