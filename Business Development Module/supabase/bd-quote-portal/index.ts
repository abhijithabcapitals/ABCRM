// Supabase Edge Function "bd-quote-portal": Business Development quotes in the Client Portal (Database Module/migrations/bd/014).
// Kept apart from client-portal so that function's deploy is not touched. It uses the same client sessions (client_portal_session).
// Deploy with --no-verify-jwt (clients are not Supabase Auth users; every action checks its own session), from a folder holding
// supabase/functions/bd-quote-portal/index.ts (this file), supabase/functions/_shared/ (Client Login Module/supabase/_shared) and
// supabase/functions/ceo-mail-reply/smtp.ts, so the relative imports resolve.
//
// Client actions (POST JSON { action, token, ... }):
//   bd_quotes -> { quotes }                          the client's own BD quotes, each with its decision and engagement letter
//   bd_decide { document_id, decision, note? }       Accepted or Rejected on the client's own BD quote; the account comes from the session
//   bd_file { id } -> { url }                        a 5-minute link to the client's own BD quote or letter file
// Staff actions (Authorization: staff JWT; the SQL checks who may):
//   bd_issue_login { lead_id, resend? } -> { ok, emailed, username, client_id }   gives the lead a Client Master record (if it has none) and a
//     portal login with a server-generated password emailed to the lead (never returned or logged). A client with a login gets a notice only.
import { createClient } from "npm:@supabase/supabase-js@2";
import { emailCredentials, emailNotice } from "../_shared/credentialMail.ts";
import { generatePassword, usernameCandidates } from "../_shared/loginSecret.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
class InputError extends Error {}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
// Only the SQL's own refusals (raise exception, P0001) are written for people; anything else is a fault.
const refuse = (error: { code?: string; message: string }) => {
  if (error.code === "P0001") throw new InputError(error.message);
  throw new Error(error.message);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only." }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "bd_issue_login") {
      const auth = req.headers.get("Authorization") || "";
      const staff = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false }, global: { headers: { Authorization: auth } } });
      const { data: who } = await staff.auth.getUser();
      const actor: string | null = who?.user?.id ?? null;
      if (!actor) return json({ error: "Sign in first." }, 401);
      const leadId = String(body.lead_id || "");
      if (!UUID.test(leadId)) throw new InputError("Lead not found.");
      const { data: info, error: okErr } = await staff.rpc("bd_issue_login_ok", { p_lead: leadId });
      if (okErr) {
        if (/permission/i.test(okErr.message)) return json({ error: okErr.message }, 403);
        refuse(okErr);
      }
      const loginMail = async (withPassword: boolean) => {
        const { data, error } = await admin.rpc("business_setup_login_mail", { p_client: info.client_id, p_with_password: withPassword, p_actor: actor });
        if (error) throw new Error(error.message);
        return data;
      };
      const notice = async () => {
        const mail = await loginMail(false);
        const to = String(mail?.email || info.email || "").trim();
        if (!mail || !EMAIL.test(to)) return json({ ok: true, emailed: false, username: mail?.username ?? null, client_id: info.client_id });
        const result = await emailNotice(admin, actor, to, { name: mail.display_name, username: mail.username });
        return json({ ok: true, emailed: result.emailed, username: mail.username, client_id: info.client_id });
      };
      if (body.resend === true) {
        if (!info.has_login) throw new InputError("This client has no active login to send. Issue it first.");
        const mail = await loginMail(true);
        if (!mail?.password) throw new InputError("The password of this login is not stored, so it cannot be sent again. Ask an administrator to reset it.");
        const to = String(mail.email || info.email || "").trim();
        if (!EMAIL.test(to)) throw new InputError("Add the client's email first.");
        const result = await emailCredentials(admin, actor, to, { audience: "client", reset: false, name: mail.display_name, username: mail.username, password: mail.password });
        return json({ ok: true, emailed: result.emailed, username: mail.username, client_id: info.client_id });
      }
      if (info.has_login) return await notice();
      const email = String(info.email || "").trim();
      if (!EMAIL.test(email)) throw new InputError("Add the client's email first.");
      const { data: client } = await admin.from("client_master").select("legal_name").eq("client_id", info.client_id).maybeSingle();
      const password = generatePassword();
      let granted: { created: boolean; username: string; display_name: string; email: string } | null = null;
      for (const username of usernameCandidates(client?.legal_name || "", info.client_id)) {
        const { data, error } = await admin.rpc("business_setup_login_grant", { p_client: info.client_id, p_username: username, p_password: password, p_email: email, p_actor: actor });
        if (error) {
          if (/username is taken/i.test(error.message)) continue;
          refuse(error);
        }
        granted = data;
        break;
      }
      if (!granted) throw new InputError("No free username was found for this client. Please try again.");
      if (!granted.created) return await notice();
      const result = await emailCredentials(admin, actor, granted.email, { audience: "client", reset: false, name: granted.display_name, username: granted.username, password });
      return json({ ok: true, emailed: result.emailed, username: granted.username, client_id: info.client_id });
    }

    // Client actions: a live session, and only that client's rows.
    const { data: accountId } = await admin.rpc("client_portal_session", { p_token: String(body.token || "") });
    if (!accountId) return json({ error: "Please sign in again.", signed_out: true }, 401);
    const { data: terms, error: termsError } = await admin.rpc("client_portal_terms_state", { p_account: accountId });
    if (termsError) throw new Error(termsError.message);
    if (terms?.required) return json({ error: "Please read and agree to the Terms and Conditions first.", terms_required: true }, 403);

    switch (action) {
      case "bd_quotes": {
        const { data, error } = await admin.rpc("bd_portal_quotes", { p_account: accountId });
        if (error) refuse(error);
        return json({ quotes: data || [] });
      }
      case "bd_decide": {
        const documentId = String(body.document_id || "");
        const decision = String(body.decision || "");
        if (!UUID.test(documentId)) throw new InputError("Document not found.");
        if (decision !== "Accepted" && decision !== "Rejected") throw new InputError("Choose Accept or Reject.");
        const note = String(body.note ?? "").trim().slice(0, 1000);
        const { error } = await admin.rpc("bd_portal_decide", { p_account: accountId, p_document: documentId, p_decision: decision, p_note: note || null });
        if (error) refuse(error);
        return json({ ok: true });
      }
      case "bd_file": {
        const id = String(body.id || "");
        if (!UUID.test(id)) throw new InputError("File not found.");
        const { data, error } = await admin.rpc("bd_portal_file", { p_account: accountId, p_id: id });
        if (error) throw new InputError("File not found.");
        const { data: link, error: linkErr } = await admin.storage.from(data.bucket).createSignedUrl(data.path, 300, { download: data.file_name });
        if (linkErr) throw new Error(linkErr.message);
        return json({ url: link.signedUrl });
      }
      default:
        return json({ error: "Unknown action." }, 400);
    }
  } catch (e) {
    if (e instanceof InputError) return json({ error: e.message }, 400);
    console.error("bd-quote-portal", e instanceof Error ? e.message : "error");
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
