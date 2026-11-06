// Supabase Edge Function "setup-intake": the public side of the referral link. Anyone holding a link can reach it, so it does only three things for them,
// and the database checks each one. Nothing here reads a file back or returns another submission.
// Deploy: supabase functions deploy setup-intake --no-verify-jwt --remote=pnnakrhfzyxudjaghoxx --use-api --yes
// --no-verify-jwt because a client filling the form has no login. The token in the request is what is checked.
//
// Public actions (POST JSON { action, token, ... }):
//   open { token } -> { version, definition, terms }
//   upload_start { token, submission_id, kind, filename, size } -> { upload_url, mime }
//   submit { token, submission_id, answers, terms_id, website } -> { ok }     website is a trap: a person never fills it, so a filled one is dropped
// Staff action (Authorization: staff JWT; the SQL checks who may):
//   spam { case_id, reason }   closes a lead from a link and deletes its stored files
import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET = "client-portal";
const MAX_BODY_BYTES = 200_000;
const MIME: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", tif: "image/tiff", tiff: "image/tiff" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

// The address is kept only as a hash, so limits work with no IP address stored. The service key is the salt: it is secret and always present here.
async function ipHash(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  if (!ip) return null;
  const bytes = new TextEncoder().encode(`${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}|${ip}`);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// A refusal from the database is one plain sentence meant for the person. Anything else stays in the log.
const fail = (error: { code?: string; message: string }) => {
  if (error.code === "P0001") return json({ error: error.message }, 400);
  console.error("setup-intake", error.code);
  return json({ error: "Something went wrong. Please try again." }, 500);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Not found." }, 404);
  const size = Number(req.headers.get("content-length") || 0);
  if (size > MAX_BODY_BYTES) return json({ error: "This form is too large to send." }, 413);
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "This form is too large to send." }, 413);
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return json({ error: "Please reload the page and try again." }, 400); }
  const action = String(body.action || "");
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  try {
    if (action === "spam") {
      const staff = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        auth: { persistSession: false }, global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
      });
      const { data: paths, error } = await staff.rpc("business_setup_case_spam", { p_case: String(body.case_id || ""), p_reason: String(body.reason || "").slice(0, 500) });
      if (error) return fail(error);
      if ((paths || []).length) await admin.storage.from(BUCKET).remove(paths);
      return json({ ok: true });
    }

    const token = String(body.token || "").slice(0, 100);
    if (action === "open") {
      const { data, error } = await admin.rpc("business_setup_intake_open", { p_token: token });
      if (error) return fail(error);
      // Starts with no submission, older than a week: gone, so unsent passports do not stay in storage. A failure here must not stop the form.
      const old = await admin.rpc("business_setup_intake_cleanup");
      if (!old.error && (old.data || []).length) await admin.storage.from(BUCKET).remove(old.data);
      return json(data);
    }

    const submission = String(body.submission_id || "");
    if (!UUID.test(submission)) return json({ error: "Please reload the page and try again." }, 400);

    if (action === "upload_start") {
      const filename = String(body.filename || "").slice(0, 200);
      const { data: path, error } = await admin.rpc("business_setup_intake_upload_ok", {
        p_token: token, p_submission: submission, p_kind: String(body.kind || ""), p_filename: filename, p_size: Number(body.size || 0),
      });
      if (error) return fail(error);
      const { data: up, error: upErr } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
      if (upErr) throw new Error(upErr.message);
      const ext = filename.split(".").pop()?.toLowerCase() || "";
      return json({ upload_url: up.signedUrl, mime: MIME[ext] || "application/octet-stream" });
    }

    if (action === "submit") {
      if (String(body.website || "")) return json({ ok: true });   // the trap: looks accepted, and nothing is stored
      const termsId = body.terms_id ? String(body.terms_id) : null;
      if (termsId && !UUID.test(termsId)) return json({ error: "Please reload the page and try again." }, 400);
      const { error } = await admin.rpc("business_setup_intake_submit", {
        p_token: token, p_submission: submission, p_answers: body.answers ?? {}, p_ip_hash: await ipHash(req), p_terms: termsId,
      });
      if (error) return fail(error);
      return json({ ok: true });
    }
    return json({ error: "Not found." }, 404);
  } catch (e) {
    console.error("setup-intake", e instanceof Error ? e.message : "error");
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
