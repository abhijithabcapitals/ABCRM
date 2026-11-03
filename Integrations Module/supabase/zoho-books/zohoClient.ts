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
  for (const s of secrets) if (s) out = out.split(s).join("[hidden]");
  return out;
}

export type ZohoConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  orgId: string;
  dc: string;
};

export function createZohoClient(cfg: ZohoConfig, fetchFn: typeof fetch = fetch) {
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

  async function accessToken(): Promise<string> {
    if (token && token.expires > Date.now() + 60_000) return token.value;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: cfg.refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    });
    const res = await fetchFn(`${hosts.accounts}/oauth/v2/token`, { method: "POST", body });
    if (!res.ok) throw await readError(res);
    const json = await res.json().catch(() => ({}));
    if (typeof json?.access_token !== "string") {
      throw new ZohoHttpError(res.status, "Zoho token refresh returned no access token.");
    }
    const secs = typeof json.expires_in === "number" ? json.expires_in : 3600;
    token = { value: json.access_token, expires: Date.now() + secs * 1000 };
    return token.value;
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
    const init: RequestInit = { method, headers };
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body ?? {});
    }
    const res = await fetchFn(url.toString(), init);
    if (!res.ok) throw await readError(res);
    return await res.json();
  }

  return {
    get: (path: string, query: Record<string, string> = {}) => call("GET", path, query),
    post: (path: string, body: unknown, query: Record<string, string> = {}) =>
      call("POST", path, query, body),
  };
}
