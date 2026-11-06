import { assert, assertEquals, assertMatch, assertThrows } from "jsr:@std/assert@1";
import {
  assertionParts,
  chunkRanges,
  encodeDrivePath,
  importSigningKey,
  MAX_SEGMENT,
  pemToPkcs8,
  quickXorHash,
  retryDelayMs,
  safeSegment,
  sharePointPath,
  signAssertion,
  thumbprintToX5t,
  toB64,
  toB64u,
  verifyCopy,
} from "./archive.ts";

// Straight port of Microsoft's published C# QuickXorHash (three 64-bit cells, the last 32 bits
// wide), fed in uneven blocks, so the folded implementation is checked against the reference.
function referenceQuickXor(data: Uint8Array, blocks: number[]): string {
  const cells = [0n, 0n, 0n];
  const mask64 = (1n << 64n) - 1n;
  let shiftSoFar = 0;
  let length = 0n;
  let pos = 0;
  for (const want of blocks) {
    const cb = Math.min(want, data.length - pos);
    if (cb <= 0) break;
    let idx = Math.floor(shiftSoFar / 64);
    let off = shiftSoFar % 64;
    const iterations = Math.min(cb, 160);
    for (let i = 0; i < iterations; i++) {
      const isLast = idx === 2;
      const width = isLast ? 32 : 64;
      let x = 0;
      for (let j = pos + i; j < pos + cb; j += 160) x ^= data[j];
      if (off <= width - 8) {
        cells[idx] = (cells[idx] ^ (BigInt(x) << BigInt(off))) & mask64;
      } else {
        const idx2 = isLast ? 0 : idx + 1;
        cells[idx] = (cells[idx] ^ (BigInt(x) << BigInt(off))) & mask64;
        cells[idx2] = (cells[idx2] ^ (BigInt(x) >> BigInt(width - off))) & mask64;
      }
      off += 11;
      while (off >= (idx === 2 ? 32 : 64)) {
        off -= idx === 2 ? 32 : 64;
        idx = idx === 2 ? 0 : idx + 1;
      }
    }
    shiftSoFar = (shiftSoFar + 11 * (cb % 160)) % 160;
    length += BigInt(cb);
    pos += cb;
  }
  const out = new Uint8Array(20);
  for (let c = 0; c < 3; c++) {
    for (let b = 0; b < (c === 2 ? 4 : 8); b++) out[c * 8 + b] = Number((cells[c] >> BigInt(8 * b)) & 0xffn);
  }
  for (let i = 0; i < 8; i++) out[12 + i] ^= Number((length >> BigInt(8 * i)) & 0xffn);
  return toB64(out);
}

function seeded(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = s >>> 24;
  }
  return out;
}

Deno.test("quickXorHash of an empty file is all zeros", () => {
  assertEquals(quickXorHash(new Uint8Array(0)), "AAAAAAAAAAAAAAAAAAAAAAAAAAA=");
});

Deno.test("quickXorHash matches the reference algorithm for many sizes and block splits", () => {
  for (const n of [1, 2, 7, 8, 19, 20, 21, 159, 160, 161, 319, 320, 1000, 4096, 65_537]) {
    const data = seeded(n, n * 31 + 7);
    const ours = quickXorHash(data);
    assertEquals(ours, referenceQuickXor(data, [n]), `size ${n}, one block`);
    assertEquals(ours, referenceQuickXor(data, Array(Math.min(n, 400)).fill(1).concat([n])), `size ${n}, small blocks`);
    assertEquals(ours, referenceQuickXor(data, [3, 157, 161, 999, n]), `size ${n}, mixed blocks`);
  }
});

Deno.test("quickXorHash changes when one byte changes", () => {
  const a = seeded(5000, 1);
  const b = a.slice();
  b[4321] ^= 1;
  assert(quickXorHash(a) !== quickXorHash(b));
});

Deno.test("safeSegment removes characters SharePoint refuses", () => {
  assertEquals(safeSegment('a:b*c?"d<e>f|g\\h'), "a_b_c__d_e_f_g_h");
  assertEquals(safeSegment("  .hidden. "), "hidden");
  assertEquals(safeSegment(""), "_");
  assertEquals(safeSegment("CON"), "_CON");
  assertEquals(safeSegment("con.txt"), "_con.txt");
  assertEquals(safeSegment("x_vti_y"), "x_vti-y");
  assertEquals(safeSegment("INBOX.Customer Service Cand"), "INBOX.Customer Service Cand");
});

Deno.test("safeSegment shortens long names and keeps the extension", () => {
  const s = safeSegment("a".repeat(300) + ".pdf");
  assertEquals(s.length, MAX_SEGMENT);
  assert(s.endsWith(".pdf"));
});

Deno.test("sharePointPath maps the mailbox id to its address under the root folder", () => {
  assertEquals(
    sharePointPath("Email Archive", "0236-x/INBOX/1636287122/1140304/attachments/1-in:voice.pdf", "info@abcapital.ae"),
    "Email Archive/info@abcapital.ae/INBOX/1636287122/1140304/attachments/1-in_voice.pdf",
  );
  assertEquals(sharePointPath("/A/B/", "m/INBOX/1/2/message.eml", undefined), "A/B/m/INBOX/1/2/message.eml");
  assertThrows(() => sharePointPath("A", "", undefined));
});

Deno.test("encodeDrivePath encodes each segment but keeps the slashes", () => {
  assertEquals(encodeDrivePath("Email Archive/a#b/c%d.pdf"), "Email%20Archive/a%23b/c%25d.pdf");
});

Deno.test("thumbprintToX5t converts the SHA-1 hex thumbprint to base64url", () => {
  const hex = "00112233445566778899AABBCCDDEEFF00112233";
  const bytes = new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));
  assertEquals(thumbprintToX5t(hex), toB64u(bytes));
  assertEquals(thumbprintToX5t("00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff:00:11:22:33"), toB64u(bytes));
  assertThrows(() => thumbprintToX5t("abc"));
});

Deno.test("pemToPkcs8 refuses PKCS#1 and encrypted keys", () => {
  assertThrows(() => pemToPkcs8("-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----"), Error, "openssl pkcs8");
  assertThrows(() => pemToPkcs8("-----BEGIN ENCRYPTED PRIVATE KEY-----\nAAAA\n-----END ENCRYPTED PRIVATE KEY-----"));
  assertThrows(() => pemToPkcs8("nonsense"));
});

Deno.test("client assertion is a valid RS256 JWT for the tenant token endpoint", async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${toB64(der).match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
  const key = await importSigningKey(pem.replace(/\n/g, "\\n")); // secrets often arrive with literal \n
  // The one-line form (base64 body only) that set_archive_secrets.sh stores.
  await importSigningKey(toB64(der));
  assertThrows(() => pemToPkcs8("-----BEGIN PRIVATE KEY-----"), Error, "PKCS#8");
  const parts = assertionParts({ tenantId: "contoso.onmicrosoft.com", clientId: "app-1", x5t: "X5T", nowSec: 1_000_000, jti: "j-1" });
  const jwt = await signAssertion(key, parts);
  const [h, p, sig] = jwt.split(".");
  const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
  assertEquals(JSON.parse(new TextDecoder().decode(fromB64u(h))), { alg: "RS256", typ: "JWT", x5t: "X5T" });
  const payload = JSON.parse(new TextDecoder().decode(fromB64u(p)));
  assertEquals(payload.aud, "https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token");
  assertEquals([payload.iss, payload.sub, payload.exp - payload.iat], ["app-1", "app-1", 600]);
  assert(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", pair.publicKey, fromB64u(sig), new TextEncoder().encode(`${h}.${p}`)));
  assertThrows(() => assertionParts({ tenantId: "bad/tenant", clientId: "a", x5t: "b", nowSec: 1, jti: "c" }));
});

Deno.test("retryDelayMs honours Retry-After and caps the wait", () => {
  assertEquals(retryDelayMs("5", 0, 0), 5000);
  assertEquals(retryDelayMs("600", 0, 0), 30_000);
  assertEquals(retryDelayMs(new Date(10_000).toUTCString(), 0, 4_000), 6_000);
  assertEquals(retryDelayMs(null, 3, 0), 8000);
  assertEquals(retryDelayMs(null, 10, 0), 30_000);
});

Deno.test("verifyCopy accepts only an exact copy", () => {
  const bytes = seeded(1234, 9);
  const good = { id: "i1", size: 1234, file: { hashes: { quickXorHash: quickXorHash(bytes) } } };
  assertEquals(verifyCopy("hash", bytes, 1234, good), null);
  assertEquals(verifyCopy("size", bytes, 1234, { id: "i1", size: 1234 }), null);
  assertMatch(verifyCopy("hash", bytes, 1234, { ...good, size: 1233 })!, /size/);
  assertMatch(verifyCopy("hash", bytes, 1235, good)!, /Storage lists/);
  assertMatch(verifyCopy("hash", bytes, 1234, { ...good, file: { hashes: { quickXorHash: "x" } } })!, /differs/);
  assertMatch(verifyCopy("hash", bytes, 1234, { id: "i1", size: 1234 })!, /no quickXorHash/);
  assertMatch(verifyCopy("size", bytes, 1234, { size: 1234 })!, /no item id/);
});

Deno.test("chunkRanges covers the file in 320 KiB multiples", () => {
  const unit = 320 * 1024;
  assertEquals(chunkRanges(10, unit), [[0, 9]]);
  assertEquals(chunkRanges(unit * 2 + 5, unit), [[0, unit - 1], [unit, 2 * unit - 1], [2 * unit, 2 * unit + 4]]);
  assertThrows(() => chunkRanges(10, 1000));
});
