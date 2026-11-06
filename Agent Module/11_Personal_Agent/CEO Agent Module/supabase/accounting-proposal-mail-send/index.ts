// accounting-proposal-mail-send: mails one Accounting quote or approved agreement, with only its PDF attached.
//   POST { document_id, resend?, from?, signature_id? }  ->  { ok: true, sent_at, warnings } or { error }
// The caller must pass hub_acct_can_send(document_id). Subject and body come from the document's child 'mail' draft and the
// recipient from the document's contact email. Mail goes through the accounts mailbox's own SMTP server, with the same
// password store as ardentax-mail-send, and a copy goes to its Sent folder. The sent mark is written with the service role
// only after the mail server accepts the message, so nobody can mark a mail sent without sending it.
// From is info@abcapital.ae (any staff) or a mailbox the caller owns (read with the caller's own login, so row-level security decides).
// signature_id names a shared signature from public.email_signatures, read with the caller's login; its text follows the draft and its logo goes under it.
// Deploy as "accounting-proposal-mail-send" with JWT verification on. Logs carry no mail text, recipients or passwords.
import { createClient } from "npm:@supabase/supabase-js@2";
import { ImapClient } from "../ceo-mail-sync/imap.ts";
import { SmtpClient } from "../ceo-mail-reply/smtp.ts";
import { buildMail } from "../ardentax-mail-send/mime.ts";
import { chooseLogin, htmlBody, MAX_ATTACHMENT_BYTES, parseRecipients } from "../ardentax-mail-send/rules.ts";
import { attachmentFileName, attachmentsFor, CLAIM_REFUSED, chooseSender, claimRule, composeText, DEFAULT_SENDER, refusal, senderName, signatureFits, signatureHtml } from "./rules.ts";

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

    const { document_id: id, resend, from, signature_id: signatureId } = await req.json();
    if (typeof id !== "string") return json({ error: "A document is needed." }, 400);
    const { data: allowed } = await userDb.rpc("hub_acct_can_send", { p_id: id });
    if (allowed !== true) return json({ error: "You cannot mail this document. It needs a PDF, and an agreement needs its approval." }, 403);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: doc, error: docError } = await admin.from("hub_documents").select("*").eq("id", id).maybeSingle();
    if (docError) throw new Error(docError.message);
    if (!doc) return json({ error: "Document not found." }, 404);
    const { data: draft, error: draftError } = await admin.from("hub_documents").select("mail_subject, mail_body").eq("parent_id", id).eq("doc_type", "mail").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (draftError) throw new Error(draftError.message);

    const full = { ...doc, mail_subject: draft?.mail_subject };
    const refused = refusal(full, { resend: !!resend });
    if (refused) return json({ error: refused }, doc.mail_sent_at && !resend ? 409 : 400);
    const to = parseRecipients(doc.contact_email);

    // Who the mail comes from and which signature it carries, checked before anything is claimed.
    const MAILBOX_COLUMNS = "id, address, display_name, login_user, smtp_host, smtp_port, imap_host, imap_port";
    const wanted = typeof from === "string" ? from.trim().toLowerCase() : from;
    let mailbox;
    if (wanted === undefined || wanted === null || wanted === "" || wanted === DEFAULT_SENDER) {
      const { data, error } = await admin.schema("email_base").from("mailboxes").select(MAILBOX_COLUMNS).eq("address", DEFAULT_SENDER).maybeSingle();
      if (error) throw new Error(error.message);
      mailbox = data;
    } else {
      const own = typeof wanted === "string" ? await userDb.schema("email_base").from("mailboxes").select(MAILBOX_COLUMNS).eq("address", wanted).maybeSingle() : { data: null, error: null };
      if (own.error) throw new Error(own.error.message);
      mailbox = own.data;
    }
    const sender = chooseSender({ from: wanted, owned: !!mailbox });
    if ("error" in sender) return json({ error: sender.error }, sender.status);
    if (!mailbox?.smtp_host) return json({ error: `The mailbox ${sender.address} is not set up for sending.` }, 400);
    let signature = null;
    if (signatureId !== undefined && signatureId !== null && signatureId !== "") {
      if (typeof signatureId !== "string") return json({ error: "The signature is not valid." }, 400);
      const { data, error } = await userDb.from("email_signatures").select("id, body_text, logo_url, sender_mailbox_address").eq("id", signatureId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return json({ error: "Signature not found." }, 404);
      if (!signatureFits(data, sender.address)) return json({ error: `This signature sends from ${data.sender_mailbox_address}, not from ${sender.address}.` }, 400);
      signature = data;
    }

    // Claim the row before sending; no row back means another send holds it or it was just sent.
    const claimedAt = new Date();
    const rule = claimRule(claimedAt, { resend: !!resend }, doc);
    if (!rule.storagePath) return json({ error: CLAIM_REFUSED }, 409);
    let claim = admin.from("hub_documents").update({ mail_claimed_at: claimedAt.toISOString() }).eq("id", doc.id).or(`mail_claimed_at.is.null,mail_claimed_at.lt.${rule.staleBefore}`)
      .eq("storage_path", rule.storagePath);
    if (rule.requireApproved) claim = claim.not("approved_at", "is", null);
    if (rule.requireUnsent) claim = claim.is("mail_sent_at", null);
    const { data: claimed, error: claimError } = await claim.select("id");
    if (claimError) throw new Error(claimError.message);
    if (!claimed?.length) return json({ error: CLAIM_REFUSED }, 409);
    let released = false; // the success update clears the claim itself
    try {
      const eb = admin.schema("email_base");
      const login = await mailboxLogin(admin, mailbox.address, mailbox.login_user);
      if (!login) return json({ error: `No password is saved for ${mailbox.address}. Add it in Settings > Email Accounts.` }, 400);

      const [path] = attachmentsFor(doc);
      const { data: file, error: fileError } = await admin.storage.from(BUCKET).download(path);
      if (fileError) throw new Error(`Could not read the PDF: ${fileError.message}`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length > MAX_ATTACHMENT_BYTES) return json({ error: "The PDF is too large to send." }, 400);

      const body = composeText(draft?.mail_body || "", signature);
      const { messageId, raw } = buildMail({
        from: mailbox.address, fromName: senderName(mailbox), to, cc: [], subject: draft!.mail_subject, text: body, html: htmlBody(body, signatureHtml(signature)), inline: [],
        attachments: [{ name: attachmentFileName(doc), type: "application/pdf", bytes }],
      });

      try {
        await new SmtpClient(mailbox.smtp_host, mailbox.smtp_port || 465).send(login.user, login.pass, mailbox.address, to, raw);
      } catch (e) {
        return json({ error: `The mail was not sent: ${(e as Error).message}` }, 502);
      }

      const warnings: string[] = [];
      const sentAt = new Date().toISOString();
      const { error: sentError } = await admin.from("hub_documents").update({ mail_sent_at: sentAt, mail_sent_by: user.id, mail_sent_to: doc.contact_email, mail_sent_from: mailbox.address, mail_claimed_at: null }).eq("id", doc.id);
      if (sentError) warnings.push(`The mail was sent, but the CRM could not record it: ${sentError.message}`);
      else released = true;

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
      console.log("accounting-proposal-mail-send", doc.document_number, messageId);
      return json({ ok: true, sent_at: sentAt, warnings });
    } finally {
      // Every failure path gives the claim back, but only our own claim, never one taken over after it went stale.
      if (!released) await admin.from("hub_documents").update({ mail_claimed_at: null }).eq("id", doc.id).eq("mail_claimed_at", claimedAt.toISOString());
    }
  } catch (e) {
    console.error("accounting-proposal-mail-send failed", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
