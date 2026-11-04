// Restricted Zoho Books client. Only the method and path pairs below can leave the server.
// Reads: organizations, contacts, items, taxes, estimates, invoices. Creates: estimates, invoices.

export class NotAllowedError extends Error {
  constructor(method: string, path: string) {
    super(`Zoho call not allowed: ${method} ${path}`);
    this.name = "NotAllowedError";
  }
}

export class ZohoHttpError extends Error {
  status: number;
  code?: number;
  constructor(status: number, message: string, code?: number) {
    super(message);
    this.name = "ZohoHttpError";
    this.status = status;
    this.code = code;
  }
}

// The token endpoint refused the refresh. The reason is scrubbed and is for the server log only.
export class ZohoAccessError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ZohoAccessError";
  }
}

// The request ran out of time. A create that timed out may still have happened in Zoho.
export class ZohoTimeoutError extends Error {
  constructor() {
    super("Zoho did not answer in time.");
    this.name = "ZohoTimeoutError";
  }
}

const REQUEST_TIMEOUT_MS = 20_000;

const GET_PATHS: RegExp[] = [
  /^\/organizations$/,
  /^\/contacts(\/\d+)?$/,
  /^\/items$/,
  /^\/settings\/taxes$/,
  /^\/estimates(\/\d+)?$/,
  /^\/invoices(\/\d+)?$/,
];
const POST_PATHS: RegExp[] = [/^\/estimates$/, /^\/invoices$/];

export function assertAllowed(method: string, path: string, query: Record<string, string>): void {
  const list = method === "GET" ? GET_PATHS : method === "POST" ? POST_PATHS : [];
  if (!list.some((re) => re.test(path))) throw new NotAllowedError(method, path);
  // A create must never send the document to the customer.
  if (method === "POST" && query.send !== undefined && query.send !== "false") {
    throw new NotAllowedError(method, path);
  }
}

const DATA_CENTRES = ["com", "eu", "in", "com.au", "jp", "ca", "com.cn", "sa", "ae"];

export function hostsFor(dc: string): { accounts: string; api: string } {
  if (!DATA_CENTRES.includes(dc)) throw new Error("Unknown Zoho data centre.");
  return { accounts: `https://accounts.zoho.${dc}`, api: `https://www.zohoapis.${dc}/books/v3` };
}

export function scrub(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) {
    if (!s) continue;
    // Also hide the encoded forms a URL or form body would carry.
    const forms = new Set([s, encodeURIComponent(s), new URLSearchParams({ k: s }).toString().slice(2)]);
    for (const f of forms) out = out.split(f).join("[hidden]");
  }
  return out;
}

export type ZohoConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  orgId: string;
  dc: string;
};

// Cache key for a client. Any setting that changes must change the key. Never log or return it.
export function clientKey(cfg: ZohoConfig): string {
  return JSON.stringify([cfg.clientId, cfg.clientSecret, cfg.refreshToken, cfg.orgId, cfg.dc]);
}

export function createZohoClient(cfg: ZohoConfig, fetchFn: typeof fetch = fetch) {
  const hosts = hostsFor(cfg.dc);
  let token: { value: string; expires: number } | undefined;
  const secrets = () => [cfg.clientSecret, cfg.refreshToken, cfg.clientId, token?.value ?? ""];

  async function send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchFn(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (e) {
      const name = (e as Error)?.name;
      if (name === "TimeoutError" || name === "AbortError") throw new ZohoTimeoutError();
      throw e;
    }
  }

  async function readError(res: Response): Promise<ZohoHttpError> {
    let message = `Zoho returned HTTP ${res.status}`;
    let code: number | undefined;
    try {
      const body = await res.json();
      if (typeof body?.message === "string") message = body.message;
      else if (typeof body?.error === "string") message = body.error;
      if (typeof body?.code === "number") code = body.code;
    } catch { /* body was not JSON */ }
    return new ZohoHttpError(res.status, scrub(message, secrets()), code);
  }

  let inflight: Promise<string> | undefined;

  async function refresh(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: cfg.refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    });
    // A redirect could carry the secrets to another host, so it is an error.
    const res = await send(`${hosts.accounts}/oauth/v2/token`, { method: "POST", body, redirect: "error" });
    if (!res.ok) {
      const err = await readError(res);
      // A rate limit or outage is not a lost connection. Only a refusal means reconnect.
      if (res.status === 429 || res.status >= 500) throw err;
      throw new ZohoAccessError(err.message);
    }
    const json = await res.json().catch(() => ({}));
    if (typeof json?.error === "string" || typeof json?.access_token !== "string") {
      const reason = typeof json?.error === "string" ? json.error : "Zoho token refresh returned no access token.";
      const clean = scrub(reason, secrets());
      // Zoho can report a rate limit inside a 200 reply.
      if (/too many requests/i.test(reason)) throw new ZohoHttpError(429, clean);
      throw new ZohoAccessError(clean);
    }
    const secs = typeof json.expires_in === "number" ? json.expires_in : 3600;
    token = { value: json.access_token, expires: Date.now() + secs * 1000 };
    return token.value;
  }

  // Parallel calls share one refresh. A failure is not kept, so the next call retries.
  function accessToken(): Promise<string> {
    if (token && token.expires > Date.now() + 60_000) return Promise.resolve(token.value);
    inflight ??= refresh().finally(() => {
      inflight = undefined;
    });
    return inflight;
  }

  async function call(
    method: "GET" | "POST",
    path: string,
    query: Record<string, string>,
    body?: unknown,
  ) {
    const q: Record<string, string> = { ...query };
    if (method === "POST") q.send = "false";
    assertAllowed(method, path, q);
    const url = new URL(hosts.api + path);
    for (const [k, v] of Object.entries(q)) url.searchParams.set(k, v);
    url.searchParams.set("organization_id", cfg.orgId);
    const headers: Record<string, string> = { Authorization: `Zoho-oauthtoken ${await accessToken()}` };
    const init: RequestInit = { method, headers, redirect: "error" };
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body ?? {});
    }
    const res = await send(url.toString(), init);
    if (!res.ok) throw await readError(res);
    // A 2xx reply that is not JSON is not shown as raw text.
    return await res.json().catch(() => {
      throw new Error("Zoho sent a reply that could not be read.");
    });
  }

  return {
    get: (path: string, query: Record<string, string> = {}) => call("GET", path, query),
    post: (path: string, body: unknown, query: Record<string, string> = {}) =>
      call("POST", path, query, body),
  };
}
