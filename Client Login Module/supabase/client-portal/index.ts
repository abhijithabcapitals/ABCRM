// Supabase Edge Function "client-portal": the only way into the Client Portal.
// Deploy (not before migrations 001 and 002 are applied), from a temporary workdir holding
// supabase/functions/client-portal/index.ts (a copy of this file):
//   supabase functions deploy client-portal --no-verify-jwt --project-ref pnnakrhfzyxudjaghoxx --use-api
// --no-verify-jwt because clients are not Supabase Auth users; every action checks its own session.
// Client uploads are untrusted: they stay in a private bucket and leave only as short-lived download links.
//
// Client actions (POST JSON { action, token, ... }):
//   login { username, password }, logout, me
//   upload_start { file_name, size, doc_type, note? } -> { id, upload_url }
//   upload_start { for_form: true, ... } files the upload under this login's own Business Setup form
//   upload_start { for_claim: true, file_name, size } -> { id, upload_url }   a proof of payment: PDF, JPG or PNG up to 10 MB, kept as this login's own upload
//   upload_done { id }, doc_url { id }
//   setup_view -> the client's own Business Setup records: form, services, quotes, letters, payments, invoices, claims, documents. Each quote and letter carries
//     its decision, and whether it can still be decided; each invoice says whether a payment claim can be made. Never a staff name, a staff note, a reason or an
//     override: the only staff words a client reads are the note on a refused signed copy and the note on a refused payment claim.
//   form_get, form_save { answers }, form_submit, setup_file { kind, id }
//   setup_decide { document_id, decision, note? }   Accepted or Rejected on the client's own quote or letter; the account comes from the session
//   setup_payment_claim { invoice_id, amount, paid_on, reference?, proof_id? } -> { id }   "I have paid" on the client's own invoice; the account comes from the
//     session, never the body. proof_id is the id of a finished upload_start { for_claim: true } upload of this login. The claim changes no balance: staff confirm
//     it (a payment and a receipt) or refuse it with a note, and the client sees the claim's status (and the refusal note, only when Refused) in setup_view.
//   submit_change { field, value } -> { id }       asks staff to change one company detail
//   gallery_url { source, id } -> { url }          source is kyc or generated; link lasts 120 seconds
// Staff actions (Authorization: staff JWT; the SQL checks who may):
//   admin_preview { account_id }   admins and setup.portal.manage, read-only copy of what the client sees
//   admin_grant_access { banking_client_id, client_master_id, username, password, email, reset }   admins only: saves the login, mails the password
//   staff_url { id, filed? }, staff_review { id, status, note? }
//   staff_signed_url { id }                                        setup.quotes.manage: a link to open a signed quote copy
//   setup_issue_login { case_id, resend? } -> { ok, emailed, username }   setup.leads.manage, with the case's quote issued: makes the client's login with a
//     server-generated password and emails it (never returned or logged); a client who has a login gets a notice email only; resend: true emails the stored
//     login again without changing it. emailed: false keeps the login.
//
// Deploy: supabase functions deploy client-portal --no-verify-jwt --project-ref pnnakrhfzyxudjaghoxx --use-api

import { createClient } from "npm:@supabase/supabase-js@2";
import { emailCredentials, emailNotice } from "../_shared/credentialMail.ts";
import { generatePassword, usernameCandidates } from "../_shared/loginSecret.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

class InputError extends Error {}

const BUCKET = "client-portal";
const GALLERY_BUCKET = "banking-documents";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_CLAIM_PROOF_BYTES = 10 * 1024 * 1024;
const CLAIM_PROOF_EXT = ["pdf", "jpg", "jpeg", "png"];
const MAX_UPLOADS_PER_DAY = 100;
const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const DOC_TYPES = ["Trade Licence", "MOA / AOA", "Passport / ID", "Bank Statement", "Invoice", "VAT Document", "Corporate Tax Document", "Other"];
const FORM_DOC_TYPES = ["Passport", "Emirates visa", "Emirates ID", "Ejari", "Bank statement", "Utility bill", "Old visa", "Old Emirates ID", "Other"];
const SETUP_FILE_KINDS = ["quote", "letter", "receipt", "output", "invoice"];
const MIME: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", tif: "image/tiff", tiff: "image/tiff",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv", txt: "text/plain", eml: "message/rfc822", msg: "application/vnd.ms-outlook",
};

const storageSafe = (s: string) => s.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "").slice(-120) || "file";
const displayName = (s: string) => s.replace(/[\x00-\x1f<>:"/\\|?*]+/g, "-").trim().slice(0, 200);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only." }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const signed = async (path: string, name: string, bucket = BUCKET) => {
    const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, 120, { download: name });
    if (error) throw new Error(error.message);
    return data.signedUrl;
  };
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "login") {
      const { data, error } = await admin.rpc("client_portal_login", { p_username: String(body.username || "").slice(0, 100), p_password: String(body.password || "").slice(0, 200) });
      if (error) throw new Error(error.message);
      if (!data?.ok) return json({ error: "Wrong username or password, or too many attempts. Try again in 15 minutes, or contact AB Capital Services FZE." }, 401);
      return json({ token: data.token });
    }

    if (action === "admin_preview" || action === "admin_grant_access" || action === "staff_url" || action === "staff_review" || action === "staff_signed_url" || action === "setup_issue_login") {
      // Runs as the signed-in staff member, so the SQL's auth.uid() checks apply.
      const staff = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        auth: { persistSession: false }, global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
      });
      if (action === "admin_grant_access") {
        const { data: isAdmin } = await staff.rpc("client_portal_is_admin");
        if (isAdmin !== true) return json({ error: "Admins only." }, 403);
        const password = String(body.password || "").slice(0, 200);
        const { data: granted, error } = await staff.rpc("client_portal_admin_grant", {
          p_banking_client_id: body.banking_client_id || null, p_client_master_id: body.client_master_id || null,
          p_username: String(body.username || "").slice(0, 100), p_password: password, p_email: String(body.email || "").slice(0, 300),
        });
        if (error) {
          if (error.code === "P0001") throw new InputError(error.message);
          throw new Error(error.message);
        }
        const sent = await emailCredentials(admin, granted.actor, granted.email, { audience: "client", reset: !!body.reset, name: granted.display_name, username: granted.username, password });
        return json({ ok: true, email: granted.email, ...sent });
      }
      if (action === "admin_preview") {
        const { data: isAdmin } = await staff.rpc("client_portal_is_admin");
        const { data: canSetup } = await staff.rpc("business_setup_can", { p_permission: "setup.portal.manage" });
        if (isAdmin !== true && canSetup !== true) return json({ error: "You do not have permission to preview this." }, 403);
        const previewAccount = String(body.account_id || "");
        const { data, error } = await admin.rpc("client_portal_me", { p_account: previewAccount });
        if (error) throw new Error(error.message);
        const { data: setup, error: setupErr } = await admin.rpc("business_setup_portal_view", { p_account: previewAccount });
        if (setupErr) throw new Error(setupErr.message);
        return json({ ...data, setup });
      }
      if (action === "staff_signed_url") {
        // The SQL checks the right (setup.quotes.manage) and says where the file is; a legacy row has none.
        const { data: file, error: fileErr } = await staff.rpc("business_setup_signed_file", { p_id: String(body.id || "") });
        if (fileErr) return json({ error: fileErr.message }, 403);
        return json({ url: await signed(file.path, file.file_name) });
      }
      if (action === "setup_issue_login") {
        // The SQL checks the right (setup.leads.manage) and that the case has an issued quote; it says whether the client has an active login and where to write.
        const caseId = String(body.case_id || "");
        if (!UUID.test(caseId)) throw new InputError("Case not found.");
        const { data: info, error: okErr } = await staff.rpc("business_setup_issue_login_ok", { p_case: caseId });
        if (okErr) {
          if (/permission/i.test(okErr.message)) return json({ error: okErr.message }, 403);
          if (okErr.code === "P0001") throw new InputError(okErr.message);
          throw new Error(okErr.message);
        }
        const { data: who } = await staff.auth.getUser();
        const actor: string | null = who?.user?.id ?? null;
        const loginMail = async (withPassword: boolean) => {
          const { data, error } = await admin.rpc("business_setup_login_mail", { p_client: info.client_id, p_with_password: withPassword, p_actor: actor });
          if (error) throw new Error(error.message);
          return data;
        };
        const notice = async () => {
          const mail = await loginMail(false);
          const to = String(mail?.email || info.email || "").trim();
          if (!mail || !EMAIL.test(to)) return json({ ok: true, emailed: false, username: mail?.username ?? null });
          const result = await emailNotice(admin, actor, to, { name: mail.display_name, username: mail.username });
          return json({ ok: true, emailed: result.emailed, username: mail.username });
        };
        if (body.resend === true) {
          if (!info.has_login) throw new InputError("This client has no active login to send. Issue it first.");
          const mail = await loginMail(true);
          if (!mail?.password) throw new InputError("The password of this login is not stored, so it cannot be sent again. Ask an administrator to reset it.");
          const to = String(mail.email || info.email || "").trim();
          if (!EMAIL.test(to)) throw new InputError("Add the client's email in Client Master first.");
          const result = await emailCredentials(admin, actor, to, { audience: "client", reset: false, name: mail.display_name, username: mail.username, password: mail.password });
          return json({ ok: true, emailed: result.emailed, username: mail.username });
        }
        if (info.has_login) return await notice();
        const email = String(info.email || "").trim();
        if (!EMAIL.test(email)) throw new InputError("Add the client's email in Client Master first.");
        const { data: client } = await admin.from("client_master").select("legal_name").eq("client_id", info.client_id).maybeSingle();
        const password = generatePassword();
        let granted: { created: boolean; username: string; display_name: string; email: string } | null = null;
        for (const username of usernameCandidates(client?.legal_name || "", info.client_id)) {
          const { data, error } = await admin.rpc("business_setup_login_grant", { p_client: info.client_id, p_username: username, p_password: password, p_email: email, p_actor: actor });
          if (error) {
            if (/username is taken/i.test(error.message)) continue;
            if (error.code === "P0001") throw new InputError(error.message);
            throw new Error(error.message);
          }
          granted = data;
          break;
        }
        if (!granted) throw new InputError("No free username was found for this client. Please try again.");
        // Someone issued the login between the check and the save: nothing changed, so the client gets the notice only.
        if (!granted.created) return await notice();
        const result = await emailCredentials(admin, actor, granted.email, { audience: "client", reset: false, name: granted.display_name, username: granted.username, password });
        return json({ ok: true, emailed: result.emailed, username: granted.username });
      }
      const { data: doc, error: docErr } = await staff.rpc("client_inputs_file", { p_id: String(body.id || "") });
      if (docErr) return json({ error: docErr.message }, 403);
      if (action === "staff_url") {
        const path = body.filed ? doc.filed_path : doc.storage_path;
        if (!path) throw new InputError("This document has not been filed.");
        return json({ url: await signed(path, doc.file_name) });
      }
      if (!doc.can_review) return json({ error: "Assign this document to yourself first." }, 403);
      const status = String(body.status || "");
      const note = String(body.note || "").trim().slice(0, 1000);
      if (status !== "validated" && status !== "rejected") throw new InputError("Unknown decision.");
      if (status === "rejected" && !note) throw new InputError("Tell the client why it was rejected.");
      if (doc.status !== "in_review") throw new InputError("This document has already been decided.");
      let filed: string | null = null;
      if (status === "validated") {
        filed = `filed/${storageSafe(doc.client)}/${storageSafe(doc.doc_type)}/${doc.id.slice(0, 8)}-${storageSafe(doc.file_name)}`;
        const { error } = await admin.storage.from(BUCKET).copy(doc.storage_path, filed);
        if (error && !/exists/i.test(error.message)) throw new Error(`Could not file the document: ${error.message}`);
      }
      const { error: finishErr } = await admin.rpc("client_inputs_finish", { p_actor: doc.actor, p_id: doc.id, p_status: status, p_note: note, p_filed_path: filed });
      if (finishErr) throw new InputError(finishErr.message);
      return json({ ok: true, filed_path: filed });
    }

    // Everything below needs a live client session, and only ever touches that client's rows.
    const token = String(body.token || "");
    const { data: accountId } = await admin.rpc("client_portal_session", { p_token: token });
    if (!accountId) return json({ error: "Please sign in again.", signed_out: true }, 401);

    const ownDoc = async () => {
      const { data } = await admin.from("client_portal_documents").select("*").eq("id", String(body.id || "")).eq("account_id", accountId).maybeSingle();
      if (!data) throw new InputError("Document not found.");
      return data;
    };

    switch (action) {
      case "me": {
        const { data, error } = await admin.rpc("client_portal_me", { p_account: accountId });
        if (error) throw new Error(error.message);
        return json(data);
      }
      case "logout":
        await admin.rpc("client_portal_logout", { p_token: token });
        return json({ ok: true });
      case "upload_start": {
        const name = displayName(String(body.file_name || ""));
        const ext = name.split(".").pop()?.toLowerCase() || "";
        if (!name || !MIME[ext]) throw new InputError("Upload a PDF, image, Word, Excel, CSV, text or email file.");
        const size = Number(body.size);
        const forClaim = body.for_claim === true;
        if (forClaim) {
          // A proof of payment: PDF, JPG or PNG, 10 MB. It is the login's own upload, named by the claim afterwards.
          if (!CLAIM_PROOF_EXT.includes(ext)) throw new InputError("Upload the proof of payment as a PDF, JPG or PNG file.");
          if (!Number.isFinite(size) || size <= 0 || size > MAX_CLAIM_PROOF_BYTES) throw new InputError("The proof of payment must be under 10 MB.");
        } else if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) throw new InputError("Files must be under 25 MB.");
        const docType = forClaim ? "Payment proof" : String(body.doc_type || "");
        let formId: string | null = null;
        if (forClaim) {
          // Nothing more to check: the claim itself checks the invoice and the proof.
        } else if (body.for_form) {
          const { data: form, error: formErr } = await admin.rpc("business_setup_form_get", { p_account: accountId });
          if (formErr) throw new Error(formErr.message);
          if (!form || !["Draft", "Returned"].includes(form.status)) throw new InputError("This form cannot take new documents now.");
          if (!FORM_DOC_TYPES.includes(docType)) throw new InputError("Choose the document type.");
          formId = form.id;
        } else if (!DOC_TYPES.includes(docType)) throw new InputError("Choose the document type.");
        const since = new Date(Date.now() - 86400000).toISOString();
        const { count } = await admin.from("client_portal_documents").select("id", { count: "exact", head: true }).eq("account_id", accountId).gte("uploaded_at", since);
        if ((count || 0) >= MAX_UPLOADS_PER_DAY) throw new InputError("Upload limit reached for today. Please try again tomorrow.");
        const id = crypto.randomUUID();
        const path = `incoming/${accountId}/${id}/${storageSafe(name)}`;
        const { data: up, error: upErr } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
        if (upErr) throw new Error(upErr.message);
        const { error } = await admin.from("client_portal_documents").insert({
          id, account_id: accountId, doc_type: docType, note: String(body.note || "").trim().slice(0, 500) || null,
          file_name: name, mime: MIME[ext], storage_path: path, form_id: formId,
        });
        if (error) throw new Error(error.message);
        return json({ id, upload_url: up.signedUrl, mime: MIME[ext] });
      }
      case "upload_done": {
        const doc = await ownDoc();
        const folder = doc.storage_path.slice(0, doc.storage_path.lastIndexOf("/"));
        const { data: files } = await admin.storage.from(BUCKET).list(folder);
        const file = files?.[0];
        if (!file) throw new InputError("The upload did not finish. Please try again.");
        const { error } = await admin.from("client_portal_documents").update({ upload_complete: true, size_bytes: file.metadata?.size ?? null, uploaded_at: new Date().toISOString() }).eq("id", doc.id);
        if (error) throw new Error(error.message);
        return json({ ok: true });
      }
      case "doc_url": {
        const doc = await ownDoc();
        if (!doc.upload_complete) throw new InputError("Document not found.");
        return json({ url: await signed(doc.storage_path, doc.file_name) });
      }
      case "setup_view": {
        const { data, error } = await admin.rpc("business_setup_portal_view", { p_account: accountId });
        if (error) throw new Error(error.message);
        return json(data);
      }
      case "form_get": {
        const { data, error } = await admin.rpc("business_setup_form_get", { p_account: accountId });
        if (error) throw new Error(error.message);
        return json(data);
      }
      case "form_save": {
        const answers = body.answers;
        if (!answers || typeof answers !== "object" || Array.isArray(answers) || JSON.stringify(answers).length > 50000) throw new InputError("The form answers are not valid.");
        const { data, error } = await admin.rpc("business_setup_form_save", { p_account: accountId, p_answers: answers });
        if (error) throw new InputError(error.message);
        return json(data);
      }
      case "form_submit": {
        const { data, error } = await admin.rpc("business_setup_form_submit", { p_account: accountId });
        if (error) throw new InputError(error.message);
        return json(data);
      }
      case "setup_file": {
        const kind = String(body.kind || "");
        if (!SETUP_FILE_KINDS.includes(kind)) throw new InputError("File not found.");
        const { data, error } = await admin.rpc("business_setup_portal_file", { p_account: accountId, p_kind: kind, p_id: String(body.id || "") });
        if (error) throw new InputError("File not found.");
        const { data: link, error: linkErr } = await admin.storage.from(data.bucket).createSignedUrl(data.path, 300, { download: data.file_name });
        if (linkErr) throw new Error(linkErr.message);
        return json({ url: link.signedUrl });
      }
      case "submit_change": {
        const { data, error } = await admin.rpc("client_change_submit", { p_account: accountId, p_field: String(body.field || "").slice(0, 60), p_value: String(body.value ?? "").slice(0, 600) });
        // Only the SQL's own refusals (raise exception, P0001) are written for clients; anything else is a fault.
        if (error) {
          if (error.code === "P0001") throw new InputError(error.message);
          throw new Error(error.message);
        }
        return json({ id: data });
      }
      case "setup_decide": {
        const documentId = String(body.document_id || "");
        const decision = String(body.decision || "");
        if (!UUID.test(documentId)) throw new InputError("Document not found.");
        if (decision !== "Accepted" && decision !== "Rejected") throw new InputError("Choose Accept or Reject.");
        const note = String(body.note ?? "").trim().slice(0, 1000);
        // The account is the one of the live session. The database works out the client and refuses a document that is not theirs.
        const { error } = await admin.rpc("business_setup_portal_decide", { p_account: accountId, p_document: documentId, p_decision: decision, p_note: note || null });
        if (error) {
          if (error.code === "P0001") throw new InputError(error.message);
          throw new Error(error.message);
        }
        return json({ ok: true });
      }
      case "setup_payment_claim": {
        const invoiceId = String(body.invoice_id || "");
        if (!UUID.test(invoiceId)) throw new InputError("Invoice not found.");
        let proofPath: string | null = null;
        if (body.proof_id) {
          // A malformed id is the client's mistake, answered in one sentence (the database would otherwise raise a 500).
          if (!UUID.test(String(body.proof_id))) throw new InputError("The proof of payment did not finish uploading. Please upload it again.");
          // The proof must be an upload of this very login that finished (ownDoc reads body.id, so the lookup is made here).
          const { data: proof } = await admin.from("client_portal_documents").select("storage_path, upload_complete")
            .eq("id", String(body.proof_id)).eq("account_id", accountId).eq("doc_type", "Payment proof").maybeSingle();
          if (!proof || !proof.upload_complete) throw new InputError("The proof of payment did not finish uploading. Please upload it again.");
          proofPath = proof.storage_path;
        }
        // The account is the one of the live session; the database works out the client and refuses an invoice that is not theirs.
        const { data, error } = await admin.rpc("business_setup_portal_claim_add", {
          p_account: accountId,
          p: { invoice_id: invoiceId, amount: body.amount, paid_on: body.paid_on, reference: String(body.reference ?? "").trim().slice(0, 200) || null, proof_path: proofPath },
        });
        if (error) {
          if (error.code === "P0001") throw new InputError(error.message);
          throw new Error(error.message);
        }
        return json({ id: data });
      }
      case "gallery_url": {
        const source = String(body.source || "");
        const id = String(body.id || "");
        if ((source !== "kyc" && source !== "generated") || !UUID.test(id)) throw new InputError("Document not found.");
        const { data, error } = await admin.rpc("client_portal_gallery_path", { p_account: accountId, p_source: source, p_id: id });
        if (error) throw new Error(error.message);
        if (!data?.storage_path) throw new InputError("Document not found.");
        return json({ url: await signed(data.storage_path, data.file_name || "document", GALLERY_BUCKET) });
      }
      default:
        return json({ error: "Unknown action." }, 400);
    }
  } catch (e) {
    if (e instanceof InputError) return json({ error: e.message }, 400);
    console.error("client-portal", e instanceof Error ? e.message : "error");
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
