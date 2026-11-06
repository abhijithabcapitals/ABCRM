// Pure helpers for the email-archive Edge Function: SharePoint paths, quickXorHash,
// the certificate client assertion for Microsoft Entra, and Graph retry timing.
// No network and no database here, so every part can be tested offline.

const enc = new TextEncoder();

// ---------- SharePoint paths ----------

// Characters SharePoint and OneDrive refuse in a file or folder name.
const BAD_CHARS = /["*:<>?\/\\|\u0000-\u001f\u007f]/g;
// Names SharePoint refuses whatever the extension.
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d|desktop\.ini|\.lock|_vti_)$/i;
export const MAX_SEGMENT = 120;

// Makes one path segment safe for SharePoint. Keeps the extension when shortening.
export function safeSegment(raw: string): string {
  let s = raw.normalize("NFC").replace(BAD_CHARS, "_").replace(/_vti_/gi, "_vti-");
  s = s.replace(/^[\s.]+/, "").replace(/[\s.]+$/, "");
  if (!s) s = "_";
  const stem = s.replace(/\.[^.]*$/, "");
  if (RESERVED.test(s) || RESERVED.test(stem)) s = `_${s}`;
  if (s.length > MAX_SEGMENT) {
    const dot = s.lastIndexOf(".");
    const ext = dot > 0 && s.length - dot <= 16 ? s.slice(dot) : "";
    s = s.slice(0, MAX_SEGMENT - ext.length).replace(/[\s.]+$/, "") + ext;
  }
  return s;
}

// Storage path `<mailbox_id>/<folder>/<uidvalidity>/<uid>/...` becomes
// `<root>/<mailbox address>/<folder>/<uidvalidity>/<uid>/...` in the library.
export function sharePointPath(root: string, storagePath: string, mailboxName: string | undefined): string {
  const parts = storagePath.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) throw new Error("empty storage path");
  if (mailboxName) parts[0] = mailboxName;
  const rootParts = root.split("/").filter((p) => p.length > 0);
  return [...rootParts, ...parts].map(safeSegment).join("/");
}

// Path form for `/drives/{id}/root:/{path}:`. Each segment is percent-encoded.
export function encodeDrivePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

// ---------- quickXorHash (OneDrive for Business / SharePoint file hash) ----------

// Byte i is XORed into the 160-bit state at bit (i * 11) mod 160, then the length (int64,
// little-endian) is XORed into the last 8 bytes. Positions repeat every 160 bytes, so bytes are
// first folded into 160 buckets. Returns base64, as Graph's file.hashes.quickXorHash does.
export function quickXorHash(data: Uint8Array): string {
  const fold = new Uint8Array(160);
  const n = data.length;
  for (let start = 0; start < n; start += 160) {
    const end = Math.min(start + 160, n);
    for (let i = start, p = 0; i < end; i++, p++) fold[p] ^= data[i];
  }
  const out = new Uint8Array(20);
  for (let p = 0; p < 160; p++) {
    const b = fold[p];
    if (b === 0) continue;
    const bit = (p * 11) % 160;
    const v = b << (bit & 7);
    const idx = bit >> 3;
    out[idx] ^= v & 0xff;
    out[(idx + 1) % 20] ^= v >> 8;
  }
  let len = BigInt(n);
  for (let i = 0; i < 8; i++) {
    out[12 + i] ^= Number(len & 0xffn);
    len >>= 8n;
  }
  return toB64(out);
}

// ---------- Entra certificate client assertion ----------

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
  if (!m) throw new Error("private key must be a PKCS#8 PEM (-----BEGIN PRIVATE KEY-----)");
  const bin = atob(m[1].replace(/\s+/g, ""));
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

// ---------- verification ----------

export interface RemoteItem {
  id?: string;
  webUrl?: string;
  size?: number;
  file?: { hashes?: { quickXorHash?: string } };
}

// Decides whether a SharePoint copy matches the Storage bytes. Returns null when it matches, or
// the reason it does not.
export function verifyCopy(
  mode: "hash" | "size",
  bytes: Uint8Array,
  expectedSize: number,
  remote: RemoteItem,
): string | null {
  if (!remote.id) return "SharePoint returned no item id";
  if (bytes.length !== expectedSize) return `downloaded ${bytes.length} bytes, Storage lists ${expectedSize}`;
  if (remote.size !== bytes.length) return `SharePoint size ${remote.size} differs from ${bytes.length}`;
  if (mode === "hash") {
    const theirs = remote.file?.hashes?.quickXorHash;
    if (!theirs) return "SharePoint returned no quickXorHash";
    const ours = quickXorHash(bytes);
    if (ours !== theirs) return `quickXorHash differs (ours ${ours}, SharePoint ${theirs})`;
  }
  return null;
}

// Upload sessions take chunks in multiples of 320 KiB; the last chunk may be shorter.
export const CHUNK = 320 * 1024 * 20; // 6.25 MiB
export const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024;

export function chunkRanges(total: number, chunk = CHUNK): Array<[number, number]> {
  if (chunk % (320 * 1024) !== 0) throw new Error("chunk must be a multiple of 320 KiB");
  const out: Array<[number, number]> = [];
  for (let start = 0; start < total; start += chunk) out.push([start, Math.min(start + chunk, total) - 1]);
  return out;
}
