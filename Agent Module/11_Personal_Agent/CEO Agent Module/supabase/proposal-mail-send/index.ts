// proposal-mail-send: mails one proposal's PDF, and only the PDF, when a person clicks Send in the Proposal screen.
//   POST { document_id, resend?, signed? }  ->  { ok: true, sent_at, signed, warnings } or { error }
// Signing is optional. signed: true attaches the PDF of the proposal's live signature (document_signatures, read with the service
// role after hub_proposal_can_send, path checked under Business Setup/<id>/signed/), refuses when there is none, and checks again
// after the claim that it is still live. false or missing attaches the unsigned PDF as before.
// The caller must pass hub_proposal_can_send under their own JWT. Subject and body come from the proposal's child mail
// draft; the recipient is the proposal's contact_email. Mail goes through info@abcapital.ae's own SMTP server with the same
// password store as ardentax-mail-send, and a copy goes to its Sent folder. The sent mark is written with the service role
// only after the mail server accepts the message. No mail signature is added: no AB Capital signature setting exists yet, so the
// draft's marked closing stays; the closing mark itself is never sent and the plain part has no *bold* asterisks.
// Deploy as "proposal-mail-send" with JWT verification on. Logs carry no mail text, recipients or passwords.
import { createClient } from "npm:@supabase/supabase-js@2";
import { ImapClient } from "../ceo-mail-sync/imap.ts";
import { SmtpClient } from "../ceo-mail-reply/smtp.ts";
import { buildMail } from "../ardentax-mail-send/mime.ts";
import { chooseLogin, MAX_ATTACHMENT_BYTES, parseRecipients } from "../ardentax-mail-send/rules.ts";
import { attachmentChoice, attachmentName, claimFilter, mailBodies, NOT_SIGNED, parseSigned, PROPOSAL_TEMPLATE, refusal, sentNotRecorded } from "./rules.ts";

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

    const { document_id: id, resend, signed: signedFlag } = await req.json();
    if (typeof id !== "string") return json({ error: "A document is needed." }, 400);
    const signed = parseSigned(signedFlag);
    if (typeof signed !== "boolean") return json({ error: signed.error }, 400);
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: doc, error: docError } = await admin.from("hub_documents").select("id, document_number, library_template, status, storage_path, word_path, contact_email, mail_sent_at").eq("id", id).eq("library_template", PROPOSAL_TEMPLATE).maybeSingle();
    if (docError) throw new Error(docError.message);
    if (!doc) return json({ error: "Proposal not found." }, 404);
    const { data: draft, error: draftError } = await admin.from("hub_documents").select("mail_subject, mail_body").eq("parent_id", id).eq("doc_type", "mail").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (draftError) throw new Error(draftError.message);

    const full = { ...doc, mail_subject: draft?.mail_subject };
    const refused = refusal(full, { resend: !!resend });
    if (refused) return json({ error: refused }, doc.mail_sent_at && !resend ? 409 : 400);
    const to = parseRecipients(doc.contact_email);

    // The signed copy, when asked for: the live signature, read with the service role only now that the caller may send proposals.
    let live = null;
    if (signed) {
      const { data, error } = await admin.from("document_signatures").select("id, source_table, source_id, pdf_path, superseded_at")
        .eq("source_table", "hub_documents").eq("source_id", doc.id).is("superseded_at", null).maybeSingle();
      if (error) throw new Error(error.message);
      live = data;
    }
    const choice = attachmentChoice(full, signed, live);
    if ("error" in choice) return json({ error: choice.error }, 409);

    const eb = admin.schema("email_base");
    const { data: mailbox, error: mailboxError } = await eb.from("mailboxes").select("id, address, login_user, smtp_host, smtp_port, imap_host, imap_port").eq("address", SENDER).maybeSingle();
    if (mailboxError) throw new Error(mailboxError.message);
    if (!mailbox?.smtp_host) return json({ error: `The mailbox ${SENDER} is not set up for sending.` }, 400);
    const login = await mailboxLogin(admin, mailbox.address, mailbox.login_user);
    if (!login) return json({ error: `No password is saved for ${SENDER}. Add it in Settings > Email Accounts.` }, 400);

    const { data: file, error: fileError } = await admin.storage.from(BUCKET).download(choice.path);
    if (fileError) throw new Error(`Could not read ${choice.path.split("/").pop()}: ${fileError.message}`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > MAX_ATTACHMENT_BYTES) return json({ error: "The PDF is too large to send." }, 400);
    const attachments = [{ name: attachmentName(doc.document_number), type: "application/pdf", bytes }];

    const { text, html } = mailBodies(draft?.mail_body || "");
    const { messageId, raw } = buildMail({ from: mailbox.address, fromName: SENDER_NAME, to, cc: [], subject: draft!.mail_subject, text, html, inline: [], attachments });

    // Claim the send atomically, so a double click cannot mail twice. Everything that can fail has already run.
    // mail_claimed_at is Template Hub 008's claim column, shared with the Accounting send; each send claims only its own rows.
    // The row must still hold the PDF that was read: new files in between refuse instead of sending stale ones.
    const claimedAt = new Date();
    const { staleBefore, requireUnsent, storagePath } = claimFilter(claimedAt, { resend: !!resend }, doc);
    if (!storagePath) return json({ error: "This proposal has no PDF yet. Generate it first." }, 409);
    let claim = admin.from("hub_documents").update({ mail_claimed_at: claimedAt.toISOString() }).eq("id", doc.id)
      .or(`mail_claimed_at.is.null,mail_claimed_at.lt.${staleBefore}`).eq("storage_path", storagePath);
    if (requireUnsent) claim = claim.is("mail_sent_at", null);
    const { data: claimed, error: claimError } = await claim.select("id");
    if (claimError) throw new Error(claimError.message);
    if (!claimed?.length) return json({ error: "This proposal is already being sent, or was sent. Refresh and check." }, 409);
    let released = false; // true once the mail server accepted the message: the claim is then kept, and the sent mark clears it

    const warnings: string[] = [];
    let sentAt: string;
    let notRecorded: string | null = null;
    try {
      // New files or a withdrawal between the read and the claim end the signature: then nothing is sent.
      if (choice.signatureId) {
        const { data: still, error: stillError } = await admin.from("document_signatures").select("id").eq("id", choice.signatureId).is("superseded_at", null).maybeSingle();
        if (stillError) throw new Error(stillError.message);
        if (!still) return json({ error: NOT_SIGNED }, 409);
      }
      try {
        await new SmtpClient(mailbox.smtp_host, mailbox.smtp_port || 465).send(login.user, login.pass, mailbox.address, to, raw);
      } catch (e) {
        return json({ error: `The mail was not sent: ${(e as Error).message}` }, 502);
      }
      // The mail is out: from here the claim is never given back, so a failed sent mark cannot lead to a second copy.
      released = true;
      sentAt = new Date().toISOString();
      const { error: sentError } = await admin.from("hub_documents").update({ mail_sent_at: sentAt, mail_sent_by: user.id, mail_sent_to: to.join(", "), mail_claimed_at: null }).eq("id", doc.id);
      if (sentError) notRecorded = sentNotRecorded(sentError.message);
    } finally {
      // Every failure before the mail server accepted the message gives the claim back, but only our own claim, never one taken over after it went stale.
      if (!released) await admin.from("hub_documents").update({ mail_claimed_at: null }).eq("id", doc.id).eq("mail_claimed_at", claimedAt.toISOString());
    }

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
    if (notRecorded) return json({ error: notRecorded, sent: true, warnings }, 500);
    return json({ ok: true, sent_at: sentAt, signed: !!choice.signatureId, warnings });
  } catch (e) {
    console.error("proposal-mail-send failed", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
