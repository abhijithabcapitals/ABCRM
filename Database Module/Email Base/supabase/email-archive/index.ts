// email-archive: copies files from the Supabase Storage bucket `email-base` to a SharePoint
// document library through Microsoft Graph, verifies each copy, records its driveItem id and web
// URL in email_base.archive_items, and only then (when archive_settings.delete_after_verify is on)
// removes the file from Supabase Storage.
//
// Called every 3 minutes by cron job `email-base-archive` with header x-archive-secret.
// Auth to Microsoft: app-only, certificate client assertion, Graph permission Sites.Selected with
// a `write` grant on the archive site only. See Database Module/Email Base/ARCHIVE.md.
//
// Secrets: ARCHIVE_SECRET, MS_TENANT_ID, MS_CLIENT_ID, MS_CERT_THUMBPRINT, MS_CERT_PRIVATE_KEY
// (PKCS#8 PEM), plus the standard SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  assertionParts,
  chunkRanges,
  encodeDrivePath,
  importSigningKey,
  isRetryable,
  type RemoteItem,
  retryDelayMs,
  sharePointPath,
  SIMPLE_UPLOAD_MAX,
  signAssertion,
  thumbprintToX5t,
  tokenUrl,
  verifyCopy,
} from "./archive.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";
const BUCKET = "email-base";
const RUN_BUDGET_MS = 120_000; // stop taking new files after this; the wall limit is 150 s
const env = (name: string) => {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing secret ${name}`);
  return v;
};

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
  db: { schema: "email_base" },
});

// ---------- Microsoft Graph ----------

let token: { value: string; expires: number } | null = null;

async function graphToken(): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const tenantId = env("MS_TENANT_ID");
  const clientId = env("MS_CLIENT_ID");
  const key = await importSigningKey(env("MS_CERT_PRIVATE_KEY"));
  const assertion = await signAssertion(key, assertionParts({
    tenantId,
    clientId,
    x5t: thumbprintToX5t(env("MS_CERT_THUMBPRINT")),
    nowSec: Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID(),
  }));
  const res = await fetch(tokenUrl(tenantId), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: assertion,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`Microsoft sign-in failed (${res.status}): ${body.error ?? ""} ${String(body.error_description ?? "").split("\n")[0]}`);
  }
  token = { value: body.access_token, expires: Date.now() + Number(body.expires_in ?? 3000) * 1000 };
  return token.value;
}

// One Graph request with Retry-After handling. `url` is either a Graph path or, for upload
// session chunks, the absolute uploadUrl (which must not carry the bearer token).
async function graph(method: string, url: string, init: { body?: BodyInit; headers?: Record<string, string>; auth?: boolean } = {}): Promise<Response> {
  const absolute = url.startsWith("https://");
  if (absolute && !/^https:\/\/[a-z0-9.-]+\.(sharepoint\.com|microsoft\.com|live\.com)\//i.test(url)) {
    throw new Error("upload URL is not a Microsoft host");
  }
  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (init.auth !== false) headers.Authorization = `Bearer ${await graphToken()}`;
    const res = await fetch(absolute ? url : `${GRAPH}${url}`, { method, headers, body: init.body });
    if (res.status === 401 && attempt === 0 && init.auth !== false) {
      token = null;
      continue;
    }
    if (isRetryable(res.status) && attempt < 4) {
      await res.body?.cancel();
      await new Promise((r) => setTimeout(r, retryDelayMs(res.headers.get("Retry-After"), attempt, Date.now())));
      continue;
    }
    return res;
  }
}

async function graphJson(method: string, url: string, init: Parameters<typeof graph>[2] = {}): Promise<any> {
  const res = await graph(method, url, init);
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`Graph ${method} ${res.status}: ${body?.error?.code ?? ""} ${body?.error?.message ?? ""}`.trim());
  return body;
}

const ITEM_SELECT = "$select=id,webUrl,size,file";

async function upload(driveId: string, path: string, bytes: Uint8Array<ArrayBuffer>): Promise<RemoteItem> {
  const target = `/drives/${encodeURIComponent(driveId)}/root:/${encodeDrivePath(path)}:`;
  if (bytes.length <= SIMPLE_UPLOAD_MAX) {
    return await graphJson("PUT", `${target}/content?@microsoft.graph.conflictBehavior=replace&${ITEM_SELECT}`, {
      body: bytes,
      headers: { "Content-Type": "application/octet-stream" },
    });
  }
  const session = await graphJson("POST", `${target}/createUploadSession`, {
    body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }),
    headers: { "Content-Type": "application/json" },
  });
  let last: any = null;
  for (const [start, end] of chunkRanges(bytes.length)) {
    const res = await graph("PUT", session.uploadUrl, {
      auth: false,
      body: bytes.slice(start, end + 1),
      headers: { "Content-Range": `bytes ${start}-${end}/${bytes.length}` },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`upload chunk ${start}-${end} failed (${res.status}): ${text.slice(0, 200)}`);
    last = text ? JSON.parse(text) : null;
  }
  // The final chunk returns the driveItem; read it again with the fields we need.
  if (!last?.id) throw new Error("upload session finished without an item");
  return await graphJson("GET", `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(last.id)}?${ITEM_SELECT}`);
}

// ---------- settings ----------

interface Settings {
  enabled: boolean;
  site_ref: string | null;
  site_id: string | null;
  drive_id: string | null;
  root_folder: string;
  batch_size: number;
  concurrency: number;
  verify_mode: "hash" | "size";
  delete_after_verify: boolean;
  delete_batch_size: number;
}

async function resolveDrive(s: Settings): Promise<string> {
  if (s.drive_id) return s.drive_id;
  let site: { id: string };
  if (s.site_id) site = { id: s.site_id };
  else if (s.site_ref) {
    site = await graphJson("GET", `/sites/${s.site_ref.split("/").map((p) => (p.endsWith(":") ? p : encodeURIComponent(p))).join("/")}?$select=id,webUrl`);
  } else throw new Error("set archive_settings.site_ref (e.g. 'abcapital.sharepoint.com:/sites/MailArchive') or site_id");
  const drive = await graphJson("GET", `/sites/${encodeURIComponent(site.id)}/drive?$select=id,webUrl`);
  const { error } = await db.from("archive_settings").update({ site_id: site.id, drive_id: drive.id, updated_at: new Date().toISOString() }).eq("id", true);
  if (error) throw new Error(`saving drive id: ${error.message}`);
  return drive.id;
}

// ---------- the run ----------

interface Item {
  storage_path: string;
  mailbox_id: string | null;
  size_bytes: number;
}

async function copyOne(item: Item, s: Settings, driveId: string, mailboxNames: Map<string, string>): Promise<"verified" | "failed"> {
  const spPath = sharePointPath(s.root_folder, item.storage_path, item.mailbox_id ? mailboxNames.get(item.mailbox_id) : undefined);
  try {
    const { data, error } = await db.storage.from(BUCKET).download(item.storage_path);
    if (error || !data) throw new Error(`Storage download: ${error?.message ?? "no data"}`);
    const bytes = new Uint8Array(await data.arrayBuffer());
    const remote = await upload(driveId, spPath, bytes);
    const problem = verifyCopy(s.verify_mode, bytes, Number(item.size_bytes), remote);
    if (problem) throw new Error(`verify: ${problem}`);
    const { error: upErr } = await db.from("archive_items").update({
      status: "verified",
      sharepoint_path: spPath,
      drive_item_id: remote.id,
      web_url: remote.webUrl ?? null,
      remote_size: remote.size,
      quickxor_hash: remote.file?.hashes?.quickXorHash ?? null,
      verified_by: s.verify_mode,
      verified_at: new Date().toISOString(),
      last_error: null,
      claimed_until: null,
      updated_at: new Date().toISOString(),
    }).eq("storage_path", item.storage_path);
    if (upErr) throw new Error(`recording copy: ${upErr.message}`);
    return "verified";
  } catch (e) {
    await db.from("archive_items").update({
      status: "failed",
      sharepoint_path: spPath,
      last_error: String((e as Error).message ?? e).slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq("storage_path", item.storage_path);
    return "failed";
  }
}

async function deleteVerified(s: Settings, deadline: number): Promise<number> {
  let removed = 0;
  while (Date.now() < deadline) {
    const { data, error } = await db.rpc("archive_delete_candidates", { p_limit: s.delete_batch_size });
    if (error) throw new Error(`delete candidates: ${error.message}`);
    const paths = (data ?? []).map((r: { storage_path: string }) => r.storage_path);
    if (paths.length === 0) break;
    for (let i = 0; i < paths.length; i += 100) {
      const part = paths.slice(i, i + 100);
      const { error: rmErr } = await db.storage.from(BUCKET).remove(part);
      if (rmErr) throw new Error(`Storage remove: ${rmErr.message}`);
      const { data: n, error: mkErr } = await db.rpc("archive_mark_deleted", { p_paths: part });
      if (mkErr) throw new Error(`mark deleted: ${mkErr.message}`);
      removed += Number(n ?? 0);
    }
  }
  return removed;
}

async function run(): Promise<Record<string, unknown>> {
  const started = Date.now();
  const deadline = started + RUN_BUDGET_MS;
  const { data: s, error } = await db.from("archive_settings").select("*").eq("id", true).single<Settings>();
  if (error || !s) throw new Error(`settings: ${error?.message ?? "missing row"}`);
  if (!s.enabled) return { skipped: "archive_settings.enabled is false" };

  const { data: added, error: enqErr } = await db.rpc("archive_enqueue");
  if (enqErr) throw new Error(`enqueue: ${enqErr.message}`);

  const driveId = await resolveDrive(s);
  const { data: boxes } = await db.from("mailboxes").select("id,address");
  const mailboxNames = new Map<string, string>((boxes ?? []).map((b: { id: string; address: string }) => [b.id, b.address]));

  let verified = 0;
  let failed = 0;
  while (Date.now() < deadline) {
    const { data: batch, error: claimErr } = await db.rpc("archive_claim", { p_limit: s.batch_size });
    if (claimErr) throw new Error(`claim: ${claimErr.message}`);
    const items = (batch ?? []) as Item[];
    if (items.length === 0) break;
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const item = items[next++];
        if (Date.now() > deadline) {
          // Release the claim so the next run takes it at once.
          await db.from("archive_items").update({ claimed_until: null }).eq("storage_path", item.storage_path);
          continue;
        }
        if ((await copyOne(item, s, driveId, mailboxNames)) === "verified") verified++;
        else failed++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(s.concurrency, items.length) }, worker));
  }

  const deleted = s.delete_after_verify ? await deleteVerified(s, started + 140_000) : 0;
  return { added, verified, failed, deleted, ms: Date.now() - started };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const secret = Deno.env.get("ARCHIVE_SECRET");
  if (!secret || req.headers.get("x-archive-secret") !== secret) return new Response("forbidden", { status: 403 });
  let result: Record<string, unknown>;
  let status = 200;
  try {
    result = await run();
  } catch (e) {
    result = { error: String((e as Error).message ?? e).slice(0, 500) };
    status = 500;
  }
  await db.from("archive_settings").update({ last_run_at: new Date().toISOString(), last_run_result: result }).eq("id", true);
  return new Response(JSON.stringify(result), { status, headers: { "Content-Type": "application/json" } });
});
