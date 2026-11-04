import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { browserMessage } from "./handlers.ts";
import {
  assertAllowed,
  clientKey,
  createZohoClient,
  hostsFor,
  NotAllowedError,
  scrub,
  ZohoAccessError,
  ZohoHttpError,
  ZohoTimeoutError,
} from "./zohoClient.ts";

const cfg = {
  clientId: "fake-client-id",
  clientSecret: "fake-client-secret",
  refreshToken: "fake-refresh-token",
  orgId: "ORG",
  dc: "ae",
};

Deno.test("refuses anything not on the list", () => {
  for (
    const [m, p] of [
      ["PUT", "/invoices/1"],
      ["DELETE", "/invoices/1"],
      ["POST", "/contacts"],
      ["GET", "/users"],
      ["POST", "/invoices/1/status/sent"],
      ["POST", "/invoices/1/email"],
      ["GET", "/invoices/../users"],
      ["GET", "/invoices/abc"],
      ["GET", "/contacts/12/x"],
      ["POST", "/estimates/5"],
    ]
  ) assertThrows(() => assertAllowed(m, p, {}), NotAllowedError);
});

Deno.test("allows the listed reads and creates", () => {
  for (
    const [m, p] of [
      ["GET", "/organizations"],
      ["GET", "/contacts"],
      ["GET", "/contacts/12"],
      ["GET", "/items"],
      ["GET", "/settings/taxes"],
      ["GET", "/estimates"],
      ["GET", "/estimates/12"],
      ["GET", "/invoices"],
      ["GET", "/invoices/12"],
      ["POST", "/estimates"],
      ["POST", "/invoices"],
    ]
  ) assertAllowed(m, p, { send: "false" });
});

Deno.test("a create with send=true is refused", () => {
  assertThrows(() => assertAllowed("POST", "/invoices", { send: "true" }), NotAllowedError);
  assertThrows(() => assertAllowed("POST", "/estimates", { send: "true" }), NotAllowedError);
});

Deno.test("ae uses the UAE servers", () =>
  assertEquals(hostsFor("ae"), {
    accounts: "https://accounts.zoho.ae",
    api: "https://www.zohoapis.ae/books/v3",
  }));

Deno.test("an unknown data centre is refused", () => {
  assertThrows(() => hostsFor("evil.example"));
});

Deno.test("scrub removes secrets", () => {
  assertEquals(scrub("a SECRET b SECRET", ["SECRET"]), "a [hidden] b [hidden]");
  assertEquals(scrub("nothing", ["", "x1"]), "nothing");
});

type Call = { url: string; init?: RequestInit };

function fakeFetch(calls: Call[], apiResponse: () => Response): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("/oauth/v2/token")) {
      return Promise.resolve(Response.json({ access_token: "T", expires_in: 3600 }));
    }
    return Promise.resolve(apiResponse());
  }) as typeof fetch;
}

Deno.test("post always sends send=false and organization_id", async () => {
  const calls: Call[] = [];
  const z = createZohoClient(cfg, fakeFetch(calls, () => Response.json({ code: 0, invoice: {} })));
  await z.post("/invoices", { customer_id: "1" });
  const api = calls.find((c) => !c.url.includes("/oauth/"))!;
  const u = new URL(api.url);
  assertEquals(u.origin + u.pathname, "https://www.zohoapis.ae/books/v3/invoices");
  assertEquals(u.searchParams.get("send"), "false");
  assertEquals(u.searchParams.get("organization_id"), "ORG");
  assertEquals(api.init?.method, "POST");
  assertEquals(new Headers(api.init?.headers).get("Authorization"), "Zoho-oauthtoken T");
});

Deno.test("the access token is refreshed once, then reused", async () => {
  const calls: Call[] = [];
  const z = createZohoClient(cfg, fakeFetch(calls, () => Response.json({ code: 0 })));
  await z.get("/items");
  await z.get("/contacts");
  assertEquals(calls.filter((c) => c.url.includes("/oauth/v2/token")).length, 1);
  const tok = calls.find((c) => c.url.includes("/oauth/v2/token"))!;
  assert(String(tok.init?.body).includes("grant_type=refresh_token"));
  assertEquals(new URL(tok.url).origin, "https://accounts.zoho.ae");
});

Deno.test("a disallowed call never reaches the network", async () => {
  const calls: Call[] = [];
  const z = createZohoClient(cfg, fakeFetch(calls, () => Response.json({})));
  await assertRejects(() => z.get("/users"), NotAllowedError);
  assertEquals(calls.length, 0);
});

Deno.test("a failed refresh names no secret", async () => {
  const bad = (() =>
    Promise.resolve(
      Response.json(
        { error: "invalid_code", message: "bad fake-client-secret fake-refresh-token" },
        { status: 400 },
      ),
    )) as typeof fetch;
  const z = createZohoClient(cfg, bad);
  const err = await assertRejects(() => z.get("/items"));
  const msg = (err as Error).message;
  assert(!msg.includes("fake-client-secret"));
  assert(!msg.includes("fake-refresh-token"));
});

Deno.test("an API error becomes ZohoHttpError with code and scrubbed message", async () => {
  const z = createZohoClient(
    cfg,
    fakeFetch([], () =>
      Response.json({ code: 1002, message: "bad T fake-client-secret" }, { status: 404 })),
  );
  const err = await assertRejects(() => z.get("/invoices/9"), ZohoHttpError);
  assertEquals(err.status, 404);
  assertEquals(err.code, 1002);
  assert(!err.message.includes("fake-client-secret"));
});

Deno.test("scrub also hides URL-encoded secrets", () => {
  const secret = "a/b+c=d";
  const form = new URLSearchParams({ k: secret }).toString().slice(2);
  const out = scrub(`x ${encodeURIComponent(secret)} y ${form} z ${secret}`, [secret]);
  assertEquals(out, "x [hidden] y [hidden] z [hidden]");
});

Deno.test("both fetches refuse redirects", async () => {
  const calls: Call[] = [];
  const z = createZohoClient(cfg, fakeFetch(calls, () => Response.json({ code: 0 })));
  await z.get("/items");
  assertEquals(calls.length, 2);
  for (const c of calls) assertEquals(c.init?.redirect, "error");
});

Deno.test("parallel calls refresh the token once", async () => {
  const calls: Call[] = [];
  const z = createZohoClient(cfg, fakeFetch(calls, () => Response.json({ code: 0 })));
  await Promise.all([z.get("/items"), z.get("/contacts")]);
  assertEquals(calls.filter((c) => c.url.includes("/oauth/v2/token")).length, 1);
});

Deno.test("a failed refresh can be retried", async () => {
  let tokenCalls = 0;
  const f = ((input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/oauth/v2/token")) {
      tokenCalls++;
      return Promise.resolve(
        tokenCalls === 1
          ? Response.json({ error: "invalid_code" }, { status: 400 })
          : Response.json({ access_token: "T", expires_in: 3600 }),
      );
    }
    return Promise.resolve(Response.json({ code: 0 }));
  }) as typeof fetch;
  const z = createZohoClient(cfg, f);
  await assertRejects(() => z.get("/items"), ZohoAccessError);
  await z.get("/items");
  assertEquals(tokenCalls, 2);
});

Deno.test("a token reply with an error or no token is a ZohoAccessError", async () => {
  for (const reply of [{ error: "invalid_client fake-client-secret" }, { expires_in: 3600 }]) {
    const f = (() => Promise.resolve(Response.json(reply))) as typeof fetch;
    const err = await assertRejects(() => createZohoClient(cfg, f).get("/items"), ZohoAccessError);
    assert(!err.message.includes("fake-client-secret"));
  }
});

const RECONNECT = "Zoho access has stopped. An admin must reconnect.";

// Token endpoint answers the first call with `first`, then succeeds.
function tokenFetch(first: () => Response, counter: { n: number }): typeof fetch {
  return ((input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/oauth/v2/token")) {
      counter.n++;
      return Promise.resolve(counter.n === 1 ? first() : Response.json({ access_token: "T", expires_in: 3600 }));
    }
    return Promise.resolve(Response.json({ code: 0 }));
  }) as typeof fetch;
}

Deno.test("token endpoint failures map to the right browser message and can be retried", async () => {
  const cases: [string, () => Response, string][] = [
    ["429", () => Response.json({}, { status: 429 }), "Zoho is busy, try again shortly."],
    ["503", () => Response.json({}, { status: 503 }), "Zoho refused the request."],
    [
      "200 rate limit",
      () => Response.json({ error: "You have made too many requests continuously" }),
      "Zoho is busy, try again shortly.",
    ],
    ["400", () => Response.json({ error: "invalid_code" }, { status: 400 }), RECONNECT],
    ["401", () => Response.json({}, { status: 401 }), RECONNECT],
    ["200 invalid_code", () => Response.json({ error: "invalid_code" }), RECONNECT],
  ];
  for (const [name, first, expected] of cases) {
    const counter = { n: 0 };
    const z = createZohoClient(cfg, tokenFetch(first, counter));
    const err = await assertRejects(() => z.get("/items"));
    assertEquals(browserMessage(err), expected, name);
    await z.get("/items");
    assertEquals(counter.n, 2, name);
  }
});

Deno.test("clientKey changes when any setting changes", () => {
  const base = clientKey(cfg);
  assertEquals(clientKey({ ...cfg }), base);
  for (const change of [
    { clientId: "x" },
    { clientSecret: "x" },
    { refreshToken: "x" },
    { orgId: "x" },
    { dc: "com" },
  ]) {
    assert(clientKey({ ...cfg, ...change }) !== base);
  }
});

Deno.test("post overrides a caller-supplied send and organization_id", async () => {
  const calls: Call[] = [];
  const z = createZohoClient(cfg, fakeFetch(calls, () => Response.json({ code: 0 })));
  await z.post("/estimates", {}, { send: "true", organization_id: "OTHER-ORG" });
  const u = new URL(calls.find((c) => !c.url.includes("/oauth/"))!.url);
  assertEquals(u.searchParams.getAll("send"), ["false"]);
  assertEquals(u.searchParams.getAll("organization_id"), ["ORG"]);
});

Deno.test("both fetches carry a timeout signal", async () => {
  const calls: Call[] = [];
  const z = createZohoClient(cfg, fakeFetch(calls, () => Response.json({ code: 0 })));
  await z.get("/items");
  assertEquals(calls.length, 2);
  for (const c of calls) assert(c.init?.signal instanceof AbortSignal);
});

Deno.test("a timed-out request becomes ZohoTimeoutError", async () => {
  const slow = ((input: string | URL | Request) => {
    if (String(input).includes("/oauth/v2/token")) return Promise.resolve(Response.json({ access_token: "T", expires_in: 3600 }));
    return Promise.reject(new DOMException("The signal timed out.", "TimeoutError"));
  }) as typeof fetch;
  const z = createZohoClient(cfg, slow);
  await assertRejects(() => z.post("/invoices", {}), ZohoTimeoutError);
  const slowToken = (() => Promise.reject(new DOMException("The signal timed out.", "TimeoutError"))) as typeof fetch;
  await assertRejects(() => createZohoClient(cfg, slowToken).get("/items"), ZohoTimeoutError);
});

Deno.test("a network failure is not a timeout", async () => {
  const down = ((input: string | URL | Request) => {
    if (String(input).includes("/oauth/v2/token")) return Promise.resolve(Response.json({ access_token: "T", expires_in: 3600 }));
    return Promise.reject(new TypeError("connection reset"));
  }) as typeof fetch;
  const e = await assertRejects(() => createZohoClient(cfg, down).get("/items"));
  assertEquals(e instanceof ZohoTimeoutError, false);
});

Deno.test("a 2xx reply that is not JSON gives a plain error", async () => {
  const z = createZohoClient(cfg, fakeFetch([], () => new Response("<html>gateway</html>", { status: 200 })));
  const e = await assertRejects(() => z.get("/items"), Error, "could not be read");
  assertEquals(e.message.includes("<html>"), false);
});

const pdfReply = (body = "%PDF-1.4 fake", type = "application/pdf") =>
  () => new Response(body, { status: 200, headers: { "Content-Type": type } });

Deno.test("getPdf sends accept=pdf with organization_id and returns the bytes", async () => {
  const calls: Call[] = [];
  const z = createZohoClient(cfg, fakeFetch(calls, pdfReply()));
  const bytes = await z.getPdf("/invoices/9001");
  assertEquals(new TextDecoder().decode(bytes), "%PDF-1.4 fake");
  const api = calls.find((c) => !c.url.includes("/oauth/"))!;
  const u = new URL(api.url);
  assertEquals(u.origin + u.pathname, "https://www.zohoapis.ae/books/v3/invoices/9001");
  assertEquals(u.searchParams.get("accept"), "pdf");
  assertEquals(u.searchParams.get("organization_id"), "ORG");
  assertEquals(api.init?.method, "GET");
  assertEquals(api.init?.redirect, "error");
  assert(api.init?.signal instanceof AbortSignal);
  assertEquals(new Headers(api.init?.headers).get("Authorization"), "Zoho-oauthtoken T");
});

Deno.test("getPdf accepts PDF bytes under another content type", async () => {
  const z = createZohoClient(cfg, fakeFetch([], pdfReply("%PDF-1.7 x", "application/octet-stream")));
  assertEquals((await z.getPdf("/estimates/7001")).length, 10);
});

Deno.test("getPdf refuses a non-PDF reply and a non-digit ID", async () => {
  const calls: Call[] = [];
  const z = createZohoClient(cfg, fakeFetch(calls, pdfReply("<html>login</html>", "text/html")));
  const e = await assertRejects(() => z.getPdf("/invoices/9001"), Error, "did not send a PDF");
  assertEquals(e.message.includes("<html>"), false);
  for (const path of ["/invoices/abc", "/invoices/1/x", "/invoices", "/contacts/1", "/invoices/../users", "/estimates/12?x=1", "/items"]) {
    await assertRejects(() => z.getPdf(path), NotAllowedError);
  }
  assertEquals(calls.filter((c) => !c.url.includes("/oauth/")).length, 1);
});

Deno.test("getPdf refuses a file over 10 MB with a plain error", async () => {
  const big = new Uint8Array(10 * 1024 * 1024 + 1);
  big.set(new TextEncoder().encode("%PDF"));
  const z = createZohoClient(cfg, fakeFetch([], () => new Response(big, { headers: { "Content-Type": "application/pdf" } })));
  await assertRejects(() => z.getPdf("/invoices/9001"), Error, "too large");
  const ok = new Uint8Array(10 * 1024 * 1024);
  ok.set(new TextEncoder().encode("%PDF"));
  const z2 = createZohoClient(cfg, fakeFetch([], () => new Response(ok, { headers: { "Content-Type": "application/pdf" } })));
  assertEquals((await z2.getPdf("/invoices/9001")).length, ok.length);
});

Deno.test("getPdf parses Zoho errors as usual and hides secrets", async () => {
  const z = createZohoClient(cfg, fakeFetch([], () => Response.json({ code: 1002, message: "gone fake-refresh-token" }, { status: 404 })));
  const e = await assertRejects(() => z.getPdf("/invoices/9001"), ZohoHttpError);
  assertEquals(e.status, 404);
  assertEquals(e.message, "gone [hidden]");
});

Deno.test("getPdf allows 30 seconds, other calls 20", async () => {
  const seen: number[] = [];
  const real = AbortSignal.timeout;
  AbortSignal.timeout = (ms: number) => (seen.push(ms), real.call(AbortSignal, ms));
  try {
    let n = 0;
    const z = createZohoClient(cfg, fakeFetch([], () => (++n === 1 ? pdfReply()() : Response.json({ code: 0 }))));
    await z.getPdf("/invoices/9001");
    await z.get("/items");
  } finally {
    AbortSignal.timeout = real;
  }
  assertEquals(seen, [20000, 30000, 20000]);
});

Deno.test("getPdf refuses an empty body and non-PDF bytes even under application/pdf", async () => {
  for (const body of ["", '{"code":5,"message":"error"}']) {
    const z = createZohoClient(cfg, fakeFetch([], pdfReply(body)));
    await assertRejects(() => z.getPdf("/invoices/9001"), Error, "did not send a PDF");
  }
});
