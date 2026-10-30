// Supabase Edge Function "bd-lead-sources": pulls prospects from lead-generation
// platforms into public.bd_platform_prospects for the Business Development tab.
// First provider: Explee (https://api.explee.com/public/api/docs).
//
// Actions (POST JSON body { action, provider, ... }):
//   status   -> connection settings, whether the key is set, balance, projects, campaigns
//   settings -> save { project_id } (BD managers only, enforced by row-level security)
//   sync     -> pull hot leads since the last sync (and, with include_contacted, campaign leads)
//
// The provider key is read from the Edge Function secret EXPLEE_API_KEY and never
// sent to the browser. Database access uses the caller's JWT, so the BD role
// policies decide who may read prospects or change settings.
//
// Deploy as "bd-lead-sources" with JWT verification on.

import { createClient } from "npm:@supabase/supabase-js@2";

const EXPLEE_BASE = "https://api.explee.com/public/api/v1";
const MAX_HOT_PAGES = 10;       // 200 per page
const CONTACTED_PER_CAMPAIGN = 1000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

class ProviderError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function explee(key: string, path: string, params: Record<string, string | number | undefined> = {}) {
  const url = new URL(EXPLEE_BASE + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { "X-API-Key": key, Accept: "application/json" }, signal: AbortSignal.timeout(60000) });
  // deno-lint-ignore no-explicit-any
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof body?.detail === "string" ? body.detail : body?.message || body?.error || `HTTP ${res.status}`;
    const hint = res.status === 401 ? `Explee rejected the EXPLEE_API_KEY secret (${detail}). Copy the key again from explee.com/app-auto-gtm/api-keys and paste only the key.`
      : res.status === 402 ? "The Explee account has no credit left."
      : res.status === 403 ? `Your Explee plan does not allow this (${detail}).`
      : res.status === 429 ? "Explee rate limit reached. Try again shortly."
      : `Explee error: ${detail}`;
    throw new ProviderError(res.status, hint);
  }
  return body;
}

const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

// deno-lint-ignore no-explicit-any
function hotRow(l: any, campaigns: Map<string, string>) {
  const cid = l.campaign_id != null ? String(l.campaign_id) : null;
  return {
    provider: "explee",
    external_id: String(l.person_id),
    kind: "hot",
    external_campaign_id: cid,
    campaign_name: cid ? campaigns.get(cid) || null : null,
    name: s(l.name),
    email: s(l.email),
    phone: s(l.phone),
    job_title: s(l.job_title),
    company_name: s(l.company_name),
    company_domain: s(l.company_domain),
    linkedin_url: s(l.linkedin_url),
    country: s(l.country),
    why_hot: s(l.why_hot),
    note: s(l.note),
    became_hot_at: s(l.became_hot_at),
    replied: l.replied_at ? true : null,
    payload: l,
    fetched_at: new Date().toISOString(),
  };
}

// deno-lint-ignore no-explicit-any
function contactedRow(l: any, campaigns: Map<string, string>) {
  const cid = String(l.campaign_id);
  return {
    provider: "explee",
    external_id: String(l.person_id),
    kind: "contacted",
    external_campaign_id: cid,
    campaign_name: campaigns.get(cid) || null,
    name: s(l.name) || [s(l.first_name), s(l.last_name)].filter(Boolean).join(" ") || null,
    email: s(l.email),
    job_title: s(l.job_title),
    company_name: s(l.company_name),
    company_domain: s(l.company_domain),
    linkedin_url: s(l.linkedin_url),
    country: s(l.country),
    note: s(l.last_reply),
    replied: typeof l.replied === "boolean" ? l.replied : null,
    payload: l,
    fetched_at: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
  });
  const { data: auth } = await db.auth.getUser();
  if (!auth?.user) return json({ error: "Sign in first." }, 401);

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid request body." }, 400); }
  const provider = body.provider || "explee";
  if (provider !== "explee") return json({ error: `Unknown provider ${provider}.` }, 400);

  // Row-level security returns nothing to people without a BD lead role.
  const { data: conn, error: connErr } = await db.from("bd_platform_connections").select("*").eq("provider", provider).maybeSingle();
  if (connErr) return json({ error: connErr.message }, 500);
  if (!conn) return json({ error: "You do not have access to lead sources, or Explee is not set up." }, 403);

  // Tolerate a pasted header name, "Bearer " prefix or surrounding quotes.
  const key = Deno.env.get("EXPLEE_API_KEY")?.trim()
    .replace(/^(x-api-key\s*:\s*|bearer\s+)/i, "").replace(/^["']|["']$/g, "").trim();
  const projectId = Number(conn.settings?.project_id) || null;

  try {
    if (body.action === "settings") {
      const pid = Number(body.project_id);
      if (!Number.isInteger(pid) || pid <= 0) return json({ error: "Enter a valid Explee project ID." }, 400);
      const { data, error } = await db.from("bd_platform_connections")
        .update({ settings: { ...conn.settings, project_id: pid }, updated_by: auth.user.id, updated_at: new Date().toISOString() })
        .eq("provider", provider).select("provider");
      if (error) return json({ error: error.message }, 500);
      if (!data?.length) return json({ error: "Only a BD manager can change lead-source settings." }, 403);
      return json({ ok: true });
    }

    if (body.action === "status") {
      if (!key) return json({ connection: conn, configured: false, connected: false });
      const [balance, projects, campaigns] = await Promise.all([
        explee(key, "/billing/balance").catch((e) => ({ error: e.message })),
        explee(key, "/autogtm/projects").catch((e) => ({ error: e.message })),
        projectId ? explee(key, "/autogtm/campaigns", { project_id: projectId }).catch((e) => ({ error: e.message })) : null,
      ]);
      // "connected" only when Explee accepted the key (the projects call works).
      return json({ connection: conn, configured: true, connected: !projects?.error, key_error: projects?.error || null, balance, projects, campaigns });
    }

    if (body.action === "sync") {
      if (!key) return json({ error: "Add the EXPLEE_API_KEY secret in Supabase (Edge Functions > Secrets) first." }, 400);
      if (!projectId) return json({ error: "Set the Explee project ID first." }, 400);

      const campaignList = await explee(key, "/autogtm/campaigns", { project_id: projectId });
      const campaigns = new Map<string, string>(
        // deno-lint-ignore no-explicit-any
        (campaignList.campaigns || []).map((c: any) => [String(c.id), c.name || `Campaign ${c.id}`]),
      );

      // Hot leads: people who replied with interest. Incremental by became_hot_at.
      let hot = 0;
      let newest: string | null = conn.last_hot_lead_at;
      for (let page = 0, offset = 0; page < MAX_HOT_PAGES; page++) {
        const res = await explee(key, "/autogtm/hot-leads", {
          project_id: projectId, since: conn.last_hot_lead_at || undefined, limit: 200, offset,
        });
        // deno-lint-ignore no-explicit-any
        const rows = (res.leads || []).filter((l: any) => l && l.person_id != null && !l.erased).map((l: any) => hotRow(l, campaigns));
        if (rows.length) {
          const { error } = await db.from("bd_platform_prospects").upsert(rows, { onConflict: "provider,external_id" });
          if (error) throw new Error(error.message);
          hot += rows.length;
          for (const r of rows) if (r.became_hot_at && (!newest || r.became_hot_at > newest)) newest = r.became_hot_at;
        }
        if (!res.has_more) break;
        offset = res.next_offset ?? offset + 200;
      }

      // Optional: everyone the campaigns emailed. Existing rows are left as they are.
      let contacted = 0;
      if (body.include_contacted) {
        for (const cid of campaigns.keys()) {
          let cursor: string | undefined;
          let fetched = 0;
          while (fetched < CONTACTED_PER_CAMPAIGN) {
            const res = await explee(key, `/autogtm/campaigns/${cid}/leads`, { limit: 500, order: "first_emailed", cursor });
            const items = Array.isArray(res) ? res : res.leads || res.items || [];
            // deno-lint-ignore no-explicit-any
            const rows = items.filter((l: any) => l && l.person_id != null).map((l: any) => contactedRow({ campaign_id: cid, ...l }, campaigns));
            if (rows.length) {
              const { error } = await db.from("bd_platform_prospects").upsert(rows, { onConflict: "provider,external_id", ignoreDuplicates: true });
              if (error) throw new Error(error.message);
              contacted += rows.length;
            }
            fetched += items.length;
            if (!res.has_more || !res.next_cursor || !items.length) break;
            cursor = res.next_cursor;
          }
        }
      }

      const result = { hot, contacted, campaigns: campaigns.size };
      await db.from("bd_platform_connections").update({
        last_synced_at: new Date().toISOString(), last_hot_lead_at: newest, last_result: result, last_error: null,
      }).eq("provider", provider);
      return json({ ok: true, ...result });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    const message = (e as Error).message;
    if (body.action === "sync") {
      await db.from("bd_platform_connections").update({ last_error: message, last_synced_at: new Date().toISOString() }).eq("provider", provider);
    }
    return json({ error: message }, e instanceof ProviderError ? 502 : 500);
  }
});
