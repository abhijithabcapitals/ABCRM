// Supabase Edge Function "messenger-files": short-lived links for chat files in a private Cloudflare R2 bucket.
// Membership is decided by the database, using the caller's own login. Storage keys and secrets stay here.
//
// Actions (POST JSON { action, ... }, signed-in staff):
//   upload_start { conversation_id, name, size }                    returns { key, url } for a PUT, valid 5 minutes
//   send_file { conversation_id, message_id, key, name, type, parent_id }   measures the stored file, then sends the message
//   download { attachment_id }                                      returns { url }, valid 5 minutes
//
// Secrets: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET. See docs/files-setup.md.
// Deploy with this folder's files together:
//   supabase functions deploy messenger-files --project-ref pnnakrhfzyxudjaghoxx --use-api

import { createClient } from "npm:@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1";
import { attachmentHeader, type Deps, handle, Refused } from "./handlers.ts";

const LINK_SECONDS = 300;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { ...cors, "Content-Type": "application/json" } });

function makeStorage(): Deps["storage"] {
  const account = Deno.env.get("R2_ACCOUNT_ID");
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY");
  const bucket = Deno.env.get("R2_BUCKET");
  if (!account || !accessKeyId || !secretAccessKey || !bucket) return null;
  const r2 = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
  const address = (key: string) => {
    const url = new URL(`https://${account}.r2.cloudflarestorage.com/${bucket}/${key}`);
    url.searchParams.set("X-Amz-Expires", String(LINK_SECONDS));
    return url;
  };
  const presign = async (url: URL, method: string) => (await r2.sign(new Request(url, { method }), { aws: { signQuery: true } })).url;
  return {
    putLink: (key) => presign(address(key), "PUT"),
    getLink: (key, fileName) => {
      const url = address(key);
      url.searchParams.set("response-content-disposition", attachmentHeader(fileName));
      return presign(url, "GET");
    },
    sizeOf: async (key) => {
      const res = await r2.fetch(`https://${account}.r2.cloudflarestorage.com/${bucket}/${key}`, { method: "HEAD" });
      await res.body?.cancel();
      return res.ok ? Number(res.headers.get("content-length")) : null;
    },
    remove: async (key) => {
      const res = await r2.fetch(`https://${account}.r2.cloudflarestorage.com/${bucket}/${key}`, { method: "DELETE" });
      await res.body?.cancel();
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" });
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  try {
    const body = await req.json();
    return json(await handle(body, {
      rpc: async (fn, args) => {
        const { data, error } = await client.rpc(fn, args);
        return { data, error };
      },
      storage: makeStorage(),
      newId: () => crypto.randomUUID(),
    }));
  } catch (e) {
    if (e instanceof Refused) return json({ error: e.message });
    console.error("messenger-files failed", e);
    return json({ error: "File sharing is not available right now." });
  }
});
