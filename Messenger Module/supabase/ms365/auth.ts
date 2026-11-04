// Microsoft sign-in logic: signed state, PKCE, authorize URL, ID token reading.
// No network and no database. WebCrypto only.

export const PHASE2_SCOPES = ["openid", "profile", "offline_access", "User.Read"];

const STATE_MAX_AGE_MS = 10 * 60_000;
const STATE_FUTURE_SKEW_MS = 60_000;
const enc = new TextEncoder();
const dec = new TextDecoder();

export class StateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateError";
  }
}

export class IdTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdTokenError";
  }
}

function toB64u(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Returns null for anything that is not strict base64url.
function fromB64u(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) return null;
  try {
    const std = text.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(std + "=".repeat((4 - (std.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function hmacKey(key: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

async function hmac(key: string, data: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(key, "sign"), enc.encode(data)));
}

export async function signState(key: string, profileId: string, now: number): Promise<string> {
  const nonce = toB64u(crypto.getRandomValues(new Uint8Array(16)));
  const payload = toB64u(enc.encode(JSON.stringify({ p: profileId, n: nonce, t: now })));
  return `${payload}.${toB64u(await hmac(key, payload))}`;
}

export async function verifyState(key: string, state: string, now: number): Promise<{ profileId: string; nonce: string }> {
  if (typeof state !== "string") throw new StateError("Sign-in state is missing.");
  const parts = state.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new StateError("Sign-in state is malformed.");
  const [payload, sig] = parts;
  const sigBytes = fromB64u(sig);
  if (!sigBytes) throw new StateError("Sign-in state is malformed.");
  // crypto.subtle.verify compares in constant time.
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(key, "verify"), sigBytes, enc.encode(payload));
  if (!ok) throw new StateError("Sign-in state signature is not valid.");

  const bytes = fromB64u(payload);
  let body: unknown;
  try {
    body = bytes ? JSON.parse(dec.decode(bytes)) : null;
  } catch {
    body = null;
  }
  const b = body as { p?: unknown; n?: unknown; t?: unknown } | null;
  if (!b || typeof b !== "object" || typeof b.p !== "string" || typeof b.n !== "string" || typeof b.t !== "number") {
    throw new StateError("Sign-in state is malformed.");
  }
  if (now - b.t > STATE_MAX_AGE_MS || b.t - now > STATE_FUTURE_SKEW_MS) {
    throw new StateError("Sign-in state has expired. Start the sign-in again.");
  }
  return { profileId: b.p, nonce: b.n };
}

export async function pkceFrom(key: string, nonce: string): Promise<{ verifier: string; challenge: string }> {
  const verifier = toB64u(await hmac(key, `pkce:${nonce}`));
  const challenge = toB64u(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier))));
  return { verifier, challenge };
}

export function authorizeUrl(
  cfg: { tenantId: string; clientId: string; redirectUri: string },
  state: string,
  challenge: string,
  scopes: string[],
): string {
  const u = new URL(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/authorize`);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("response_mode", "query");
  u.searchParams.set("scope", scopes.join(" "));
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

// No signature check: the token comes straight from Microsoft's token endpoint over TLS.
export function readIdToken(idToken: string): { tid: string; oid: string; email: string } {
  const parts = typeof idToken === "string" ? idToken.split(".") : [];
  if (parts.length !== 3) throw new IdTokenError("ID token is malformed: expected three parts.");
  const bytes = fromB64u(parts[1]);
  if (!bytes) throw new IdTokenError("ID token is malformed: payload is not base64url.");
  let claims: Record<string, unknown> | null;
  try {
    claims = JSON.parse(dec.decode(bytes));
  } catch {
    throw new IdTokenError("ID token is malformed: payload is not JSON.");
  }
  if (!claims || typeof claims !== "object") throw new IdTokenError("ID token is malformed: payload is not an object.");
  const { tid, oid, preferred_username: email } = claims;
  for (const [name, v] of [["tid", tid], ["oid", oid], ["preferred_username", email]] as const) {
    if (typeof v !== "string" || !v) throw new IdTokenError(`ID token is missing ${name}.`);
  }
  return { tid: tid as string, oid: oid as string, email: email as string };
}

export function linkStatus(microsoftEmail: string, profileEmail: string | null): "active" | "review" {
  if (!profileEmail) return "review";
  return microsoftEmail.trim().toLowerCase() === profileEmail.trim().toLowerCase() ? "active" : "review";
}
