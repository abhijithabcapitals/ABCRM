// Microsoft Graph client for one person. Refreshes the access token on demand and
// retries once on 401 and once on 429. Only paths on graph.microsoft.com are allowed,
// so a token can never be sent to another host. Errors never carry URLs or tokens.

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const MAX_SLEEP_MS = 10_000;
const DEFAULT_SLEEP_MS = 1_000;
const EXPIRY_SKEW_MS = 60_000;

export class NotConnectedError extends Error {
  constructor(message = "Microsoft 365 is not connected.") {
    super(message);
    this.name = "NotConnectedError";
  }
}

export class GraphError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? `Microsoft Graph request failed (${code}).`);
    this.name = "GraphError";
    this.status = status;
    this.code = code;
  }
}

export interface GraphDeps {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  loadToken(): Promise<string | null>;
  saveToken(t: string): Promise<void>;
  onRevoked(): Promise<void>;
  log(e: { action: string; status: string; error_code?: string }): Promise<void>;
  fetch: typeof fetch;
  sleep(ms: number): Promise<void>;
}

// A single leading slash and nothing that browsers or URL parsers treat as a host.
function checkPath(path: unknown): string {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\") || /[\s\u0000-\u001f\u007f]/.test(path)) {
    throw new GraphError(0, "bad_path", "Graph path must start with a single / and contain no spaces.");
  }
  const url = new URL(GRAPH_BASE + path);
  if (url.origin !== "https://graph.microsoft.com") throw new GraphError(0, "bad_path", "Graph path must stay on graph.microsoft.com.");
  return url.toString();
}

function retryDelayMs(header: string | null): number {
  const secs = header !== null && /^\d+$/.test(header.trim()) ? Number(header.trim()) : NaN;
  return Number.isFinite(secs) ? Math.min(secs * 1000, MAX_SLEEP_MS) : DEFAULT_SLEEP_MS;
}

// Reads a body as JSON. Returns undefined when it is not JSON.
async function readJson(res: Response): Promise<unknown | undefined> {
  let text: string;
  try {
    text = await res.text();
  } catch {
    return undefined;
  }
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function createGraph(deps: GraphDeps): { request(method: string, path: string, body?: unknown): Promise<any> } {
  let access: { token: string; expiresAt: number } | null = null;
  let refreshing: Promise<string> | null = null;

  async function log(action: string, status: string, error_code?: string): Promise<void> {
    try {
      await deps.log(error_code ? { action, status, error_code } : { action, status });
    } catch {
      // Logging must never break a request.
    }
  }

  async function post(url: string, init: RequestInit): Promise<Response> {
    try {
      return await deps.fetch(url, init);
    } catch {
      // The original error can hold the URL or a token, so it is dropped.
      throw new GraphError(0, "network_error", "Could not reach Microsoft.");
    }
  }

  async function doRefresh(): Promise<string> {
    const stored = await deps.loadToken();
    if (!stored) throw new NotConnectedError();
    const form = new URLSearchParams({
      client_id: deps.clientId,
      client_secret: deps.clientSecret,
      grant_type: "refresh_token",
      refresh_token: stored,
    });
    let res: Response;
    try {
      res = await post(deps.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: form.toString(),
      });
    } catch (e) {
      await log("token_refresh", "error", (e as GraphError).code);
      throw e;
    }
    const data = await readJson(res) as Record<string, unknown> | null | undefined;
    const obj = data && typeof data === "object" ? data : null;
    const errCode = obj && typeof obj.error === "string" ? obj.error : undefined;

    if (errCode === "invalid_grant") {
      access = null;
      await log("token_refresh", "revoked", "invalid_grant");
      await deps.onRevoked();
      throw new NotConnectedError("Microsoft 365 sign-in is no longer valid. Connect again.");
    }
    if (!res.ok || errCode) {
      const code = errCode ?? `http_${res.status}`;
      await log("token_refresh", "error", code);
      throw new GraphError(res.status, code, "Microsoft sign-in refresh failed.");
    }
    const token = obj?.access_token;
    if (typeof token !== "string" || !token) {
      await log("token_refresh", "error", "bad_response");
      throw new GraphError(res.status, "bad_response", "Microsoft sign-in returned an unexpected reply.");
    }
    const expiresIn = typeof obj?.expires_in === "number" ? obj.expires_in : 3600;
    access = { token, expiresAt: Date.now() + expiresIn * 1000 - EXPIRY_SKEW_MS };
    // No new refresh token in the reply means the stored one stays valid.
    const rotated = obj?.refresh_token;
    if (typeof rotated === "string" && rotated && rotated !== stored) await deps.saveToken(rotated);
    await log("token_refresh", "ok");
    return token;
  }

  // One refresh at a time, even if requests overlap.
  function refresh(): Promise<string> {
    refreshing ??= doRefresh().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function accessToken(): Promise<string> {
    if (access && access.expiresAt > Date.now()) return access.token;
    return await refresh();
  }

  async function send(url: string, method: string, body: unknown): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${await accessToken()}`, Accept: "application/json" };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return await post(url, init);
  }

  async function request(method: string, path: string, body?: unknown): Promise<any> {
    const url = checkPath(path);
    let res: Response;
    try {
      res = await send(url, method, body);
      if (res.status === 401) {
        access = null;
        res = await send(url, method, body);
      }
      if (res.status === 429) {
        await deps.sleep(retryDelayMs(res.headers.get("Retry-After")));
        res = await send(url, method, body);
      }
    } catch (e) {
      if (e instanceof GraphError) await log("graph_request", "error", e.code);
      throw e;
    }

    const data = res.status === 204 ? null : await readJson(res);
    if (!res.ok) {
      const inner = data && typeof data === "object" ? (data as { error?: unknown }).error : undefined;
      const innerCode = inner && typeof inner === "object" ? (inner as { code?: unknown }).code : undefined;
      const code = typeof innerCode === "string" && innerCode ? innerCode : `http_${res.status}`;
      await log("graph_request", "error", code);
      throw new GraphError(res.status, code);
    }
    if (data === undefined) {
      await log("graph_request", "error", "bad_response");
      throw new GraphError(res.status, "bad_response", "Microsoft Graph returned a reply that is not JSON.");
    }
    await log("graph_request", "ok");
    return data;
  }

  return { request };
}
