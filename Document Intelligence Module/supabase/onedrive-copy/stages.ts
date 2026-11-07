// OneDrive copy stages: inventory (read-only delta of the drive, kept to the source folder), planning, copy + verify,
// rollback.
// Spec: Document Intelligence Module/docs/2026-11-06-onedrive-copy-design.md ("Stages").
// All database access goes through Db and all OneDrive access through GraphApi, so the stages run
// against fakes in stages_test.ts. Every OneDrive write is made by Graph, behind its write guard.

import { type DriveItem, FolderBlockedError, type Graph, GraphError, WriteGuardError } from "./graph.ts";

export type GraphApi = Pick<Graph, "delta" | "getItem" | "ensureFolder" | "startCopy" | "pollCopy" | "recycle">;

export type Stage = "idle" | "inventory" | "planning" | "plan" | "approved" | "copying" | "done" | "paused" | "rollback";

export type Settings = {
  drive_id: string | null;
  source_item_id: string | null;
  dest_item_id: string | null;
  stage: Stage | string;
  delta_link: string | null;
  batch_size: number;
  max_in_flight: number;
  last_run_at: string | null;
  last_run_result: Record<string, unknown> | null;
  rollback_scope: Record<string, unknown> | null;
};

export type SourceRow = {
  item_id: string;
  parent_path: string;
  name: string;
  size: number;
  quickxor_hash: string | null;
  modified_at: string | null;
  is_folder: boolean;
};

// A plan row as claimed: the od_copy.plan columns plus the source file's size and hash.
export type PlanRow = {
  source_item_id: string;
  source_path: string | null;
  target_path: string;
  department: string | null;
  client_id: string | null;
  status: string;
  dest_item_id: string | null;
  monitor_url: string | null;
  attempts: number;
  error: string | null;
  hash_checked?: boolean | null; // false: verified by size only (the source had no quickXorHash)
  deferrals?: number; // runs in a row that could not settle this copy (transient errors, hash not ready yet)
  deferred_since?: string | null; // when the first of those deferrals happened
  size: number;
  quickxor_hash: string | null;
  modified_at?: string | null; // the source file's lastModifiedDateTime at listing time
};

export type Operation = {
  action: string;
  source_item_id?: string | null;
  dest_item_id?: string | null;
  result: string;
  detail?: Record<string, unknown>;
};

export type ClientFolderRow = { client_id: string; department: string; dest_item_id: string; web_url: string | null };

// Rollback scope, from od_copy.settings.rollback_scope. At least one key must be set; `all` = every copy.
export type RollbackScope = { area?: string; clientId?: string; all?: boolean };

export interface Db {
  // Run lock (od_copy.try_lock): true when this run now holds it for `seconds`. A run without it does nothing.
  tryLock(seconds: number): Promise<boolean>;
  // Releases the lock only if this run still holds it.
  unlock(): Promise<void>;
  // Saves the delta link only while this run still holds the lock, so a stale run never moves it backwards.
  saveDeltaLink(link: string): Promise<boolean>;
  getSettings(): Promise<Settings>;
  saveSettings(p: Partial<Settings>): Promise<void>;
  // Stage change only from one of the expected stages, so a pause or rollback set meanwhile wins. True if changed.
  setStage(to: Stage, from: Stage[]): Promise<boolean>;
  upsertSourceItems(rows: SourceRow[]): Promise<void>;
  markDeleted(ids: string[]): Promise<void>;
  buildPlan(): Promise<Record<string, number>>;
  // od_copy.claim: 'approved' rows become 'copying' (at most `limit` copying in total); 'copying' rows
  // are leased to this run. Locked rows are skipped, so two runs never get the same row.
  claim(status: "approved" | "copying", limit: number): Promise<PlanRow[]>;
  update(id: string, patch: Partial<PlanRow>): Promise<void>;
  log(op: Operation): Promise<void>;
  upsertClientFolder(row: ClientFolderRow): Promise<void>;
  // Plan rows still 'approved' or 'copying'.
  openCount(): Promise<number>;
  // Path below the source root of known source folders (for delta items that carry no path).
  folderPaths(ids: string[]): Promise<Record<string, string | null>>;
  // 'verified' rows with a dest_item_id inside the scope, ordered by source_item_id, after the cursor.
  rollbackCandidates(scope: RollbackScope, after: string | undefined, limit: number): Promise<PlanRow[]>;
}

export const MAX_ATTEMPTS = 5;
// A copy that cannot be settled (transient errors, hash not ready) for more than this many runs, or for longer than
// this, goes to failed-for-review so it stops holding an in-flight slot.
export const MAX_DEFERRALS = 20;
export const MAX_DEFER_MS = 2 * 3600_000;

// Error text safe to store: no URLs, no bearer tokens, short.
export function errText(e: unknown): string {
  const raw = e instanceof Error ? (e instanceof GraphError || e instanceof WriteGuardError ? e.message : `${e.name}: ${e.message}`) : String(e);
  return raw
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/eyJ[\w-]+\.[\w.-]*/g, "[redacted]")
    .slice(0, 300);
}

// Throttling (Retry-After over the cap) or a 429/503 that outlasted the retries: stop taking work.
export function isThrottle(e: unknown): e is GraphError {
  return e instanceof GraphError && (e.code === "throttled" || e.status === 429 || e.status === 503);
}

function stopReason(e: unknown): string {
  if (isThrottle(e)) return `throttled (${e.status}): stopped taking new work`;
  return `write guard refused: ${errText(e)}`;
}

// ---------- inventory ----------

// Path segments after "root:", decoded, original case kept.
function rawSegments(path: string): string[] {
  const i = path.indexOf("root:");
  const rest = i >= 0 ? path.slice(i + 5) : path;
  return rest.split("/").filter((s) => s.length > 0).map((s) => {
    try {
      return decodeURIComponent(s).normalize("NFC");
    } catch {
      return s.normalize("NFC");
    }
  });
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export type InventoryResult = {
  pages: number;
  items: number;
  done: boolean;
  skipped: number; // outside the source folder
  unresolved: number; // parent never found: logged as 'inventory_unresolved', not stored
  stage_changed?: string;
  stopped?: string;
};

// Lists the whole drive (delta on the drive root: OneDrive for Business has no folder delta) and keeps only the items
// below the source folder, with paths relative to it. On the last page the delta link is saved and the stage becomes
// 'planning'; build_plan runs at the start of the next run (runPlanning), never at the end of a listing run.
export async function runInventory(g: GraphApi, db: Db, deadline: number, now: () => number = Date.now): Promise<InventoryResult> {
  const s = await db.getSettings();
  if (!s.source_item_id) throw new Error("settings.source_item_id is not set");
  const sourceId = s.source_item_id;
  const root = await g.getItem(sourceId);
  if (!root.parentReference?.path) throw new Error("source folder has no path");
  const rootSegs = rawSegments(`${root.parentReference.path}/${encodeURIComponent(root.name)}`);

  // Folder id -> path below the source root ("" = the root); null = a folder outside the source.
  const folders = new Map<string, string | null>([[sourceId, ""]]);
  const out: InventoryResult = { pages: 0, items: 0, done: false, skipped: 0, unresolved: 0 };
  // Items whose parent is not known yet: carried to later pages, then resolved through their parent folder.
  let carried: DriveItem[] = [];

  const underRoot = (path: string): string | null => {
    const segs = rawSegments(path);
    if (segs.length < rootSegs.length || !rootSegs.every((x, i) => same(x, segs[i]))) return null;
    return segs.slice(rootSegs.length).join("/");
  };
  // Parent path below the source root; null when outside it; undefined when not yet known.
  const parentOf = (it: DriveItem): string | null | undefined => {
    if (it.root || !it.parentReference) return null; // the drive root itself
    const p = it.parentReference.path;
    if (p) return underRoot(p);
    const pid = it.parentReference.id;
    return pid ? folders.get(pid) : null;
  };
  const toRow = (it: DriveItem, parent: string): SourceRow => {
    if (it.folder) folders.set(it.id, parent ? `${parent}/${it.name}` : it.name);
    return {
      item_id: it.id,
      parent_path: parent,
      name: it.name,
      size: it.size ?? 0,
      quickxor_hash: it.file?.hashes?.quickXorHash ?? null,
      modified_at: it.lastModifiedDateTime ?? null,
      is_folder: !!it.folder,
    };
  };
  const outside = (it: DriveItem) => {
    out.skipped++;
    if (it.folder) folders.set(it.id, null);
  };

  // Resolve in passes (a folder later in the list can be the parent of an earlier item); returns the rows and
  // what is still unknown.
  const resolve = async (list: DriveItem[]): Promise<{ rows: SourceRow[]; left: DriveItem[] }> => {
    const ids = new Set(list.map((i) => i.id));
    const unknown = [...new Set(list.filter((i) => !i.parentReference?.path && i.parentReference?.id)
      .map((i) => i.parentReference!.id!).filter((id) => !folders.has(id) && !ids.has(id)))];
    if (unknown.length) for (const [id, path] of Object.entries(await db.folderPaths(unknown))) folders.set(id, path);
    const rows: SourceRow[] = [];
    let pending = list;
    let progress = true;
    while (pending.length && progress) {
      progress = false;
      const left: DriveItem[] = [];
      for (const it of pending) {
        const parent = parentOf(it);
        if (parent === undefined) {
          left.push(it);
          continue;
        }
        progress = true;
        if (parent === null) outside(it);
        else rows.push(toRow(it, parent));
      }
      pending = left;
    }
    return { rows, left: pending };
  };

  const store = async (rows: SourceRow[]) => {
    if (rows.length) await db.upsertSourceItems(rows);
    out.items += rows.length;
  };

  // A folder's place from Graph (getItem gives parentReference.path): below the source, outside (null), or unknown.
  const lookUp = async (id: string): Promise<string | null | undefined> => {
    try {
      const it = await g.getItem(id);
      if (it.root) return null;
      if (!it.parentReference?.path) return undefined;
      return underRoot(`${it.parentReference.path}/${encodeURIComponent(it.name)}`);
    } catch (e) {
      if (isThrottle(e)) throw e;
      return undefined;
    }
  };

  // Before the delta link moves past them for good: look up each unknown parent folder once (many items share one),
  // then, for items still unknown, the item itself; log what stays unknown (action 'inventory_unresolved').
  const settleCarried = async () => {
    for (const pid of new Set(carried.map((i) => i.parentReference?.id).filter((x): x is string => !!x))) {
      if (folders.has(pid)) continue;
      const path = await lookUp(pid);
      if (path !== undefined) folders.set(pid, path);
    }
    const { rows, left } = await resolve(carried);
    for (const it of left) {
      let parent: string | null | undefined;
      try {
        const full = await g.getItem(it.id);
        parent = full.parentReference?.path ? underRoot(full.parentReference.path) : undefined;
      } catch (e) {
        if (isThrottle(e)) throw e;
        parent = undefined;
      }
      if (parent === null) outside(it);
      else if (parent !== undefined) rows.push(toRow(it, parent));
      else {
        out.unresolved++;
        await db.log({
          action: "inventory_unresolved",
          source_item_id: it.id,
          result: "unresolved",
          detail: { parent_id: it.parentReference?.id ?? null },
        });
      }
    }
    carried = [];
    await store(rows);
  };

  const saveLink = async (link: string): Promise<boolean> => {
    if (await db.saveDeltaLink(link)) return true;
    out.stopped = "run lock lost";
    return false;
  };

  for await (const page of g.delta(s.delta_link ?? undefined)) {
    out.pages++;
    const items = page.items.filter((i) => i.id !== sourceId);
    const deleted = items.filter((i) => i.deleted).map((i) => i.id);
    const { rows, left } = await resolve([...carried, ...items.filter((i) => !i.deleted)]);
    carried = left;
    await store(rows);
    if (deleted.length) await db.markDeleted(deleted);

    if (page.deltaLink) {
      await settleCarried();
      if (!(await saveLink(page.deltaLink))) return out;
      out.done = true;
      if (!(await db.setStage("planning", ["inventory"]))) out.stage_changed = "stage was changed during the run; left as is";
      return out;
    }
    if (page.nextLink && now() >= deadline) {
      await settleCarried();
      await saveLink(page.nextLink);
      return out;
    }
    // Progress is saved every page so an interrupted run resumes from here, except while items are carried: then
    // the older link stays, so a crash lists those items again instead of losing them.
    if (page.nextLink && carried.length === 0 && !(await saveLink(page.nextLink))) return out;
  }
  await settleCarried();
  return out;
}

// ---------- planning ----------

// Stage 'planning': the listing finished in the previous run. build_plan runs here, at the start of a run (the run
// lock is held), then the stage becomes 'plan' unless someone changed it meanwhile.
export async function runPlanning(db: Db): Promise<{ plan: Record<string, number>; stage_changed?: string }> {
  const plan = await db.buildPlan();
  const out: { plan: Record<string, number>; stage_changed?: string } = { plan };
  if (!(await db.setStage("plan", ["planning"]))) out.stage_changed = "stage was changed during the run; left as is";
  return out;
}

// ---------- copy and verify ----------

export type LoopOptions = { now?: () => number; sleep?: (ms: number) => Promise<void>; pollMs?: number };

export type CopyResult = { started: number; verified: number; failed: number; deferred: number; stopped?: string };

// A Graph answer that will not change on retry (bad request, not found, gone ...): not worth polling again.
function isPermanent(e: unknown): boolean {
  return e instanceof GraphError && e.status >= 400 && e.status < 500 && ![408, 409, 429].includes(e.status);
}

export async function runCopy(g: GraphApi, db: Db, deadline: number, maxInFlight: number, opts: LoopOptions = {}): Promise<CopyResult> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = opts.pollMs ?? 2_000;
  const out: CopyResult = { started: 0, verified: 0, failed: 0, deferred: 0 };
  if (now() >= deadline) return { ...out, stopped: "deadline" };

  const tried = new Set<string>(); // rows started or settled in this run: not touched again in the same run
  const clientsDone = new Set<string>();
  let inFlight: PlanRow[] = [];

  // A counted attempt where no copy item is known to exist (monitor said failed, copy POST failed, start not
  // recorded): retried after the back-off until MAX_ATTEMPTS. Never used once a copy's item id is known.
  const fail = async (r: PlanRow, error: string) => {
    const attempts = r.attempts + 1;
    const status = attempts >= MAX_ATTEMPTS ? "failed" : "approved";
    await db.update(r.source_item_id, { status, attempts, error, monitor_url: null, dest_item_id: null, deferrals: 0, deferred_since: null });
    await db.log({
      action: "copy",
      source_item_id: r.source_item_id,
      dest_item_id: null,
      result: status === "failed" ? "failed" : "retry",
      detail: { error, attempts },
    });
    tried.add(r.source_item_id);
    out.failed++;
  };

  // The state cannot be learned again (monitor gone, item not found, no item id, real mismatch, stuck too long):
  // 'failed' for a person to check the destination. Not retried automatically, because a retry could make a second
  // copy. The copy's item id, when known, stays in dest_item_id (and in operations) so review and rollback find it.
  const review = async (r: PlanRow, error: string, destId?: string) => {
    const dest = destId ?? r.dest_item_id;
    await db.update(r.source_item_id, {
      status: "failed",
      error: `${error}; check the destination before retrying`,
      monitor_url: null,
      dest_item_id: dest,
    });
    await db.log({ action: "copy", source_item_id: r.source_item_id, dest_item_id: dest, result: "needs_review", detail: { error } });
    tried.add(r.source_item_id);
    out.failed++;
  };

  // The copy may exist but cannot be checked now: keep it 'copying' with its monitor (and the new item's id when
  // known) so a later run polls or verifies again. No new copy is started, so no untracked duplicate. After
  // MAX_DEFERRALS runs or MAX_DEFER_MS it goes to review instead, so it stops holding an in-flight slot.
  const defer = async (r: PlanRow, error: string, destId?: string) => {
    const dest = destId ?? r.dest_item_id;
    const deferrals = (r.deferrals ?? 0) + 1;
    const since = r.deferred_since ?? new Date(now()).toISOString();
    if (deferrals > MAX_DEFERRALS || now() - Date.parse(since) > MAX_DEFER_MS) {
      return await review(r, `copy still unsettled after ${deferrals - 1} runs (${error})`, dest ?? undefined);
    }
    await db.update(r.source_item_id, { status: "copying", monitor_url: r.monitor_url, dest_item_id: dest, error, deferrals, deferred_since: since });
    await db.log({ action: "copy", source_item_id: r.source_item_id, dest_item_id: dest, result: "deferred", detail: { error, deferrals } });
    tried.add(r.source_item_id);
    out.deferred++;
  };

  // Size or hash of the copy differs from the listing. Re-read the source: changed since the listing (or gone) means
  // the plan is stale; unchanged means the copy itself is wrong. Either way a person decides: no automatic re-copy.
  const mismatch = async (r: PlanRow, destId: string) => {
    let changed: boolean;
    try {
      const src = await g.getItem(r.source_item_id);
      const modified = (x: string | null | undefined) => (x ? Date.parse(x) : NaN);
      changed = src.size !== r.size || (src.file?.hashes?.quickXorHash ?? null) !== (r.quickxor_hash ?? null) ||
        (!!r.modified_at && !!src.lastModifiedDateTime && modified(src.lastModifiedDateTime) !== modified(r.modified_at));
    } catch (e) {
      if (isThrottle(e) || e instanceof WriteGuardError) {
        await db.update(r.source_item_id, { status: "copying", monitor_url: r.monitor_url, dest_item_id: destId });
        throw e;
      }
      if (!(e instanceof GraphError && e.status === 404)) return await defer(r, `source unreadable: ${errText(e)}`, destId);
      changed = true; // the source is gone
    }
    await review(
      r,
      changed
        ? "verify mismatch: the source changed since the listing; list again, then retry by hand"
        : "verify mismatch: the copy differs from the unchanged source",
      destId,
    );
  };

  const recordClientFolder = async (r: PlanRow) => {
    if (!r.client_id || !r.department) return;
    const segs = r.target_path.split("/");
    if (segs.length < 3) return;
    const key = `${r.client_id}|${r.department}`;
    if (clientsDone.has(key)) return;
    try {
      const id = await g.ensureFolder(segs.slice(0, 2).join("/"));
      const folder = await g.getItem(id);
      await db.upsertClientFolder({ client_id: r.client_id, department: r.department, dest_item_id: id, web_url: folder.webUrl ?? null });
      clientsDone.add(key);
    } catch (e) {
      if (isThrottle(e) || e instanceof WriteGuardError) out.stopped = stopReason(e);
      else await db.log({ action: "client_folder", source_item_id: r.source_item_id, result: "error", detail: { error: errText(e) } });
    }
  };

  // Verify the copied item against the source. Throws only for throttling or the write guard (row kept 'copying'
  // with the item id, so the next run verifies it).
  const verify = async (r: PlanRow, destId: string) => {
    let item: DriveItem;
    try {
      item = await g.getItem(destId);
    } catch (e) {
      if (isThrottle(e) || e instanceof WriteGuardError) {
        await db.update(r.source_item_id, { status: "copying", monitor_url: r.monitor_url, dest_item_id: destId });
        throw e;
      }
      return isPermanent(e) ? await review(r, `copied item unreadable: ${errText(e)}`, destId) : await defer(r, errText(e), destId);
    }
    const hash = item.file?.hashes?.quickXorHash ?? null;
    // With a source hash the destination must carry the same hash; without one, size only (hash_checked = false).
    const hashChecked = !!r.quickxor_hash;
    if (!item.file) return await review(r, "copied item is not a file", destId);
    // OneDrive fills in the hash of a new file a little later: not a failure, check again next run.
    if (hashChecked && !hash) return await defer(r, "the copy has no quickXorHash yet", destId);
    if (item.size !== r.size || (hashChecked && hash !== r.quickxor_hash)) return await mismatch(r, destId);
    await db.update(r.source_item_id, {
      status: "verified",
      dest_item_id: destId,
      monitor_url: null,
      error: null,
      hash_checked: hashChecked,
      deferrals: 0,
      deferred_since: null,
    });
    await db.log({
      action: "copy",
      source_item_id: r.source_item_id,
      dest_item_id: destId,
      result: "verified",
      detail: { size: r.size, hash_checked: hashChecked },
    });
    tried.add(r.source_item_id);
    out.verified++;
    await recordClientFolder(r);
  };

  // One running copy: poll its monitor, or verify directly when the new item's id is already recorded.
  // Returns true while the copy is still running.
  const check = async (r: PlanRow): Promise<boolean> => {
    try {
      if (r.dest_item_id) {
        await verify(r, r.dest_item_id);
        return false;
      }
      const st = await g.pollCopy(r.monitor_url!);
      if (st.status === "inProgress") return true;
      if (st.status === "failed") {
        await fail(r, `copy failed: ${errText(st.error ?? "unknown")}`);
        return false;
      }
      if (!st.resourceId) {
        await review(r, "copy completed without an item id");
        return false;
      }
      await verify(r, st.resourceId);
      return false;
    } catch (e) {
      if (isThrottle(e) || e instanceof WriteGuardError) {
        out.stopped = stopReason(e);
        return false; // row stays 'copying' in the database for the next run
      }
      if (isPermanent(e)) await review(r, `copy monitor unreadable: ${errText(e)}`);
      else await defer(r, errText(e));
      return false;
    }
  };

  // Stop when someone changed the stage (pause, rollback) during the run.
  const stageStillCopying = async (): Promise<boolean> => {
    const st = (await db.getSettings()).stage;
    if (st !== "approved" && st !== "copying") out.stopped = `stage changed to ${st}`;
    return !out.stopped;
  };

  // Copies left running by earlier runs.
  for (const r of await db.claim("copying", 50)) {
    if (r.monitor_url || r.dest_item_id) inFlight.push(r);
    else await fail(r, "copy start was not recorded (run interrupted); the destination may hold an extra copy");
  }

  let stageCopying = false;
  const templated = new Set<string>(); // client/employee folders whose required sub-folders exist this run
  while (!out.stopped && now() < deadline) {
    // 1. Poll running copies.
    const still: PlanRow[] = [];
    for (const r of inFlight) {
      if (out.stopped || now() >= deadline) still.push(r);
      else if (await check(r)) still.push(r);
    }
    inFlight = still;
    if (out.stopped || now() >= deadline || !(await stageStillCopying())) break;

    // 2. Start new copies up to the in-flight limit.
    const fresh = await db.claim("approved", maxInFlight);
    let startedNow = 0;
    for (const r of fresh) {
      if (out.stopped || now() >= deadline || tried.has(r.source_item_id)) {
        await db.update(r.source_item_id, { status: "approved", monitor_url: null });
        continue;
      }
      tried.add(r.source_item_id);
      try {
        const cut = r.target_path.lastIndexOf("/");
        if (cut <= 0) throw new Error("target path has no folder");
        const tpl = templateFor(r);
        if (tpl && !templated.has(tpl.base)) {
          for (const f of tpl.folders) await g.ensureFolder(`${tpl.base}/${f}`);
          templated.add(tpl.base);
        }
        const parentId = await g.ensureFolder(r.target_path.slice(0, cut));
        // A row a person set back to 'approved' may still name an earlier copy: keep it findable in operations.
        if (r.dest_item_id) {
          await db.log({ action: "copy", source_item_id: r.source_item_id, dest_item_id: r.dest_item_id, result: "earlier_copy" });
        }
        const monitor = await g.startCopy(r.source_item_id, parentId, r.target_path.slice(cut + 1));
        await db.update(r.source_item_id, { status: "copying", monitor_url: monitor, dest_item_id: null, deferrals: 0, deferred_since: null });
        inFlight.push({ ...r, status: "copying", monitor_url: monitor, dest_item_id: null });
        out.started++;
        startedNow++;
        if (!stageCopying) {
          await db.setStage("copying", ["approved"]);
          stageCopying = true;
        }
      } catch (e) {
        if (isThrottle(e) || e instanceof WriteGuardError) {
          out.stopped = stopReason(e);
          tried.delete(r.source_item_id);
          await db.update(r.source_item_id, { status: "approved", monitor_url: null });
        } else if (e instanceof FolderBlockedError) {
          // A file holds the name of a folder this row needs: only this row is affected; the run goes on.
          await review(r, errText(e));
        } else await fail(r, errText(e)); // includes a copy POST 502/504: retried after the back-off
      }
    }
    if (inFlight.length === 0 && startedNow === 0) break;
    if (inFlight.length > 0) await sleep(Math.max(0, Math.min(pollMs, deadline - now())));
  }

  if (inFlight.length === 0 && (!out.stopped || out.stopped === "deadline") && (await db.openCount()) === 0) {
    await db.setStage("done", ["approved", "copying"]);
  }
  return out;
}

// ---------- rollback ----------

export async function runRollback(
  g: GraphApi,
  db: Db,
  deadline: number,
  scope: RollbackScope,
  now: () => number = Date.now,
): Promise<{ recycled: number; skipped: number; finished: boolean; stopped?: string }> {
  if (!scope || (!scope.area && !scope.clientId && scope.all !== true)) {
    throw new Error("rollback scope must name an area, a client_id, or all");
  }
  const out: { recycled: number; skipped: number; finished: boolean; stopped?: string } = { recycled: 0, skipped: 0, finished: false };
  const skip = async (r: PlanRow, result: string, detail?: Record<string, unknown>) => {
    out.skipped++;
    await db.log({ action: "recycle", source_item_id: r.source_item_id, dest_item_id: r.dest_item_id, result, detail });
  };
  let after: string | undefined;
  outer: while (true) {
    if (now() >= deadline) {
      out.stopped = "deadline";
      break;
    }
    const rows = await db.rollbackCandidates(scope, after, 50);
    if (rows.length === 0) {
      out.finished = true;
      break;
    }
    for (const r of rows) {
      if (now() >= deadline) {
        out.stopped = "deadline";
        break outer;
      }
      after = r.source_item_id;
      // Only this job's own verified copies, by the id it recorded.
      if (r.status !== "verified" || !r.dest_item_id) continue;
      try {
        const item = await g.getItem(r.dest_item_id);
        const hash = item.file?.hashes?.quickXorHash;
        if (!r.quickxor_hash) {
          await skip(r, "skipped_unverifiable", { reason: "no recorded hash" });
          continue;
        }
        if (!item.file || item.size !== r.size || hash !== r.quickxor_hash) {
          await skip(r, "skipped_changed", { reason: "destination size or hash changed since the copy" });
          continue;
        }
        await g.recycle(r.dest_item_id);
        await db.update(r.source_item_id, { status: "rolled_back" });
        await db.log({ action: "recycle", source_item_id: r.source_item_id, dest_item_id: r.dest_item_id, result: "rolled_back" });
        out.recycled++;
      } catch (e) {
        if (isThrottle(e)) {
          out.stopped = stopReason(e);
          break outer;
        }
        if (e instanceof GraphError && e.status === 404) await skip(r, "skipped_missing");
        else if (e instanceof WriteGuardError) await skip(r, "refused", { error: errText(e) });
        else await skip(r, "error", { error: errText(e) });
      }
    }
  }
  if (out.finished) await db.setStage("paused", ["rollback"]);
  return out;
}

// settings.rollback_scope (jsonb: { area?, client_id?, all? }) to a RollbackScope.
export function scopeFrom(v: Record<string, unknown> | null | undefined): RollbackScope {
  const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);
  return { area: str(v?.area), clientId: str(v?.client_id ?? v?.clientId), all: v?.all === true ? true : undefined };
}

// User rule 2026-11-06: every client folder has these seven folders, every employee folder these five,
// whether or not the copy fills them.
export const CLIENT_FOLDERS = ["KYC", "FINANCIALS INFORMATION", "ACCOUNTING DATA", "VOUCHERS", "OTHERS", "PROPOSALS", "ENGAGEMENT LETTERS"];
export const EMPLOYEE_FOLDERS = ["PERSONAL DOCUMENTS", "EMPLOYMENT DOCUMENTS", "PAYROLL", "LEAVE AND ATTENDANCE", "OTHERS"];

/** The client or employee folder a row lands in, with its required sub-folders; null for every other target. */
export function templateFor(r: { target_path: string; client_id?: string | null }): { base: string; folders: string[] } | null {
  const segs = r.target_path.split("/");
  if (r.client_id && segs.length >= 4) return { base: segs.slice(0, 2).join("/"), folders: CLIENT_FOLDERS };
  if (segs[0] === "EMPLOYEES" && segs[1] !== "00 Unmatched") {
    const n = segs[1] === "00 EX EMPLOYEES" ? 3 : 2;
    if (segs.length > n + 1) return { base: segs.slice(0, n).join("/"), folders: EMPLOYEE_FOLDERS };
  }
  return null;
}
