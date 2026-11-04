import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { createGraph, GraphError, NotConnectedError } from "./graph.ts";

const SECRET = "client-secret-xyz";
const REFRESH = "refresh-token-111";
const NEW_REFRESH = "refresh-token-222";
const ACCESS = "access-token-aaa";

type Call = { url: string; init: RequestInit };
type Reply = Response | Error | (() => Response | Error);

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function tokenOk(extra: Record<string, unknown> = {}): Response {
  return json({ access_token: ACCESS, expires_in: 3600, ...extra });
}

// Fake fetch: replies are consumed in order; every call is recorded.
function setup(replies: Reply[], stored: string | null = REFRESH) {
  const calls: Call[] = [];
  const logs: unknown[] = [];
  const sleeps: number[] = [];
  const saved: string[] = [];
  let revoked = 0;
  const queue = [...replies];
  const g = createGraph({
    tokenUrl: "https://login.example/token",
    clientId: "client-1",
    clientSecret: SECRET,
    loadToken: () => Promise.resolve(stored),
    saveToken: (t) => {
      saved.push(t);
      return Promise.resolve();
    },
    onRevoked: () => {
      revoked++;
      return Promise.resolve();
    },
    log: (e) => {
      logs.push(e);
      return Promise.resolve();
    },
    fetch: ((url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const next = queue.shift();
      if (next === undefined) throw new Error("fake fetch: no reply queued");
      const r = typeof next === "function" ? next() : next;
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    }) as typeof fetch,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });
  return { g, calls, logs, sleeps, saved, revoked: () => revoked };
}

const isToken = (c: Call) => c.url === "https://login.example/token";

Deno.test("first call refreshes once, second call reuses the access token", async () => {
  const t = setup([tokenOk(), json({ id: 1 }), json({ id: 2 })]);
  assertEquals(await t.g.request("GET", "/me"), { id: 1 });
  assertEquals(await t.g.request("GET", "/me"), { id: 2 });
  assertEquals(t.calls.filter(isToken).length, 1);
  assertEquals(t.calls.length, 3);
  const graphCall = t.calls[1];
  assertEquals(graphCall.url, "https://graph.microsoft.com/v1.0/me");
  assertEquals((graphCall.init.headers as Record<string, string>).Authorization, `Bearer ${ACCESS}`);
  const form = new URLSearchParams(t.calls[0].init.body as string);
  assertEquals(form.get("grant_type"), "refresh_token");
  assertEquals(form.get("refresh_token"), REFRESH);
  assertEquals(form.get("client_id"), "client-1");
  assertEquals(form.get("client_secret"), SECRET);
});

Deno.test("POST sends JSON body", async () => {
  const t = setup([tokenOk(), json({ ok: true }, 201)]);
  await t.g.request("POST", "/me/x", { a: 1 });
  assertEquals(t.calls[1].init.method, "POST");
  assertEquals(t.calls[1].init.body, '{"a":1}');
  assertEquals((t.calls[1].init.headers as Record<string, string>)["Content-Type"], "application/json");
});

Deno.test("204 returns null", async () => {
  const t = setup([tokenOk(), new Response(null, { status: 204 })]);
  assertEquals(await t.g.request("DELETE", "/me/x"), null);
});

Deno.test("a rotated refresh token goes to saveToken", async () => {
  const t = setup([tokenOk({ refresh_token: NEW_REFRESH }), json({})]);
  await t.g.request("GET", "/me");
  assertEquals(t.saved, [NEW_REFRESH]);
});

Deno.test("a refresh response without a refresh token keeps the stored one", async () => {
  const t = setup([tokenOk(), json({})]);
  await t.g.request("GET", "/me");
  assertEquals(t.saved, []);
});

Deno.test("no stored token throws NotConnectedError with no network call", async () => {
  const t = setup([], null);
  await assertRejects(() => t.g.request("GET", "/me"), NotConnectedError);
  assertEquals(t.calls.length, 0);
});

Deno.test("invalid_grant calls onRevoked and throws NotConnectedError", async () => {
  const t = setup([json({ error: "invalid_grant", error_description: "gone" }, 400)]);
  await assertRejects(() => t.g.request("GET", "/me"), NotConnectedError);
  assertEquals(t.revoked(), 1);
  assertEquals(t.calls.length, 1);
});

Deno.test("other token endpoint errors raise GraphError with the error code", async () => {
  const t = setup([json({ error: "temporarily_unavailable" }, 503)]);
  const e = await assertRejects(() => t.g.request("GET", "/me"), GraphError);
  assertEquals(e.status, 503);
  assertEquals(e.code, "temporarily_unavailable");
  assertEquals(t.revoked(), 0);
});

Deno.test("429 with Retry-After: 2 sleeps 2000 ms, retries once, returns result", async () => {
  const t = setup([tokenOk(), json({}, 429, { "Retry-After": "2" }), json({ ok: 1 })]);
  assertEquals(await t.g.request("GET", "/me"), { ok: 1 });
  assertEquals(t.sleeps, [2000]);
});

Deno.test("a second 429 throws GraphError with status 429", async () => {
  const t = setup([tokenOk(), json({}, 429, { "Retry-After": "1" }), json({ error: { code: "TooManyRequests" } }, 429)]);
  const e = await assertRejects(() => t.g.request("GET", "/me"), GraphError);
  assertEquals(e.status, 429);
  assertEquals(e.code, "TooManyRequests");
  assertEquals(t.sleeps.length, 1);
});

Deno.test("Retry-After: 999 sleeps at most 10000 ms", async () => {
  const t = setup([tokenOk(), json({}, 429, { "Retry-After": "999" }), json({})]);
  await t.g.request("GET", "/me");
  assertEquals(t.sleeps, [10000]);
});

Deno.test("429 with a missing or bad Retry-After still sleeps a bounded time", async () => {
  for (const h of [{} as Record<string, string>, { "Retry-After": "soon" }, { "Retry-After": "-5" }]) {
    const t = setup([tokenOk(), json({}, 429, h), json({})]);
    await t.g.request("GET", "/me");
    assertEquals(t.sleeps.length, 1);
    assert(t.sleeps[0] >= 0 && t.sleeps[0] <= 10000);
  }
});

Deno.test("a 401 refreshes once and retries once", async () => {
  const t = setup([tokenOk(), json({}, 401), tokenOk({ access_token: "access-2" }), json({ ok: 1 })]);
  assertEquals(await t.g.request("GET", "/me"), { ok: 1 });
  assertEquals(t.calls.filter(isToken).length, 2);
  assertEquals((t.calls[3].init.headers as Record<string, string>).Authorization, "Bearer access-2");
});

Deno.test("a second 401 throws GraphError 401 without a third try", async () => {
  const t = setup([tokenOk(), json({}, 401), tokenOk(), json({ error: { code: "InvalidAuthenticationToken" } }, 401)]);
  const e = await assertRejects(() => t.g.request("GET", "/me"), GraphError);
  assertEquals(e.status, 401);
  assertEquals(e.code, "InvalidAuthenticationToken");
  assertEquals(t.calls.length, 4);
});

Deno.test("Graph error without a code gets http_<status>", async () => {
  const t = setup([tokenOk(), json({}, 404)]);
  const e = await assertRejects(() => t.g.request("GET", "/me"), GraphError);
  assertEquals(e.status, 404);
  assertEquals(e.code, "http_404");
});

Deno.test("paths that could leave graph.microsoft.com are refused before any network call", async () => {
  const bad = [
    "https://evil.example/x",
    "http://graph.microsoft.com/v1.0/me",
    "//evil.example/x",
    "/\\evil.example/x",
    "me",
    "",
    "\\\\evil.example",
    " /me",
    "/me\r\nHost: evil",
  ];
  for (const p of bad) {
    const t = setup([tokenOk(), json({})]);
    const e = await assertRejects(() => t.g.request("GET", p), GraphError, undefined, `path: ${JSON.stringify(p)}`);
    assertEquals(e.code, "bad_path");
    assertEquals(t.calls.length, 0, `path: ${JSON.stringify(p)}`);
  }
});

Deno.test("network failure raises GraphError network_error with no URL or token in it", async () => {
  const leaky = new Error(`connect failed https://graph.microsoft.com/v1.0/me?x=${ACCESS} ${REFRESH} ${SECRET}`);
  // on the token endpoint
  const a = setup([leaky]);
  const ea = await assertRejects(() => a.g.request("GET", "/me"), GraphError);
  assertEquals(ea.code, "network_error");
  // on the Graph call
  const b = setup([tokenOk(), leaky]);
  const eb = await assertRejects(() => b.g.request("GET", "/me"), GraphError);
  assertEquals(eb.code, "network_error");
  for (const e of [ea, eb]) {
    const text = `${e.message} ${e.stack ?? ""} ${JSON.stringify(e)} ${String(e.cause ?? "")}`;
    for (const s of [ACCESS, REFRESH, SECRET, "graph.microsoft.com", "login.example"]) assert(!text.includes(s), `leaked ${s}`);
  }
});

Deno.test("non-JSON responses raise GraphError bad_response", async () => {
  const a = setup([new Response("<html>oops</html>", { status: 200 })]);
  assertEquals((await assertRejects(() => a.g.request("GET", "/me"), GraphError)).code, "bad_response");
  const b = setup([tokenOk(), new Response("<html>oops</html>", { status: 200 })]);
  assertEquals((await assertRejects(() => b.g.request("GET", "/me"), GraphError)).code, "bad_response");
  const c = setup([tokenOk(), new Response("<html>gateway</html>", { status: 502 })]);
  const ec = await assertRejects(() => c.g.request("GET", "/me"), GraphError);
  assertEquals(ec.status, 502);
  assertEquals(ec.code, "http_502");
  const d = setup([new Response("bad gateway", { status: 502 })]);
  assertEquals((await assertRejects(() => d.g.request("GET", "/me"), GraphError)).status, 502);
});

Deno.test("token response without an access token raises GraphError bad_response", async () => {
  const t = setup([json({ expires_in: 3600 })]);
  assertEquals((await assertRejects(() => t.g.request("GET", "/me"), GraphError)).code, "bad_response");
});

Deno.test("log calls never contain tokens or the client secret", async () => {
  const scenarios: Reply[][] = [
    [tokenOk({ refresh_token: NEW_REFRESH }), json({})],
    [tokenOk(), json({}, 429, { "Retry-After": "1" }), json({}, 429)],
    [tokenOk(), json({}, 401), tokenOk(), json({}, 401)],
    [json({ error: "invalid_grant" }, 400)],
    [tokenOk(), new Error(`${ACCESS} ${REFRESH} ${SECRET}`)],
  ];
  let total = 0;
  for (const s of scenarios) {
    const t = setup(s);
    await t.g.request("GET", "/me").catch(() => {});
    total += t.logs.length;
    const text = JSON.stringify(t.logs);
    for (const secret of [ACCESS, REFRESH, NEW_REFRESH, SECRET, "access-2"]) assert(!text.includes(secret), `logged ${secret}`);
  }
  assert(total > 0, "expected log calls");
});

Deno.test("a failing log does not break the request", async () => {
  const replies = [tokenOk(), json({ ok: 1 })];
  const g = createGraph({
    tokenUrl: "https://login.example/token",
    clientId: "c",
    clientSecret: SECRET,
    loadToken: () => Promise.resolve(REFRESH),
    saveToken: () => Promise.resolve(),
    onRevoked: () => Promise.resolve(),
    log: () => Promise.reject(new Error("db down")),
    fetch: (() => Promise.resolve(replies.shift()!)) as typeof fetch,
    sleep: () => Promise.resolve(),
  });
  assertEquals(await g.request("GET", "/me"), { ok: 1 });
});
