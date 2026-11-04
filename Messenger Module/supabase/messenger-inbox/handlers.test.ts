import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { metaSignatureOk, parseInstagram, parseTelegram, parseWhatsApp } from "./channels.ts";
import { type Deps, handle, Refused, webhookReceive, webhookVerify } from "./handlers.ts";

const ACC = "11111111-1111-1111-1111-111111111111";
const THREAD = "22222222-2222-2222-2222-222222222222";
const TOKEN = "super-secret-token-value";

function deps(o: { admin?: boolean; channel?: string; external?: string; platformOk?: boolean; dbError?: { code?: string; message?: string }; storeFails?: boolean } = {}) {
  const secrets = new Map<string, string>([[`${ACC}:token`, TOKEN], [`${ACC}:verify`, "vvv"], [`${ACC}:app_secret`, "appsecret"]]);
  const calls: { fn: string; args?: Record<string, unknown> }[] = [];
  const urls: { url: string; init?: RequestInit }[] = [];
  const notes: string[] = [];
  const d: Deps = {
    userRpc: (fn, args) => {
      calls.push({ fn, args });
      if (fn === "messenger_inbox_admin_list") return Promise.resolve({ data: [], error: o.admin === false ? { message: "Only an admin" } : null });
      if (fn === "messenger_inbox_connect") return Promise.resolve(o.dbError ? { data: null, error: o.dbError } : { data: ACC, error: null });
      if (fn === "messenger_inbox_send_begin") {
        return Promise.resolve(o.dbError ? { data: null, error: o.dbError } : { data: [{ message_id: "m1", account_id: ACC, channel: o.channel ?? "telegram", account_external_id: "ext", thread_external_id: "555" }], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    serviceRpc: (fn, args) => {
      calls.push({ fn, args });
      if (fn === "messenger_inbox_secret_get") return Promise.resolve({ data: secrets.get(`${args.p_account}:${args.p_key}`) ?? null, error: null });
      if (fn === "messenger_inbox_secret_set") { secrets.set(`${args.p_account}:${args.p_key}`, args.p_value as string); return Promise.resolve({ data: null, error: null }); }
      if (fn === "messenger_inbox_store" && o.storeFails) return Promise.resolve({ data: null, error: { message: "x" } });
      return Promise.resolve({ data: null, error: null });
    },
    account: (id) => Promise.resolve(id === ACC ? { id: ACC, channel: o.channel ?? "telegram", external_id: o.external ?? "ext" } : null),
    http: (url, init) => {
      urls.push({ url, init });
      if (o.platformOk === false) return Promise.resolve(new Response(JSON.stringify({ error: { message: `bad ${TOKEN}` } }), { status: 401 }));
      if (url.includes("getMe")) return Promise.resolve(new Response(JSON.stringify({ result: { id: 42, username: "abc_bot" } })));
      if (url.includes("sendMessage")) return Promise.resolve(new Response(JSON.stringify({ result: { message_id: 7 } })));
      if (url.includes("/messages")) return Promise.resolve(new Response(JSON.stringify({ messages: [{ id: "wamid.9" }], message_id: "ig.9" })));
      if (url.includes("/me?")) return Promise.resolve(new Response(JSON.stringify({ user_id: "900", username: "abc" })));
      return Promise.resolve(new Response(JSON.stringify({ verified_name: "AB Capital", result: true })));
    },
    randomSecret: () => "generated",
    webhookUrl: (id) => `https://x.test/fn?account=${id}`,
    note: (m) => notes.push(m),
  };
  return { d, calls, urls, notes, secrets };
}
const connect = (extra: Record<string, unknown> = {}) => ({ action: "connect", channel: "telegram", label: "Support", token: "new-token", ...extra });

Deno.test("Telegram connects: the token is checked, stored and given a secured webhook", async () => {
  const { d, calls, urls, secrets } = deps();
  const out = await handle(connect(), d);
  assertEquals(out.display_name, "@abc_bot");
  assertEquals(calls.find((c) => c.fn === "messenger_inbox_connect")?.args?.p_external_id, "42");
  assertEquals(secrets.get(`${ACC}:token`), "new-token");
  const hook = JSON.parse(urls.find((u) => u.url.includes("setWebhook"))!.init!.body as string);
  assertEquals([hook.url, hook.secret_token], [`https://x.test/fn?account=${ACC}`, "generated"]);
});
Deno.test("a connect reply never holds the token", async () => {
  const { d } = deps();
  assert(!JSON.stringify(await handle(connect(), d)).includes("new-token"));
  const meta = deps();
  const out = await handle(connect({ channel: "whatsapp", external_id: "pn1", app_secret: "s3cret" }), meta.d);
  assert(!JSON.stringify(out).includes("new-token") && !JSON.stringify(out).includes("s3cret"));
  assertEquals(out.verify_token, "generated");
  assertEquals(out.webhook_url, `https://x.test/fn?account=${ACC}`);
});
Deno.test("connecting needs an admin, before any token is tried", async () => {
  const { d, urls } = deps({ admin: false });
  await assertRejects(() => handle(connect(), d), Refused, "Only an admin");
  assertEquals(urls.length, 0);
});
Deno.test("a refused token saves nothing, and its error text stays hidden", async () => {
  const { d, calls } = deps({ platformOk: false });
  const err = await assertRejects(() => handle(connect(), d), Refused);
  assert(!err.message.includes(TOKEN));
  assertEquals(calls.some((c) => c.fn === "messenger_inbox_connect"), false);
});
Deno.test("connect asks for each channel's fields", async () => {
  const { d } = deps();
  await assertRejects(() => handle(connect({ token: "" }), d), Refused, "name and a token");
  await assertRejects(() => handle(connect({ channel: "whatsapp", app_secret: "s" }), d), Refused, "phone number ID");
  await assertRejects(() => handle(connect({ channel: "instagram" }), d), Refused, "app secret");
  await assertRejects(() => handle(connect({ channel: "linkedin" }), d), Refused, "cannot be connected");
});
Deno.test("a failed webhook setup undoes the connection", async () => {
  const x = deps();
  const real = x.d.http;
  x.d.http = (url, init) => (url.includes("setWebhook") ? Promise.resolve(new Response("{}", { status: 400 })) : real(url, init));
  await assertRejects(() => handle(connect(), x.d), Refused);
  assert(x.calls.some((c) => c.fn === "messenger_inbox_disconnect"));
});
Deno.test("an already connected account says so", async () => {
  const { d } = deps({ dbError: { message: "This account is already connected" } });
  await assertRejects(() => handle(connect(), d), Refused, "already connected");
});
Deno.test("sending goes through the database's checks first, and marks the result", async () => {
  const { d, calls, urls } = deps();
  assertEquals((await handle({ action: "send", thread_id: THREAD, body: "Hi" }, d)).ok, true);
  assertEquals(JSON.parse(urls[0].init!.body as string), { chat_id: "555", text: "Hi" });
  assertEquals(calls.find((c) => c.fn === "messenger_inbox_send_done")?.args, { p_message: "m1", p_external_id: "555:7", p_ok: true });
});
Deno.test("WhatsApp and Instagram send the documented shapes", async () => {
  const wa = deps({ channel: "whatsapp" });
  await handle({ action: "send", thread_id: THREAD, body: "Hi" }, wa.d);
  assert(wa.urls[0].url.endsWith("/ext/messages") && wa.urls[0].url.includes("graph.facebook.com"));
  assertEquals(JSON.parse(wa.urls[0].init!.body as string).messaging_product, "whatsapp");
  const ig = deps({ channel: "instagram" });
  await handle({ action: "send", thread_id: THREAD, body: "Hi" }, ig.d);
  assert(ig.urls[0].url.includes("graph.instagram.com"));
  assertEquals(JSON.parse(ig.urls[0].init!.body as string), { recipient: { id: "555" }, message: { text: "Hi" } });
});
Deno.test("a refused send is marked failed, and says so plainly", async () => {
  const { d, calls } = deps({ platformOk: false });
  await assertRejects(() => handle({ action: "send", thread_id: THREAD, body: "Hi" }, d), Refused, "did not accept");
  assertEquals(calls.find((c) => c.fn === "messenger_inbox_send_done")?.args?.p_ok, false);
});
Deno.test("the database's own sentence reaches the person; other wording does not", async () => {
  const w = deps({ dbError: { code: "P0001", message: "This person last wrote over 24 hours ago" } });
  await assertRejects(() => handle({ action: "send", thread_id: THREAD, body: "Hi" }, w.d), Refused, "over 24 hours");
  const x = deps({ dbError: { code: "23505", message: "secret db words" } });
  const err = await assertRejects(() => handle({ action: "send", thread_id: THREAD, body: "Hi" }, x.d), Refused);
  assert(!err.message.includes("secret db"));
});
Deno.test("Telegram's disconnect removes its webhook; Meta's says one is left", async () => {
  const t = deps();
  assertEquals((await handle({ action: "disconnect", account_id: ACC }, t.d)).meta_webhook_left, false);
  assert(t.urls.some((u) => u.url.includes("deleteWebhook")));
  assertEquals((await handle({ action: "disconnect", account_id: ACC }, deps({ channel: "whatsapp" }).d)).meta_webhook_left, true);
});
Deno.test("Meta's webhook check echoes only for the right token", async () => {
  const p = (t: string) => new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": t, "hub.challenge": "c123" });
  const { d } = deps({ channel: "whatsapp" });
  assertEquals(await webhookVerify(ACC, p("vvv"), d), "c123");
  assertEquals(await webhookVerify(ACC, p("wrong"), d), null);
  assertEquals(await webhookVerify("nope", p("vvv"), d), null);
  assertEquals(await webhookVerify(ACC, p("vvv"), deps({ channel: "telegram" }).d), null);
});
const TG = JSON.stringify({ message: { message_id: 3, date: 1800000000, from: { is_bot: false }, chat: { id: 555, first_name: "Sam", last_name: "Lee" }, text: "Hello" } });
Deno.test("a Telegram webhook needs its secret header", async () => {
  const good = deps();
  assertEquals(await webhookReceive(ACC, TG, new Headers({ "x-telegram-bot-api-secret-token": "vvv" }), good.d), 200);
  assertEquals(good.calls.find((c) => c.fn === "messenger_inbox_store")?.args?.p_body, "Hello");
  const bad = deps();
  assertEquals(await webhookReceive(ACC, TG, new Headers({ "x-telegram-bot-api-secret-token": "no" }), bad.d), 401);
  assertEquals(bad.calls.some((c) => c.fn === "messenger_inbox_store"), false);
  assertEquals(await webhookReceive(ACC, TG, new Headers(), deps().d), 401);
  assertEquals(await webhookReceive("nope", TG, new Headers(), deps().d), 404);
});
const sign = async (body: string, secret: string) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "sha256=" + [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, "0")).join("");
};
const WA = { entry: [{ changes: [{ value: { metadata: { phone_number_id: "ext" }, contacts: [{ wa_id: "9715", profile: { name: "Client" } }], messages: [{ id: "wamid.1", from: "9715", timestamp: "1800000000", type: "text", text: { body: "Hi" } }, { id: "wamid.2", from: "9715", timestamp: "1800000001", type: "image", image: { caption: "Look" } }, { id: "wamid.3", from: "9715", timestamp: "1800000002", type: "audio", audio: {} }] } }] }] };
Deno.test("a Meta webhook must carry a signature made from the exact bytes", async () => {
  const body = JSON.stringify(WA);
  const good = deps({ channel: "whatsapp" });
  assertEquals(await webhookReceive(ACC, body, new Headers({ "x-hub-signature-256": await sign(body, "appsecret") }), good.d), 200);
  assertEquals(good.calls.filter((c) => c.fn === "messenger_inbox_store").length, 3);
  const bad = deps({ channel: "whatsapp" });
  assertEquals(await webhookReceive(ACC, body + " ", new Headers({ "x-hub-signature-256": await sign(body, "appsecret") }), bad.d), 401);
  assertEquals(await webhookReceive(ACC, body, new Headers({ "x-hub-signature-256": await sign(body, "other") }), bad.d), 401);
  assertEquals(await webhookReceive(ACC, body, new Headers(), bad.d), 401);
  assertEquals(bad.calls.some((c) => c.fn === "messenger_inbox_store"), false);
  assertEquals(await metaSignatureOk("x", "md5=abc", "s"), false);
});
Deno.test("a store failure asks the platform to retry", async () => {
  const body = TG;
  assertEquals(await webhookReceive(ACC, body, new Headers({ "x-telegram-bot-api-secret-token": "vvv" }), deps({ storeFails: true }).d), 500);
});
Deno.test("parsers read messages and skip everything else", () => {
  assertEquals(parseTelegram(JSON.parse(TG))[0], { threadId: "555", contact: "Sam Lee", messageId: "555:3", body: "Hello", at: new Date(1800000000000).toISOString() });
  assertEquals(parseTelegram({ message: { message_id: 1, from: { is_bot: true }, chat: { id: 1 }, text: "x" } }), []);
  assertEquals(parseTelegram({ edited_message: {} }), []);
  assert(parseTelegram({ message: { message_id: 1, chat: { id: 1 }, photo: [{}] } })[0].body.startsWith("[photo"));
  const wa = parseWhatsApp(WA, "ext");
  assertEquals(wa.map((m) => m.body.slice(0, 6)), ["Hi", "Look", "[audio"]);
  assertEquals(wa[0].contact, "Client");
  assertEquals(parseWhatsApp(WA, "another-number"), []);
  assertEquals(parseWhatsApp({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "ext" }, statuses: [{}] } }] }] }, "ext"), []);
  const ig = { entry: [{ id: "900", messaging: [{ sender: { id: "u1" }, timestamp: 1800000000000, message: { mid: "m1", text: "Hey" } }, { sender: { id: "900" }, message: { mid: "m2", text: "mine", is_echo: true } }, { sender: { id: "u1" }, read: {} }] }] };
  assertEquals(parseInstagram(ig, "900").map((m) => [m.threadId, m.body]), [["u1", "Hey"]]);
  assertEquals(parseInstagram(ig, "other"), []);
});
