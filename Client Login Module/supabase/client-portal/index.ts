// Supabase Edge Function "client-portal": the only way into the Client Portal.
// Deploy (not before migrations 001 and 002 are applied), from a temporary workdir holding
// supabase/functions/client-portal/index.ts (a copy of this file):
//   supabase functions deploy client-portal --no-verify-jwt --project-ref pnnakrhfzyxudjaghoxx --use-api
// --no-verify-jwt because clients are not Supabase Auth users; every action checks its own session.
// Client uploads are untrusted: they stay in a private bucket and leave only as short-lived download links.
//
// Client actions (POST JSON { action, token, ... }):
//   login { username, password }, logout, me, change_password { current, next }
//   upload_start { file_name, size, doc_type, note? } -> { id, upload_url }
//   upload_done { id }, doc_url { id }
//   submit_change { field, value } -> { id }       asks staff to change one company detail
//   gallery_url { source, id } -> { url }          source is kyc or generated; link lasts 120 seconds
// Staff actions (Authorization: staff JWT; the SQL checks who may):
//   admin_preview { account_id }   admins only, read-only copy of what the client sees
//   staff_url { id, filed? }, staff_review { id, status, note? }
//
// Deploy: supabase functions deploy client-portal --no-verify-jwt --project-ref pnnakrhfzyxudjaghoxx --use-api

import { createClient } from "npm:@supabase/supabase-js@2";

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
const MAX_UPLOADS_PER_DAY = 100;
const DOC_TYPES = ["Trade Licence", "MOA / AOA", "Passport / ID", "Bank Statement", "Invoice", "VAT Document", "Corporate Tax Document", "Other"];
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
      if (!data?.ok) return json({ error: "Wrong username or password, or too many attempts. Try again in 15 minutes, or contact AB Capital." }, 401);
      return json({ token: data.token });
    }

    if (action === "admin_preview" || action === "staff_url" || action === "staff_review") {
      // Runs as the signed-in staff member, so the SQL's auth.uid() checks apply.
      const staff = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        auth: { persistSession: false }, global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
      });
      if (action === "admin_preview") {
        const { data: ok } = await staff.rpc("client_portal_is_admin");
        if (ok !== true) return json({ error: "Admins only." }, 403);
        const { data, error } = await admin.rpc("client_portal_me", { p_account: String(body.account_id || "") });
        if (error) throw new Error(error.message);
        return json(data);
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
      case "change_password": {
        if (String(body.next || "").length < 10) throw new InputError("The new password needs at least 10 characters.");
        const { data } = await admin.rpc("client_portal_change_password", { p_token: token, p_current: String(body.current || "").slice(0, 200), p_new: String(body.next).slice(0, 200) });
        if (data !== true) throw new InputError("Your current password is not correct.");
        return json({ ok: true });
      }
      case "upload_start": {
        const name = displayName(String(body.file_name || ""));
        const ext = name.split(".").pop()?.toLowerCase() || "";
        if (!name || !MIME[ext]) throw new InputError("Upload a PDF, image, Word, Excel, CSV, text or email file.");
        const size = Number(body.size);
        if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) throw new InputError("Files must be under 25 MB.");
        const docType = String(body.doc_type || "");
        if (!DOC_TYPES.includes(docType)) throw new InputError("Choose the document type.");
        const since = new Date(Date.now() - 86400000).toISOString();
        const { count } = await admin.from("client_portal_documents").select("id", { count: "exact", head: true }).eq("account_id", accountId).gte("uploaded_at", since);
        if ((count || 0) >= MAX_UPLOADS_PER_DAY) throw new InputError("Upload limit reached for today. Please try again tomorrow.");
        const id = crypto.randomUUID();
        const path = `incoming/${accountId}/${id}/${storageSafe(name)}`;
        const { data: up, error: upErr } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
        if (upErr) throw new Error(upErr.message);
        const { error } = await admin.from("client_portal_documents").insert({
          id, account_id: accountId, doc_type: docType, note: String(body.note || "").trim().slice(0, 500) || null,
          file_name: name, mime: MIME[ext], storage_path: path,
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
      case "submit_change": {
        const { data, error } = await admin.rpc("client_change_submit", { p_account: accountId, p_field: String(body.field || "").slice(0, 60), p_value: String(body.value ?? "").slice(0, 600) });
        // Only the SQL's own refusals (raise exception, P0001) are written for clients; anything else is a fault.
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
