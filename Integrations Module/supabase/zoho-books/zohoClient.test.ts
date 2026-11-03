import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import {
  assertAllowed,
  createZohoClient,
  hostsFor,
  NotAllowedError,
  scrub,
  ZohoHttpError,
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
