import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { type CallDeps, handle, joinToken, Refused, TOKEN_SECONDS, verifyWebhook, webhookCall } from "./handlers.ts";

const CALL = "11111111-1111-1111-1111-111111111111";
const ME = "22222222-2222-2222-2222-222222222222";
const NOW = 1_800_000_000_000;
const KEY = "api-key";
const SECRET = "a-long-enough-test-secret-value";
const livekit = { url: "wss://x.livekit.cloud", apiKey: KEY, apiSecret: SECRET };
const claimsOf = (jwt: string) => JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));

function deps(over: Partial<CallDeps> = {}): CallDeps {
  return {
    rpc: () => Promise.resolve({ data: [{ room_name: "room-1", media: "video", full_name: "Amy" }], error: null }),
    userId: () => Promise.resolve(ME),
    livekit,
    now: () => NOW,
    ...over,
  };
}

Deno.test("a token is for this person, this room, and a short time", async () => {
  const out = await handle({ action: "token", call_id: CALL }, deps());
  assertEquals(out.url, livekit.url);
  assertEquals(out.media, "video");
  const c = claimsOf(out.token as string);
  assertEquals([c.iss, c.sub, c.name, c.video.room, c.video.roomJoin], [KEY, ME, "Amy", "room-1", true]);
  assertEquals(c.exp - Math.floor(NOW / 1000), TOKEN_SECONDS);
  assert(!("roomAdmin" in c.video) && !("roomCreate" in c.video), "a caller must get no admin rights");
});
Deno.test("the secret never appears in the token", async () => {
  const jwt = await joinToken({ apiKey: KEY, apiSecret: SECRET, room: "r", identity: ME, name: "A", now: NOW });
  assert(!atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")).includes(SECRET));
});
Deno.test("refusals are plain sentences", async () => {
  await assertRejects(() => handle({ action: "token", call_id: CALL }, deps({ livekit: null })), Refused, "not set up");
  await assertRejects(() => handle({ action: "token", call_id: "../x" }, deps()), Refused, "not valid");
  await assertRejects(() => handle({ action: "other" }, deps()), Refused, "not valid");
  await assertRejects(() => handle({ action: "token", call_id: CALL }, deps({ userId: () => Promise.resolve(null) })), Refused, "sign in");
  const err = await assertRejects(() => handle({ action: "token", call_id: CALL }, deps({ rpc: () => Promise.resolve({ data: null, error: { message: "secret db words" } }) })), Refused);
  assertEquals(err.message, "This call has ended.");
});

async function signedWebhook(body: string, over: Record<string, unknown> = {}, secret = SECRET, tamper = "") {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body + tamper)));
  const seconds = Math.floor(NOW / 1000);
  const jwt = await joinToken({ apiKey: KEY, apiSecret: secret, room: "r", identity: "webhook", name: "w", now: NOW });
  const [head, , ] = jwt.split(".");
  const b64 = (v: unknown) => btoa(JSON.stringify(v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unsigned = `${head}.${b64({ iss: KEY, exp: seconds + 300, sha256: btoa(String.fromCharCode(...digest)), ...over })}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(unsigned)));
  return `${unsigned}.${btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}
const BODY = JSON.stringify({ event: "room_finished", room: { name: "room-1" } });
const check = (authorization: string | null, rawBody = BODY) => verifyWebhook({ authorization, rawBody, apiKey: KEY, apiSecret: SECRET, now: NOW });

Deno.test("a correctly signed webhook is accepted", async () => {
  assertEquals((await check(await signedWebhook(BODY)))?.event, "room_finished");
});
Deno.test("a forged, altered, foreign, expired or missing webhook is refused", async () => {
  assertEquals(await check(await signedWebhook(BODY, {}, "wrong-secret-of-some-length")), null);
  assertEquals(await check(await signedWebhook(BODY), BODY + " "), null);
  assertEquals(await check(await signedWebhook(BODY, { iss: "someone-else" })), null);
  assertEquals(await check(await signedWebhook(BODY, { exp: Math.floor(NOW / 1000) - 3600 })), null);
  assertEquals(await check(null), null);
  assertEquals(await check("not.a.jwt"), null);
});
Deno.test("only events that change a call go to the database", () => {
  assertEquals(webhookCall({ event: "room_finished", room: { name: "r" } }), { p_room: "r", p_event: "room_finished", p_person: null });
  assertEquals(webhookCall({ event: "participant_left", room: { name: "r" }, participant: { identity: ME } }), { p_room: "r", p_event: "participant_left", p_person: ME });
  assertEquals(webhookCall({ event: "track_published", room: { name: "r" } }), null);
  assertEquals(webhookCall({ event: "room_finished" }), null);
  assertEquals(webhookCall({ event: "participant_left", room: { name: "r" } }), null);
});
