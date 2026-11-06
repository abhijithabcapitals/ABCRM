// Stage tests with a fake Graph and an in-memory Db. No network, no database. Invented names only.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { type CopyStatus, type DriveItem, GraphError, WriteGuardError } from "./graph.ts";
import {
  type ClientFolderRow,
  type Db,
  errText,
  type GraphApi,
  type Operation,
  type PlanRow,
  type RollbackScope,
  runCopy,
  runInventory,
  runRollback,
  type Settings,
  type SourceRow,
} from "./stages.ts";
import { handle } from "./handler.ts";

// ---------- in-memory Db ----------
class FakeDb implements Db {
  settings: Settings = {
    drive_id: "DRV",
    source_item_id: "SRC",
    dest_item_id: "DST",
    stage: "idle",
    delta_link: null,
    batch_size: 20,
    max_in_flight: 4,
    last_run_at: null,
    last_run_result: null,
    rollback_scope: null,
  };
  source = new Map<string, SourceRow>();
  plan = new Map<string, PlanRow>();
  ops: Operation[] = [];
  clientFolders: ClientFolderRow[] = [];
  buildPlanCalls = 0;
  deleted: string[] = [];

  getSettings() {
    return Promise.resolve({ ...this.settings });
  }
  saveSettings(p: Partial<Settings>) {
    this.settings = { ...this.settings, ...p };
    return Promise.resolve();
  }
  upsertSourceItems(rows: SourceRow[]) {
    for (const r of rows) this.source.set(r.item_id, r);
    return Promise.resolve();
  }
  markDeleted(ids: string[]) {
    this.deleted.push(...ids);
    for (const id of ids) this.source.delete(id);
    return Promise.resolve();
  }
  buildPlan() {
    this.buildPlanCalls++;
    return Promise.resolve({ files: [...this.source.values()].filter((s) => !s.is_folder).length });
  }
  claim(status: "approved" | "copying", limit: number) {
    // Same rules as od_copy.claim, without the lease and retry back-off timers.
    const rows = [...this.plan.values()].filter((p) => p.status === status)
      .sort((a, b) => a.attempts - b.attempts || a.source_item_id.localeCompare(b.source_item_id));
    let n = limit;
    if (status === "approved") n = Math.max(0, limit - [...this.plan.values()].filter((p) => p.status === "copying").length);
    const out = rows.slice(0, n);
    for (const r of out) if (status === "approved") Object.assign(r, { status: "copying", monitor_url: null });
    return Promise.resolve(out.map((r) => ({ ...r })));
  }
  update(id: string, patch: Partial<PlanRow>) {
    const r = this.plan.get(id);
    if (!r) throw new Error(`no plan row ${id}`);
    Object.assign(r, patch);
    return Promise.resolve();
  }
  log(op: Operation) {
    this.ops.push(op);
    return Promise.resolve();
  }
  upsertClientFolder(row: ClientFolderRow) {
    this.clientFolders = this.clientFolders.filter((c) => !(c.client_id === row.client_id && c.department === row.department));
    this.clientFolders.push(row);
    return Promise.resolve();
  }
  openCount() {
    return Promise.resolve([...this.plan.values()].filter((p) => p.status === "approved" || p.status === "copying").length);
  }
  folderPaths(ids: string[]) {
    const out: Record<string, string> = {};
    for (const id of ids) {
      const s = this.source.get(id);
      if (s?.is_folder) out[id] = s.parent_path ? `${s.parent_path}/${s.name}` : s.name;
    }
    return Promise.resolve(out);
  }
  rollbackCandidates(scope: RollbackScope, after: string | undefined, limit: number) {
    const rows = [...this.plan.values()]
      .filter((p) => p.status === "verified" && p.dest_item_id)
      .filter((p) => !scope.clientId || p.client_id === scope.clientId)
      .filter((p) => !scope.area || (p.source_path ?? "").startsWith(`${scope.area}/`))
      .filter((p) => after === undefined || p.source_item_id > after)
      .sort((a, b) => a.source_item_id.localeCompare(b.source_item_id))
      .slice(0, limit);
    return Promise.resolve(rows.map((r) => ({ ...r })));
  }
}

function planRow(id: string, over: Partial<PlanRow> = {}): PlanRow {
  return {
    source_item_id: id,
    source_path: `2. Accounting Clients/Zeta Testco/KYC/${id}.pdf`,
    target_path: `Accounting/Zeta Testco LLC - CL900001/KYC/Accounting/${id}.pdf`,
    department: "Accounting",
    client_id: "CL900001",
    status: "approved",
    dest_item_id: null,
    monitor_url: null,
    attempts: 0,
    error: null,
    size: 100,
    quickxor_hash: `H-${id}`,
    ...over,
  };
}

// ---------- fake Graph ----------
class FakeGraph implements GraphApi {
  calls: string[] = [];
  items = new Map<string, DriveItem>();
  monitors = new Map<string, CopyStatus>();
  pages: Record<string, { items: DriveItem[]; deltaLink?: string; nextLink?: string }> = {};
  startCopyError?: Error;
  recycled: string[] = [];
  copyNames = new Map<string, string>();

  async *delta(itemId: string, deltaLink?: string) {
    this.calls.push(`delta ${itemId} ${deltaLink ?? "-"}`);
    let key = deltaLink ?? "start";
    while (true) {
      const p = this.pages[key];
      if (!p) throw new GraphError(404, "itemNotFound");
      yield p;
      if (!p.nextLink) return;
      key = p.nextLink;
    }
  }
  getItem(id: string) {
    this.calls.push(`getItem ${id}`);
    const it = this.items.get(id);
    if (!it) return Promise.reject(new GraphError(404, "itemNotFound"));
    return Promise.resolve(structuredClone(it));
  }
  ensureFolder(relPath: string) {
    this.calls.push(`ensureFolder ${relPath}`);
    const id = `F:${relPath}`;
    if (!this.items.has(id)) this.items.set(id, { id, name: relPath.split("/").pop()!, folder: {}, webUrl: `https://example.invalid/${id}` });
    return Promise.resolve(id);
  }
  startCopy(sourceId: string, destParentId: string, name: string) {
    this.calls.push(`startCopy ${sourceId} ${destParentId} ${name}`);
    if (this.startCopyError) return Promise.reject(this.startCopyError);
    const url = `https://monitor.example.invalid/${sourceId}`;
    this.copyNames.set(sourceId, name);
    if (!this.monitors.has(url)) this.monitors.set(url, { status: "inProgress" });
    return Promise.resolve(url);
  }
  pollCopy(monitorUrl: string) {
    this.calls.push(`pollCopy ${monitorUrl}`);
    return Promise.resolve(this.monitors.get(monitorUrl) ?? { status: "inProgress" as const });
  }
  recycle(itemId: string) {
    this.calls.push(`recycle ${itemId}`);
    this.recycled.push(itemId);
    this.items.delete(itemId);
    return Promise.resolve();
  }
  // Test helper: the copy finished, Graph made `destId` with this size and hash.
  complete(sourceId: string, destId: string, size: number, hash: string | undefined) {
    this.items.set(destId, { id: destId, name: this.copyNames.get(sourceId) ?? "x", size, file: { hashes: { quickXorHash: hash } } });
    this.monitors.set(`https://monitor.example.invalid/${sourceId}`, { status: "completed", resourceId: destId });
  }
}

// Fake clock: sleep advances time, so the copy loop ends at the deadline without real waiting.
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, sleep: (ms: number) => Promise.resolve(void (t += Math.max(ms, 1))) };
}

// ---------- inventory ----------
Deno.test("inventory over two delta pages stores files and folders, saves the delta link, builds the plan once", async () => {
  const db = new FakeDb();
  db.settings.stage = "inventory";
  const g = new FakeGraph();
  const SRCP = "/drives/DRV/root:/Old Testdrive";
  g.items.set("SRC", { id: "SRC", name: "Old Testdrive", folder: {}, parentReference: { path: "/drives/DRV/root:" } });
  g.pages = {
    start: {
      nextLink: "https://graph.microsoft.com/v1.0/p2",
      items: [
        { id: "SRC", name: "Old Testdrive", folder: {}, parentReference: { path: "/drives/DRV/root:" } },
        { id: "A", name: "2. Accounting Clients", folder: {}, parentReference: { path: SRCP, id: "SRC" } },
        { id: "f1", name: "root.pdf", size: 5, file: { hashes: { quickXorHash: "h1" } }, parentReference: { path: SRCP, id: "SRC" } },
      ],
    },
    "https://graph.microsoft.com/v1.0/p2": {
      deltaLink: "https://graph.microsoft.com/v1.0/final",
      items: [
        // Path given (percent-encoded) and path missing: the second is resolved through its parent id.
        { id: "f2", name: "a.pdf", size: 7, file: { hashes: { quickXorHash: "h2" } }, parentReference: { path: `${SRCP}/2.%20Accounting%20Clients`, id: "A" }, lastModifiedDateTime: "2026-01-02T00:00:00Z" },
        { id: "f3", name: "b.pdf", size: 9, file: {}, parentReference: { id: "A" } },
        { id: "gone", name: "old.pdf", deleted: {}, parentReference: { id: "A" } },
        { id: "out", name: "elsewhere.pdf", size: 1, file: {}, parentReference: { path: "/drives/DRV/root:/Other Folder" } },
      ],
    },
  };
  const r = await runInventory(g, db, Date.now() + 60_000);
  assertEquals(r.done, true);
  assertEquals(r.pages, 2);
  assertEquals(db.settings.delta_link, "https://graph.microsoft.com/v1.0/final");
  assertEquals(db.buildPlanCalls, 1);
  assertEquals(db.settings.stage, "plan");
  assertEquals(db.source.get("f1")?.parent_path, "");
  assertEquals(db.source.get("f2")?.parent_path, "2. Accounting Clients");
  assertEquals(db.source.get("f2")?.quickxor_hash, "h2");
  assertEquals(db.source.get("f2")?.modified_at, "2026-01-02T00:00:00Z");
  assertEquals(db.source.get("f3")?.parent_path, "2. Accounting Clients");
  assertEquals(db.source.get("f3")?.quickxor_hash, null);
  assertEquals(db.source.get("A")?.is_folder, true);
  assertEquals(db.source.has("SRC"), false, "the source root itself is not an item");
  assertEquals(db.source.has("out"), false, "items outside the source folder are ignored");
  assertEquals(db.deleted, ["gone"]);
  assert(g.calls[0].startsWith("getItem SRC"));
});

Deno.test("inventory stops at the deadline and saves the next page link to resume", async () => {
  const db = new FakeDb();
  db.settings.stage = "inventory";
  const g = new FakeGraph();
  g.items.set("SRC", { id: "SRC", name: "Old Testdrive", folder: {}, parentReference: { path: "/drives/DRV/root:" } });
  g.pages = {
    start: { nextLink: "https://graph.microsoft.com/v1.0/p2", items: [] },
    "https://graph.microsoft.com/v1.0/p2": { deltaLink: "https://graph.microsoft.com/v1.0/final", items: [] },
  };
  const r = await runInventory(g, db, Date.now() - 1);
  assertEquals(r.done, false);
  assertEquals(db.settings.delta_link, "https://graph.microsoft.com/v1.0/p2");
  assertEquals(db.settings.stage, "inventory");
  assertEquals(db.buildPlanCalls, 0);
  // Next run resumes from the stored link.
  const r2 = await runInventory(g, db, Date.now() + 60_000);
  assertEquals(r2.done, true);
  assert(g.calls.includes("delta SRC https://graph.microsoft.com/v1.0/p2"));
  assertEquals(db.settings.stage, "plan");
});

// ---------- copy ----------
Deno.test("copy: approved -> copying with monitor; next run completed with matching size/hash -> verified", async () => {
  const db = new FakeDb();
  db.settings.stage = "approved";
  db.plan.set("s1", planRow("s1"));
  const g = new FakeGraph();
  const c = clock();
  const r1 = await runCopy(g, db, c.now() + 10_000, 4, c);
  assertEquals(r1.started, 1);
  const row = db.plan.get("s1")!;
  assertEquals(row.status, "copying");
  assertEquals(row.monitor_url, "https://monitor.example.invalid/s1");
  assert(g.calls.includes("ensureFolder Accounting/Zeta Testco LLC - CL900001/KYC/Accounting"));
  assert(g.calls.includes("startCopy s1 F:Accounting/Zeta Testco LLC - CL900001/KYC/Accounting s1.pdf"));
  assertEquals(db.settings.stage, "copying");

  g.complete("s1", "D1", 100, "H-s1");
  const r2 = await runCopy(g, db, c.now() + 10_000, 4, c);
  assertEquals(r2.verified, 1);
  assertEquals(db.plan.get("s1")!.status, "verified");
  assertEquals(db.plan.get("s1")!.dest_item_id, "D1");
  const copyOps = db.ops.filter((o) => o.action === "copy" && o.result === "verified");
  assertEquals(copyOps.length, 1);
  assertEquals(copyOps[0].dest_item_id, "D1");
  assertEquals(db.clientFolders, [{
    client_id: "CL900001",
    department: "Accounting",
    dest_item_id: "F:Accounting/Zeta Testco LLC - CL900001",
    web_url: "https://example.invalid/F:Accounting/Zeta Testco LLC - CL900001",
  }]);
  assertEquals(db.settings.stage, "done");
});

Deno.test("copy: monitor failed -> attempt counted, back to approved; after the 5th failure it stays failed", async () => {
  const db = new FakeDb();
  db.settings.stage = "copying";
  db.plan.set("s1", planRow("s1", { status: "copying", monitor_url: "https://monitor.example.invalid/s1" }));
  const g = new FakeGraph();
  g.monitors.set("https://monitor.example.invalid/s1", { status: "failed", error: "generalException" });
  const c = clock();
  // Deadline right after the first poll round: one failure per run.
  const r = await runCopy(g, db, c.now() + 1, 4, c);
  assertEquals(r.failed, 1);
  let row = db.plan.get("s1")!;
  assertEquals(row.attempts, 1);
  assertEquals(row.status, "approved");
  assert(row.error?.includes("generalException"));
  // Four more failures; each run restarts the copy and the monitor fails again.
  for (let i = 2; i <= 5; i++) {
    db.plan.get("s1")!.status = "copying";
    db.plan.get("s1")!.monitor_url = "https://monitor.example.invalid/s1";
    await runCopy(g, db, c.now() + 1, 4, c);
  }
  row = db.plan.get("s1")!;
  assertEquals(row.attempts, 5);
  assertEquals(row.status, "failed");
  assert(row.error);
  assertEquals(db.ops.filter((o) => o.action === "copy" && o.result === "failed").length, 1);
});

Deno.test("copy: a 429 or throttled error during startCopy leaves the row approved and stops new work", async () => {
  for (const err of [new GraphError(429, ""), new GraphError(429, "throttled"), new GraphError(503, "")]) {
    const db = new FakeDb();
    db.settings.stage = "approved";
    db.plan.set("s1", planRow("s1"));
    db.plan.set("s2", planRow("s2"));
    const g = new FakeGraph();
    g.startCopyError = err;
    const c = clock();
    const r = await runCopy(g, db, c.now() + 10_000, 4, c);
    assertEquals(r.started, 0);
    assert(r.stopped?.includes("throttled"));
    for (const id of ["s1", "s2"]) {
      assertEquals(db.plan.get(id)!.status, "approved");
      assertEquals(db.plan.get(id)!.attempts, 0);
      assertEquals(db.plan.get(id)!.monitor_url, null);
    }
    assertEquals(g.calls.filter((x) => x.startsWith("startCopy")).length, 1, "no new work after throttling");
    assert(db.settings.stage !== "done");
  }
});

Deno.test("copy: a failed copy POST (502) counts as a failed attempt", async () => {
  const db = new FakeDb();
  db.settings.stage = "approved";
  db.plan.set("s1", planRow("s1"));
  const g = new FakeGraph();
  g.startCopyError = new GraphError(502, "");
  const c = clock();
  const r = await runCopy(g, db, c.now() + 1, 4, c);
  assertEquals(r.failed, 1);
  assertEquals(db.plan.get("s1")!.attempts, 1);
  assertEquals(db.plan.get("s1")!.status, "approved");
  assertEquals(db.plan.get("s1")!.error, "Graph request failed (502)");
});

Deno.test("copy: a write guard refusal stops the run and leaves the row approved", async () => {
  const db = new FakeDb();
  db.settings.stage = "approved";
  db.plan.set("s1", planRow("s1"));
  db.plan.set("s2", planRow("s2"));
  const g = new FakeGraph();
  g.startCopyError = new WriteGuardError("target is outside the destination folder");
  const c = clock();
  const r = await runCopy(g, db, c.now() + 10_000, 4, c);
  assert(r.stopped?.includes("write guard"));
  assertEquals(db.plan.get("s1")!.status, "approved");
  assertEquals(db.plan.get("s1")!.attempts, 0);
  assertEquals(db.plan.get("s2")!.status, "approved");
});

Deno.test("copy: destination name exists -> Graph renames; verification uses resourceId", async () => {
  const db = new FakeDb();
  db.settings.stage = "copying";
  db.plan.set("s1", planRow("s1", { status: "copying", monitor_url: "https://monitor.example.invalid/s1" }));
  const g = new FakeGraph();
  g.copyNames.set("s1", "s1 1.pdf"); // renamed by conflictBehavior=rename
  g.complete("s1", "D-renamed", 100, "H-s1");
  const c = clock();
  const r = await runCopy(g, db, c.now() + 10_000, 4, c);
  assertEquals(r.verified, 1);
  assertEquals(db.plan.get("s1")!.status, "verified");
  assertEquals(db.plan.get("s1")!.dest_item_id, "D-renamed");
  assert(g.calls.includes("getItem D-renamed"));
});

Deno.test("copy: hash or size mismatch on the copied item -> failed attempt, never verified", async () => {
  for (const [size, hash] of [[100, "OTHER"], [99, "H-s1"], [100, undefined]] as const) {
    const db = new FakeDb();
    db.settings.stage = "copying";
    db.plan.set("s1", planRow("s1", { status: "copying", monitor_url: "https://monitor.example.invalid/s1" }));
    const g = new FakeGraph();
    g.complete("s1", "D1", size, hash);
    const c = clock();
    const r = await runCopy(g, db, c.now() + 1, 4, c);
    assertEquals(r.verified, 0);
    assertEquals(r.failed, 1);
    const row = db.plan.get("s1")!;
    assert(row.status !== "verified");
    assertEquals(row.attempts, 1);
    assert(row.error?.includes("mismatch"));
    assertEquals(row.dest_item_id, null);
    assertEquals(db.clientFolders.length, 0);
    const op = db.ops.find((o) => o.action === "copy");
    assertEquals(op?.dest_item_id, "D1", "the unverified copy is logged for manual review");
  }
});

Deno.test("copy: deadline in the past -> no new copies started", async () => {
  const db = new FakeDb();
  db.settings.stage = "approved";
  db.plan.set("s1", planRow("s1"));
  const g = new FakeGraph();
  const r = await runCopy(g, db, Date.now() - 1, 4);
  assertEquals(r.started, 0);
  assertEquals(g.calls.filter((x) => x.startsWith("startCopy")).length, 0);
  assertEquals(db.plan.get("s1")!.status, "approved");
});

Deno.test("copy: at most maxInFlight copies in flight", async () => {
  const db = new FakeDb();
  db.settings.stage = "approved";
  for (let i = 1; i <= 7; i++) db.plan.set(`s${i}`, planRow(`s${i}`));
  const g = new FakeGraph();
  const c = clock();
  const r = await runCopy(g, db, c.now() + 10_000, 4, c);
  assertEquals(r.started, 4);
  assertEquals([...db.plan.values()].filter((p) => p.status === "copying").length, 4);
});

Deno.test("copy: a copying row without a monitor URL (run interrupted) counts as a failed attempt", async () => {
  const db = new FakeDb();
  db.settings.stage = "copying";
  db.plan.set("s1", planRow("s1", { status: "copying", monitor_url: null }));
  const g = new FakeGraph();
  const c = clock();
  await runCopy(g, db, c.now() + 1, 4, c);
  assertEquals(db.plan.get("s1")!.attempts, 1);
  assertEquals(db.plan.get("s1")!.status, "approved");
});

// ---------- rollback ----------
Deno.test("rollback recycles only verified rows whose destination still matches; changed ones are skipped", async () => {
  const db = new FakeDb();
  db.settings.stage = "rollback";
  db.plan.set("s1", planRow("s1", { status: "verified", dest_item_id: "D1" }));
  db.plan.set("s2", planRow("s2", { status: "verified", dest_item_id: "D2" }));
  db.plan.set("s3", planRow("s3", { status: "approved" }));
  db.plan.set("s4", planRow("s4", { status: "failed", dest_item_id: "D4" }));
  db.plan.set("s5", planRow("s5", { status: "verified", dest_item_id: "D5", client_id: "CL900002" }));
  const g = new FakeGraph();
  g.items.set("D1", { id: "D1", name: "s1.pdf", size: 100, file: { hashes: { quickXorHash: "H-s1" } } });
  g.items.set("D2", { id: "D2", name: "s2.pdf", size: 100, file: { hashes: { quickXorHash: "EDITED" } } });
  g.items.set("D4", { id: "D4", name: "s4.pdf", size: 100, file: { hashes: { quickXorHash: "H-s4" } } });
  g.items.set("D5", { id: "D5", name: "s5.pdf", size: 100, file: { hashes: { quickXorHash: "H-s5" } } });
  const r = await runRollback(g, db, Date.now() + 60_000, { clientId: "CL900001" });
  assertEquals(r.recycled, 1);
  assertEquals(g.recycled, ["D1"]);
  assertEquals(db.plan.get("s1")!.status, "rolled_back");
  assertEquals(db.plan.get("s2")!.status, "verified");
  assertEquals(db.plan.get("s5")!.status, "verified", "outside the scope");
  assert(db.ops.some((o) => o.source_item_id === "s2" && o.result === "skipped_changed"));
  assert(db.ops.some((o) => o.source_item_id === "s1" && o.result === "rolled_back"));
  assertEquals(db.settings.stage, "paused", "a finished rollback pauses the job");
});

Deno.test("rollback refuses an empty scope and never recycles without a recorded hash", async () => {
  const db = new FakeDb();
  const g = new FakeGraph();
  await assertRejects(() => runRollback(g, db, Date.now() + 60_000, {}));
  db.plan.set("s1", planRow("s1", { status: "verified", dest_item_id: "D1", quickxor_hash: null }));
  g.items.set("D1", { id: "D1", name: "s1.pdf", size: 100, file: {} });
  const r = await runRollback(g, db, Date.now() + 60_000, { all: true });
  assertEquals(r.recycled, 0);
  assertEquals(g.recycled, []);
});

// ---------- error text ----------
Deno.test("errText strips URLs and bearer tokens", () => {
  const t = errText(new Error("bad https://graph.microsoft.com/v1.0/x?token=abc Bearer eyJabc.def"));
  assert(!t.includes("https://"));
  assert(!t.includes("eyJabc"));
});

// ---------- handler ----------
function deps(db: FakeDb, onGraph: () => void) {
  return {
    secret: "s3cret-test",
    db: () => db,
    graph: () => {
      onGraph();
      return new FakeGraph();
    },
  };
}

Deno.test("handler: missing or wrong secret -> 401, no work", async () => {
  const db = new FakeDb();
  let graphMade = 0;
  const d = deps(db, () => graphMade++);
  for (const headers of [{}, { "x-od-copy-secret": "wrong" }] as Record<string, string>[]) {
    const res = await handle(new Request("http://x/", { method: "POST", headers }), d);
    assertEquals(res.status, 401);
    await res.body?.cancel();
  }
  const noSecret = await handle(new Request("http://x/", { method: "POST", headers: { "x-od-copy-secret": "" } }), { ...d, secret: undefined });
  assertEquals(noSecret.status, 401);
  await noSecret.body?.cancel();
  assertEquals(graphMade, 0);
  assertEquals(db.settings.last_run_at, null);
});

Deno.test("handler: stage idle -> { skipped: 'idle' }, no Graph call, last run recorded", async () => {
  for (const stage of ["idle", "paused", "plan", "done"]) {
    const db = new FakeDb();
    db.settings.stage = stage;
    let graphMade = 0;
    const res = await handle(
      new Request("http://x/", { method: "POST", headers: { "x-od-copy-secret": "s3cret-test" } }),
      deps(db, () => graphMade++),
    );
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { skipped: stage });
    assertEquals(graphMade, 0);
    assert(db.settings.last_run_at);
    assertEquals(db.settings.last_run_result, { stage, skipped: stage });
  }
});

Deno.test("handler: rollback reads its scope from settings.rollback_scope", async () => {
  const db = new FakeDb();
  db.settings.stage = "rollback";
  db.settings.rollback_scope = { client_id: "CL900001" };
  db.plan.set("s1", planRow("s1", { status: "verified", dest_item_id: "D1" }));
  const g = new FakeGraph();
  g.items.set("D1", { id: "D1", name: "s1.pdf", size: 100, file: { hashes: { quickXorHash: "H-s1" } } });
  const res = await handle(
    new Request("http://x/", { method: "POST", headers: { "x-od-copy-secret": "s3cret-test" } }),
    { secret: "s3cret-test", db: () => db, graph: () => g },
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).recycled, 1);
  assertEquals(g.recycled, ["D1"]);
});
