// Microsoft Entra app-only sign-in with a certificate (signed JWT client assertion) and Graph retry
// timing. Helpers are copied from the email-archive function (branch email-onedrive-archive); this
// module imports nothing from other branches. No secrets are logged or put in error messages.

const enc = new TextEncoder();

export function toB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function toB64u(bytes: Uint8Array): string {
  return toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// SHA-1 certificate thumbprint as shown in Entra ("A1B2..."), to the JWT `x5t` value.
export function thumbprintToX5t(hex: string): string {
  const clean = hex.replace(/[\s:]/g, "");
  if (!/^[0-9a-fA-F]{40}$/.test(clean)) throw new Error("certificate thumbprint must be 40 hex characters (SHA-1)");
  const bytes = new Uint8Array(20);
  for (let i = 0; i < 20; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return toB64u(bytes);
}

// PKCS#8 PEM ("BEGIN PRIVATE KEY") to DER bytes. PKCS#1 ("BEGIN RSA PRIVATE KEY") is refused with
// the command that converts it.
export function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const text = pem.replace(/\\n/g, "\n");
  if (/BEGIN RSA PRIVATE KEY/.test(text)) {
    throw new Error("private key is PKCS#1; convert it: openssl pkcs8 -topk8 -nocrypt -in key.pem -out key.pk8.pem");
  }
  if (/BEGIN ENCRYPTED PRIVATE KEY/.test(text)) throw new Error("private key must not be password-protected");
  const m = text.match(/-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/);
  // The Supabase CLI keeps only the first line of a multi-line secret, so the key may also be given
  // as one line: the PEM body (base64 of the PKCS#8 DER) without the BEGIN/END lines.
  const body = m ? m[1] : /^[A-Za-z0-9+/=\s]{200,}$/.test(text.trim()) ? text : null;
  if (!body) throw new Error("private key must be PKCS#8: a PEM (-----BEGIN PRIVATE KEY-----) or its base64 body on one line");
  const bin = atob(body.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function tokenUrl(tenantId: string): string {
  if (!/^[0-9a-zA-Z.-]+$/.test(tenantId)) throw new Error("tenant id has unexpected characters");
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
}

// The unsigned JWT parts for a client assertion, valid for 10 minutes.
export function assertionParts(opts: { tenantId: string; clientId: string; x5t: string; nowSec: number; jti: string }): {
  header: Record<string, string>;
  payload: Record<string, string | number>;
} {
  return {
    header: { alg: "RS256", typ: "JWT", x5t: opts.x5t },
    payload: {
      aud: tokenUrl(opts.tenantId),
      iss: opts.clientId,
      sub: opts.clientId,
      jti: opts.jti,
      nbf: opts.nowSec - 60,
      iat: opts.nowSec,
      exp: opts.nowSec + 600,
    },
  };
}

export async function signAssertion(
  key: CryptoKey,
  parts: { header: Record<string, string>; payload: Record<string, string | number> },
): Promise<string> {
  const input = `${toB64u(enc.encode(JSON.stringify(parts.header)))}.${toB64u(enc.encode(JSON.stringify(parts.payload)))}`;
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(input)));
  return `${input}.${toB64u(sig)}`;
}

export function importSigningKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", pemToPkcs8(pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

// ---------- Graph retry timing ----------

export function isRetryable(status: number): boolean {
  return status === 429 || status === 503 || status === 502 || status === 504;
}

// Milliseconds to wait: the Retry-After header when present (seconds or HTTP date), else a capped
// backoff. Never more than maxMs, so a run stays inside its time budget.
export function retryDelayMs(retryAfter: string | null, attempt: number, nowMs: number, maxMs = 30_000): number {
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, maxMs);
    const at = Date.parse(retryAfter);
    if (!Number.isNaN(at)) return Math.min(Math.max(at - nowMs, 0), maxMs);
  }
  return Math.min(1000 * 2 ** attempt, maxMs);
}

// ---------- access token ----------

export type MsEnv = { tenantId: string; clientId: string; thumbprint: string; privateKeyPem: string };

const cache = new Map<string, { value: string; expires: number }>();

export function clearTokenCache(): void {
  cache.clear();
}

// Client-credentials token for Graph, cached until 60 s before it expires. The cache key holds no
// secret: tenant, client and thumbprint only.
export async function getToken(env: MsEnv, fetchFn: typeof fetch = fetch, now: () => number = Date.now): Promise<string> {
  const k = `${env.tenantId}|${env.clientId}|${env.thumbprint}`;
  const hit = cache.get(k);
  if (hit && hit.expires > now() + 60_000) return hit.value;
  const key = await importSigningKey(env.privateKeyPem);
  const assertion = await signAssertion(
    key,
    assertionParts({
      tenantId: env.tenantId,
      clientId: env.clientId,
      x5t: thumbprintToX5t(env.thumbprint),
      nowSec: Math.floor(now() / 1000),
      jti: crypto.randomUUID(),
    }),
  );
  const res = await fetchFn(tokenUrl(env.tenantId), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.clientId,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: assertion,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`Microsoft sign-in failed (${res.status}): ${body.error ?? ""} ${String(body.error_description ?? "").split("\n")[0]}`.trim());
  }
  const value = String(body.access_token);
  cache.set(k, { value, expires: now() + Number(body.expires_in ?? 3000) * 1000 });
  return value;
}
