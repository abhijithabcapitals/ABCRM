// onedrive-copy Edge Function: one run per POST (header x-od-copy-secret = OD_COPY_SECRET).
// The stage in od_copy.settings decides the work (see stages.ts). Not scheduled or deployed by this code:
// release steps are in the README and each needs the user's approval.
// Env: MS_TENANT_ID, MS_CLIENT_ID, MS_CERT_THUMBPRINT, MS_CERT_PRIVATE_KEY, OD_COPY_SECRET, SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL (direct Postgres, for build_plan only). Nothing secret is logged.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import postgres from "npm:postgres@3";
import { Graph } from "./graph.ts";
import { handle } from "./handler.ts";
import { getToken } from "./msauth.ts";
import type { ClientFolderRow, Db, Operation, PlanRow, RollbackScope, Settings, SourceRow, Stage } from "./stages.ts";

// The destination folder, at the top of the drive. Graph proves the configured dest_item_id is this folder.
const DEST_ROOT_PATH = "CRM AB CAPITAL";
const CHUNK = 500;
const ID_CHUNK = 100;
const PLAN_COLUMNS = ["status", "dest_item_id", "monitor_url", "attempts", "error", "hash_checked", "deferrals", "deferred_since"] as const;

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing environment variable ${name}`);
  return v;
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

// Supabase errors carry PostgREST messages only (no key or URL); the code makes them traceable.
function check<T>(r: { data: T; error: { message: string; code?: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.code ?? ""} ${r.error.message}`.trim());
  return r.data;
}

export class SupabaseDb implements Db {
  private readonly sb: SupabaseClient;
  private lockToken: string | null = null;
  constructor(url: string, serviceKey: string, private readonly dbUrl: string) {
    this.sb = createClient(url, serviceKey, { db: { schema: "od_copy" }, auth: { persistSession: false, autoRefreshToken: false } });
  }

  // od_copy.try_lock claims settings.running_until atomically and returns a token (null while another run holds it).
  async tryLock(seconds: number): Promise<boolean> {
    const token = check(await this.sb.rpc("try_lock", { p_seconds: seconds }), "take run lock") as string | null;
    this.lockToken = token ?? null;
    return !!token;
  }

  async unlock(): Promise<void> {
    if (!this.lockToken) return;
    check(await this.sb.rpc("unlock", { p_token: this.lockToken }), "release run lock");
    this.lockToken = null;
  }

  async saveDeltaLink(link: string): Promise<boolean> {
    if (!this.lockToken) return false;
    return check(await this.sb.rpc("save_delta_link", { p_token: this.lockToken, p_link: link }), "save delta link") === true;
  }

  async getSettings(): Promise<Settings> {
    return check(await this.sb.from("settings").select("*").eq("id", true).single(), "read settings") as Settings;
  }

  async saveSettings(p: Partial<Settings>): Promise<void> {
    check(await this.sb.from("settings").update(p).eq("id", true), "save settings");
  }

  async setStage(to: Stage, from: Stage[]): Promise<boolean> {
    const rows = check(
      await this.sb.from("settings").update({ stage: to }).eq("id", true).in("stage", from).select("stage"),
      "set stage",
    ) as { stage: string }[];
    return rows.length > 0;
  }

  async upsertSourceItems(rows: SourceRow[]): Promise<void> {
    const seen = new Date().toISOString();
    for (const part of chunks(rows, CHUNK)) {
      check(
        await this.sb.from("source_items").upsert(part.map((r) => ({ ...r, seen_at: seen })), { onConflict: "item_id" }),
        "store source items",
      );
    }
  }

  // Items deleted in the source: drop their plan rows that are still only planned, then the item itself unless a
  // plan row past planning (approved, copying, verified ...) still refers to it; those are kept as history.
  async markDeleted(ids: string[]): Promise<void> {
    for (const part of chunks(ids, ID_CHUNK)) {
      check(
        await this.sb.from("plan").delete().in("source_item_id", part).in("status", ["planned", "skipped_duplicate"]),
        "drop deleted plan rows",
      );
      const kept = check(await this.sb.from("plan").select("source_item_id").in("source_item_id", part), "read plan rows") as {
        source_item_id: string;
      }[];
      const keep = new Set(kept.map((k) => k.source_item_id));
      const drop = part.filter((id) => !keep.has(id));
      if (drop.length) check(await this.sb.from("source_items").delete().in("item_id", drop), "drop deleted source items");
    }
  }

  // build_plan takes 30-40 s on 170,000 files: too long for the Data API timeout, so it runs over a direct
  // connection with no statement timeout for that transaction.
  async buildPlan(): Promise<Record<string, number>> {
    const sql = postgres(this.dbUrl, { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 15 });
    try {
      const rows = await sql.begin(async (tx: postgres.TransactionSql) => {
        await tx`set local statement_timeout = 0`;
        return await tx`select od_copy.build_plan() as r`;
      }) as unknown as { r: Record<string, number> | null }[];
      return rows[0]?.r ?? {};
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  async claim(status: "approved" | "copying", limit: number): Promise<PlanRow[]> {
    return check(await this.sb.rpc("claim", { p_status: status, p_limit: limit }), "claim") as PlanRow[];
  }

  async update(id: string, patch: Partial<PlanRow>): Promise<void> {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const k of PLAN_COLUMNS) if (k in patch) row[k] = patch[k];
    check(await this.sb.from("plan").update(row).eq("source_item_id", id), "update plan row");
  }

  async log(op: Operation): Promise<void> {
    check(await this.sb.from("operations").insert(op), "write operation");
  }

  async upsertClientFolder(row: ClientFolderRow): Promise<void> {
    check(await this.sb.from("client_folders").upsert(row, { onConflict: "client_id,department" }), "store client folder");
  }

  async openCount(): Promise<number> {
    const r = await this.sb.from("plan").select("source_item_id", { count: "exact", head: true }).in("status", ["approved", "copying"]);
    check(r, "count open rows");
    return r.count ?? 0;
  }

  async folderPaths(ids: string[]): Promise<Record<string, string | null>> {
    const out: Record<string, string | null> = {};
    for (const part of chunks(ids, ID_CHUNK)) {
      const rows = check(
        await this.sb.from("source_items").select("item_id,parent_path,name").in("item_id", part).eq("is_folder", true),
        "read folder paths",
      ) as { item_id: string; parent_path: string; name: string }[];
      for (const r of rows) out[r.item_id] = r.parent_path ? `${r.parent_path}/${r.name}` : r.name;
    }
    return out;
  }

  async rollbackCandidates(scope: RollbackScope, after: string | undefined, limit: number): Promise<PlanRow[]> {
    return check(
      await this.sb.rpc("rollback_candidates", {
        p_area: scope.area ?? null,
        p_client_id: scope.clientId ?? null,
        p_after: after ?? null,
        p_limit: limit,
      }),
      "read rollback candidates",
    ) as PlanRow[];
  }
}

function makeGraph(s: Settings): Graph {
  if (!s.drive_id || !s.dest_item_id) throw new Error("settings.drive_id and settings.dest_item_id must be set");
  const ms = {
    tenantId: env("MS_TENANT_ID"),
    clientId: env("MS_CLIENT_ID"),
    thumbprint: env("MS_CERT_THUMBPRINT"),
    privateKeyPem: env("MS_CERT_PRIVATE_KEY"),
  };
  return new Graph({ token: () => getToken(ms), driveId: s.drive_id, destRootId: s.dest_item_id, destRootPath: DEST_ROOT_PATH });
}

Deno.serve((req) =>
  handle(req, {
    secret: Deno.env.get("OD_COPY_SECRET"),
    db: () => new SupabaseDb(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), env("SUPABASE_DB_URL")),
    graph: makeGraph,
  })
);
