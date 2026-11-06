import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { assertionParts, importSigningKey, isRetryable, pemToPkcs8, retryDelayMs, signAssertion, thumbprintToX5t, toB64, toB64u, tokenUrl } from "./msauth.ts";

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
  const key = await importSigningKey(pem.replace(/\n/g, "\\n"));
  await importSigningKey(toB64(der));
  assertThrows(() => pemToPkcs8("-----BEGIN PRIVATE KEY-----"), Error, "PKCS#8");
  const parts = assertionParts({ tenantId: "tenant-test.example", clientId: "app-1", x5t: "X5T", nowSec: 1_000_000, jti: "j-1" });
  const jwt = await signAssertion(key, parts);
  const [h, p, sig] = jwt.split(".");
  const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
  assertEquals(JSON.parse(new TextDecoder().decode(fromB64u(h))), { alg: "RS256", typ: "JWT", x5t: "X5T" });
  const payload = JSON.parse(new TextDecoder().decode(fromB64u(p)));
  assertEquals(payload.aud, tokenUrl("tenant-test.example"));
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
  assert(isRetryable(429) && isRetryable(503) && isRetryable(504) && !isRetryable(404));
});
