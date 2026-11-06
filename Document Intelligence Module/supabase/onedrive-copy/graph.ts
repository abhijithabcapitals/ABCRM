// Microsoft Graph client for the OneDrive copy job. Every write (create folder, copy into, recycle)
// goes through assertUnderDestination, so nothing outside the destination folder can change.

import { isRetryable, retryDelayMs } from "./msauth.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";
const MAX_ATTEMPTS = 5;
const DELTA_SELECT = "id,name,size,file,folder,parentReference,lastModifiedDateTime,deleted,root";

export type DriveItem = {
  id: string;
  name: string;
  size?: number;
  file?: { hashes?: { quickXorHash?: string } };
  folder?: object;
  parentReference?: { path?: string; id?: string };
  lastModifiedDateTime?: string;
  deleted?: object;
  root?: object; // only on the drive root item
  remoteItem?: object;
  webUrl?: string;
};

export type CopyStatus = { status: "inProgress" | "completed" | "failed"; resourceId?: string; error?: string };

// Messages hold the status and Graph's error code only: no URL, header or token.
export class GraphError extends Error {
  constructor(public status: number, public code: string) {
    super(`Graph request failed (${status}${code ? `: ${code}` : ""})`);
    this.name = "GraphError";
  }
}

export class WriteGuardError extends Error {
  constructor(reason: string) {
    super(`write guard: ${reason}`);
    this.name = "WriteGuardError";
  }
}

// A file (not a folder) already holds the name of a folder the target path needs. Only that row cannot be copied;
// it is not a safety stop. The message carries no names.
export class FolderBlockedError extends Error {
  constructor() {
    super("a file is in the way of a destination folder this path needs");
    this.name = "FolderBlockedError";
  }
}

// Folder names of a Graph path, decoded and lower-cased (OneDrive is case-insensitive). Accepts
// "/drive/root:/A/B", "/drives/{id}/root:/A/B" and a plain "A/B". "/drive/root:" gives [].
export function pathSegments(path: string): string[] {
  const i = path.indexOf("root:");
  const rest = i >= 0 ? path.slice(i + 5) : path;
  return rest.split("/").filter((s) => s.length > 0).map((s) => {
    let d = s;
    try {
      d = decodeURIComponent(s);
    } catch { /* keep raw */ }
    return d.normalize("NFC").toLowerCase();
  });
}

// True when `path` is the root or lies below it, comparing whole segments (so a sibling named
// "<root> OLD" is not under "<root>"). A "." or ".." segment never counts.
export function isUnderPath(path: string | undefined, rootPath: string): boolean {
  if (!path) return false;
  const root = pathSegments(rootPath);
  if (root.length === 0) return false;
  const segs = pathSegments(path);
  if (segs.some((s) => s === "." || s === "..")) return false;
  if (segs.length < root.length) return false;
  return root.every((s, i) => segs[i] === s);
}

export type GraphOptions = {
  token: () => Promise<string>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  driveId: string;
  destRootId: string;
  destRootPath: string;
};

type SendInit = { body?: unknown; auth?: boolean; okStatuses?: number[]; redirectManual?: boolean; retryOn?: number[] };

const MAX_WAIT_MS = 30_000;

export class Graph {
  private readonly o: GraphOptions;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly drive: string;
  // Folder ids known to be inside the destination: created or read during this run.
  private readonly safeIds = new Set<string>();
  private readonly folderIds = new Map<string, string>();
  private rootVerified = false;

  constructor(opts: GraphOptions) {
    if (pathSegments(opts.destRootPath).length === 0) throw new Error("destRootPath must name a folder below the drive root");
    this.o = opts;
    this.fetchFn = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.drive = `${GRAPH}/drives/${encodeURIComponent(opts.driveId)}`;
  }

  // One HTTP call with retry on 429/502/503/504 (Retry-After honoured, 5 attempts). Returns the
  // response when its status is 2xx or listed in okStatuses; otherwise throws GraphError.
  private async send(method: string, url: string, init: SendInit = {}): Promise<Response> {
    if (init.auth !== false && !url.startsWith(`${GRAPH}/`)) throw new Error("refusing to send credentials to a non-Graph URL");
    for (let attempt = 0;; attempt++) {
      const headers: Record<string, string> = {};
      if (init.auth !== false) headers.Authorization = `Bearer ${await this.o.token()}`;
      let body: string | undefined;
      if (init.body !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(init.body);
      }
      const res = await this.fetchFn(url, { method, headers, body, ...(init.redirectManual ? { redirect: "manual" as const } : {}) });
      const retryable = init.retryOn ? init.retryOn.includes(res.status) : isRetryable(res.status);
      if (retryable && attempt < MAX_ATTEMPTS - 1) {
        await res.body?.cancel();
        const wait = retryDelayMs(res.headers.get("Retry-After"), attempt, Date.now(), Number.POSITIVE_INFINITY);
        // Never wait a shortened time: tell the caller to stop taking work instead.
        if (wait > MAX_WAIT_MS) throw new GraphError(res.status, "throttled");
        await this.sleep(wait);
        continue;
      }
      if (res.ok || init.okStatuses?.includes(res.status)) return res;
      let code = "";
      try {
        code = String((await res.json())?.error?.code ?? "");
      } catch { /* no JSON body */ }
      throw new GraphError(res.status, code);
    }
  }

  private async json<T>(method: string, url: string, init?: SendInit): Promise<T> {
    const res = await this.send(method, url, init);
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  private itemUrl(id: string): string {
    return `${this.drive}/items/${encodeURIComponent(id)}`;
  }

  async getItem(itemId: string): Promise<DriveItem> {
    return await this.json<DriveItem>("GET", this.itemUrl(itemId));
  }

  // Delta of the whole drive: OneDrive for Business supports delta only on the drive root, not on a folder. The
  // caller keeps only the items below the source folder. Each page carries nextLink (more pages follow) or deltaLink
  // (the last page). Either one can be stored and passed back as `deltaLink` to resume: both are Graph URLs and are
  // checked as such. Delta on OneDrive for Business gives no parentReference.path: items are tracked by parent id.
  async *delta(deltaLink?: string): AsyncGenerator<{ items: DriveItem[]; deltaLink?: string; nextLink?: string }> {
    let url = deltaLink ?? `${this.drive}/root/delta?$select=${DELTA_SELECT}`;
    while (true) {
      const page = await this.json<{ value?: DriveItem[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string }>("GET", url);
      const next = page["@odata.nextLink"];
      yield { items: page.value ?? [], deltaLink: page["@odata.deltaLink"], nextLink: next };
      if (!next) return;
      url = next;
    }
  }

  // The destination root id comes from configuration, so it is proven once before it is trusted:
  // its own path must equal destRootPath exactly (same segments, same count).
  private async verifyRoot(): Promise<void> {
    if (this.rootVerified) return;
    const item = await this.getItem(this.o.destRootId);
    if (item.remoteItem) throw new WriteGuardError("destination root is a shortcut");
    const want = pathSegments(this.o.destRootPath);
    const got = pathSegments(`${item.parentReference?.path ?? ""}/${encodeURIComponent(item.name ?? "")}`);
    if (!item.parentReference?.path || got.length !== want.length || !want.every((x, i) => got[i] === x)) {
      throw new WriteGuardError("destination root id does not match the destination path");
    }
    this.rootVerified = true;
    this.safeIds.add(this.o.destRootId);
  }

  // The write guard. The item must be the (verified) destination root or lie inside it; with
  // strict it must lie strictly deeper than the root. An item's own path is its
  // parentReference.path plus its name. Shortcuts and remote items are refused.
  async assertUnderDestination(itemId: string, strict = false): Promise<void> {
    if (itemId === this.o.destRootId) {
      if (strict) throw new WriteGuardError("the destination root itself is not allowed here");
      return await this.verifyRoot();
    }
    if (this.safeIds.has(itemId)) return;
    await this.verifyRoot();
    const item = await this.getItem(itemId);
    if (item.remoteItem) throw new WriteGuardError("target is a shortcut or remote item");
    const parent = item.parentReference?.path;
    if (!parent) throw new WriteGuardError("item has no path; cannot prove it is inside the destination");
    const own = `${parent}/${encodeURIComponent(item.name ?? "")}`;
    if (!isUnderPath(own, this.o.destRootPath) || pathSegments(own).length <= pathSegments(this.o.destRootPath).length) {
      throw new WriteGuardError("target is outside the destination folder");
    }
    this.safeIds.add(itemId);
  }

  async ensureFolder(relPath: string): Promise<string> {
    const segs = relPath.split("/").map((x) => x.trim());
    if (segs.some((x) => x === "" || x === "." || x === "..")) throw new Error("folder path has an empty or dot segment");
    let parentId = this.o.destRootId;
    let key = "";
    for (const name of segs) {
      key = key ? `${key}/${name.toLowerCase()}` : name.toLowerCase();
      const cached = this.folderIds.get(key);
      if (cached) {
        parentId = cached;
        continue;
      }
      await this.assertUnderDestination(parentId);
      const res = await this.send("POST", `${this.itemUrl(parentId)}/children`, {
        body: { name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" },
        okStatuses: [409],
      });
      let id: string;
      if (res.status === 409) {
        await res.body?.cancel();
        const existing = await this.json<DriveItem>("GET", `${this.itemUrl(parentId)}:/${encodeURIComponent(name)}`);
        if (existing.remoteItem) throw new WriteGuardError("existing destination entry is a shortcut or remote item");
        if (!existing.folder) throw new FolderBlockedError();
        id = existing.id;
      } else {
        id = (JSON.parse(await res.text()) as DriveItem).id;
      }
      this.safeIds.add(id);
      this.folderIds.set(key, id);
      parentId = id;
    }
    return parentId;
  }

  async startCopy(sourceId: string, destParentId: string, name: string): Promise<string> {
    await this.assertUnderDestination(destParentId);
    const res = await this.send("POST", `${this.itemUrl(sourceId)}/copy?@microsoft.graph.conflictBehavior=rename`, {
      body: { parentReference: { driveId: this.o.driveId, id: destParentId }, name },
      retryOn: [429, 503], // copy is not idempotent: no retry on 502/504
    });
    await res.body?.cancel();
    const loc = res.headers.get("Location");
    if (!loc) throw new GraphError(res.status, "noMonitorUrl");
    return loc;
  }

  // The monitor URL is pre-authorised by Microsoft: sending our bearer token to it would leak it.
  async pollCopy(monitorUrl: string): Promise<CopyStatus> {
    if (!monitorUrl.startsWith("https://")) throw new Error("monitor URL must be https");
    const res = await this.send("GET", monitorUrl, { auth: false, redirectManual: true, okStatuses: [303] });
    if (res.status === 303) {
      await res.body?.cancel();
      const m = (res.headers.get("Location") ?? "").match(/\/items\/([^/?:]+)/);
      return m ? { status: "completed", resourceId: decodeURIComponent(m[1]) } : { status: "completed" };
    }
    const b = JSON.parse((await res.text()) || "{}") as { status?: string; resourceId?: string; error?: { code?: string } | string };
    if (b.status === "completed") return { status: "completed", resourceId: b.resourceId };
    if (b.status === "failed") {
      const err = typeof b.error === "string" ? b.error : b.error?.code;
      return { status: "failed", error: err ?? "unknown" };
    }
    return { status: "inProgress" };
  }

  async recycle(itemId: string): Promise<void> {
    await this.assertUnderDestination(itemId, true);
    const res = await this.send("DELETE", this.itemUrl(itemId));
    await res.body?.cancel();
  }
}
