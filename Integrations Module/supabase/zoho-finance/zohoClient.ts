// Read-only Zoho Books client for the financial cards. Only the GET paths below can leave the server.
// The one POST in this file is the token refresh sent to the Zoho accounts host.

export class NotAllowedError extends Error {
  constructor(method: string, path: string) {
    super(`Zoho call not allowed: ${method} ${path}`);
    this.name = "NotAllowedError";
  }
}

export class ZohoTimeoutError extends Error {
  constructor() {
    super("Zoho did not answer in time.");
    this.name = "ZohoTimeoutError";
  }
}

// Zoho's rate limit is HTTP 429, or code 44 or 45 in the body, which can arrive with another status or even a 200.
export const isRateLimit = (e: unknown): boolean =>
  e instanceof ZohoHttpError && (e.status === 429 || e.code === 44 || e.code === 45);

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

const GET_PATHS: RegExp[] = [
  /^\/organizations$/,
  /^\/invoices$/,
  /^\/bills$/,
  /^\/bankaccounts$/,
  /^\/chartofaccounts$/,
  // Both transaction paths are allowed for the probe only. One is removed once the live probe has run.
  /^\/chartofaccounts\/transactions$/,
  /^\/chartofaccounts\/accounttransactions$/,
  /^\/expenses$/,
];

export function assertAllowed(method: string, path: string): void {
  if (method !== "GET" || !GET_PATHS.some((re) => re.test(path))) throw new NotAllowedError(method, path);
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

// A hung call must not outlast the 150-second function limit. refresh.ts stops new calls at 125 s, so 125 + 20 stays under it.
export const REQUEST_TIMEOUT_MS = 20_000;

export function createFinanceClient(cfg: ZohoConfig, fetchFn: typeof fetch = fetch) {
  const fetchWithTimeout = async (url: string, init: RequestInit): Promise<Response> => {
    try {
      return await fetchFn(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (e) {
      if ((e as Error)?.name === "TimeoutError") throw new ZohoTimeoutError();
      throw e;
    }
  };

  const hosts = hostsFor(cfg.dc);
  let token: { value: string; expires: number } | undefined;
  const secrets = () => [cfg.clientSecret, cfg.refreshToken, cfg.clientId, token?.value ?? ""];

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
    const res = await fetchWithTimeout(`${hosts.accounts}/oauth/v2/token`, { method: "POST", body, redirect: "error" });
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

  async function call(path: string, query: Record<string, string>) {
    assertAllowed("GET", path);
    const url = new URL(hosts.api + path);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    url.searchParams.set("organization_id", cfg.orgId);
    const headers: Record<string, string> = { Authorization: `Zoho-oauthtoken ${await accessToken()}` };
    const res = await fetchWithTimeout(url.toString(), { method: "GET", headers, redirect: "error" });
    if (!res.ok) throw await readError(res);
    const body = await res.json();
    if (body?.code === 44 || body?.code === 45) {
      throw new ZohoHttpError(res.status, scrub(typeof body.message === "string" ? body.message : "Zoho rate limit.", secrets()), body.code);
    }
    return body;
  }

  return {
    get: (path: string, query: Record<string, string> = {}) => call(path, query),
  };
}
