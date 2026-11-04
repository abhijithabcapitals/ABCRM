import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import {
  authorizeUrl,
  linkStatus,
  PHASE2_SCOPES,
  pkceFrom,
  readIdToken,
  signState,
  StateError,
  tenantAuthority,
  TenantError,
  verifyState,
} from "./auth.ts";

// Test helper: SHA-256 then base64url, written independently of auth.ts.
async function s256(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  let bin = "";
  for (const b of digest) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64u(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function flip(s: string, i: number): string {
  const c = s[i] === "A" ? "B" : "A";
  return s.slice(0, i) + c + s.slice(i + 1);
}

Deno.test("state round trips", async () => {
  const s = await signState("k", "user-1", 1000);
  const v = await verifyState("k", s, 1000 + 60_000);
  assertEquals(v.profileId, "user-1");
  assert(v.nonce.length >= 16);
});

Deno.test("tampered state, wrong key, and 10 minutes expiry are refused", async () => {
  const s = await signState("k", "user-1", 1000);
  const [payload, sig] = s.split(".");
  await assertRejects(() => verifyState("k", flip(payload, 0) + "." + sig, 1000), StateError);
  await assertRejects(() => verifyState("k", payload + "." + flip(sig, 0), 1000), StateError);
  await assertRejects(() => verifyState("other", s, 1000), StateError);
  await assertRejects(() => verifyState("k", s, 1000 + 601_000), StateError);
  // exactly 10 minutes is still accepted
  assertEquals((await verifyState("k", s, 1000 + 600_000)).profileId, "user-1");
});

Deno.test("state dated in the future is refused", async () => {
  const s = await signState("k", "user-1", 10_000_000);
  await assertRejects(() => verifyState("k", s, 1000), StateError);
});

Deno.test("every malformed state throws StateError", async () => {
  const good = await signState("k", "user-1", 1000);
  const [payload, sig] = good.split(".");
  const bad = [
    "",
    "nodot",
    payload, // no signature part
    payload + ".", // empty signature
    "." + sig, // empty payload
    good + ".extra", // three parts
    payload + ".!!!notbase64!!!",
    "***." + sig,
  ];
  for (const s of bad) await assertRejects(() => verifyState("k", s, 1000), StateError, undefined, `state: ${s}`);

  // Correctly signed but the payload is not what we issue.
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("k"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  for (const body of ["not json", '{"p":1,"n":"x","t":1000}', '{"p":"u","n":"x"}', "[]", "null"]) {
    const p = b64u(body);
    const raw = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(p)));
    let bin = "";
    for (const b of raw) bin += String.fromCharCode(b);
    const signed = p + "." + b64u(bin);
    await assertRejects(() => verifyState("k", signed, 1000), StateError, undefined, `payload: ${body}`);
  }
});

Deno.test("each signed state carries a fresh nonce", async () => {
  const a = await verifyState("k", await signState("k", "u", 1000), 1000);
  const b = await verifyState("k", await signState("k", "u", 1000), 1000);
  assert(a.nonce !== b.nonce);
});

Deno.test("pkce is stable per nonce and S256", async () => {
  const a = await pkceFrom("k", "n");
  assertEquals(a, await pkceFrom("k", "n"));
  assertEquals(a.challenge, await s256(a.verifier));
  assert(a.verifier !== (await pkceFrom("k", "m")).verifier);
  assert(a.verifier !== (await pkceFrom("other", "n")).verifier);
  assert(/^[A-Za-z0-9_-]{43,128}$/.test(a.verifier));
});

Deno.test("authorize URL uses the tenant authority, never common", () => {
  const u = new URL(authorizeUrl({ tenantId: "T", clientId: "C", redirectUri: "https://r" }, "st", "ch", PHASE2_SCOPES));
  assertEquals(u.origin, "https://login.microsoftonline.com");
  assertEquals(u.pathname, "/T/oauth2/v2.0/authorize");
  assertEquals(u.searchParams.get("code_challenge_method"), "S256");
  assertEquals(u.searchParams.get("code_challenge"), "ch");
  assertEquals(u.searchParams.get("state"), "st");
  assertEquals(u.searchParams.get("client_id"), "C");
  assertEquals(u.searchParams.get("redirect_uri"), "https://r");
  assertEquals(u.searchParams.get("response_type"), "code");
  assertEquals(u.searchParams.get("scope"), "openid profile offline_access User.Read");
});

Deno.test("phase 2 scopes never include message reading", () => {
  assertEquals(PHASE2_SCOPES, ["openid", "profile", "offline_access", "User.Read"]);
});

Deno.test("linkStatus compares without case or spaces", () => {
  assertEquals(linkStatus(" A@X.ae", "a@x.ae"), "active");
  assertEquals(linkStatus("a@x.ae", "b@x.ae"), "review");
  assertEquals(linkStatus("a@x.ae", null), "review");
});

function token(claims: unknown): string {
  return `${b64u('{"alg":"RS256"}')}.${b64u(JSON.stringify(claims))}.sig`;
}

Deno.test("readIdToken returns tid, oid and preferred_username as email", () => {
  assertEquals(readIdToken(token({ tid: "T", oid: "O", preferred_username: "a@x.ae" })), { tid: "T", oid: "O", email: "a@x.ae" });
});

Deno.test("readIdToken throws a clear error on malformed tokens", () => {
  const bad = [
    "",
    "one",
    "a.b",
    "a.b.c.d",
    "a.!!!.c",
    `h.${b64u("not json")}.s`,
    `h.${b64u("null")}.s`,
    token({ oid: "O", preferred_username: "a@x.ae" }),
    token({ tid: "T", preferred_username: "a@x.ae" }),
    token({ tid: "T", oid: "O" }),
    token({ tid: "T", oid: "O", preferred_username: "" }),
    token({ tid: 1, oid: "O", preferred_username: "a@x.ae" }),
  ];
  for (const t of bad) assertThrows(() => readIdToken(t), Error, "ID token", `token: ${t}`);
});

Deno.test("linkStatus returns review when either value is blank after trim", () => {
  assertEquals(linkStatus("   ", "   "), "review");
  assertEquals(linkStatus("", ""), "review");
  assertEquals(linkStatus("a@x.ae", "   "), "review");
  assertEquals(linkStatus("  ", "a@x.ae"), "review");
});

Deno.test("verifyState refuses a now that is not finite", async () => {
  const s = await signState("k", "user-1", 1000);
  for (const now of [NaN, Infinity, -Infinity]) {
    await assertRejects(() => verifyState("k", s, now), StateError, undefined, `now: ${now}`);
  }
});

Deno.test("authorizeUrl refuses a tenant that is empty or shared by many organisations", () => {
  const cfg = { clientId: "C", redirectUri: "https://r" };
  for (const tenantId of ["", "   ", "common", "COMMON", " Organizations ", "organizations", "consumers", "Consumers"]) {
    assertThrows(() => authorizeUrl({ ...cfg, tenantId }, "st", "ch", PHASE2_SCOPES), TenantError, undefined, `tenant: ${tenantId}`);
  }
});

Deno.test("tenantAuthority returns the authority for one tenant only", () => {
  assertEquals(tenantAuthority("T/x"), "https://login.microsoftonline.com/T%2Fx/oauth2/v2.0");
  assertThrows(() => tenantAuthority("common"), TenantError);
});
