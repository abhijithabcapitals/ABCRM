import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { assertAllowed, createFinanceClient, NotAllowedError, ZohoHttpError } from "./zohoClient.ts";

const cfg = {
  clientId: "fake-client-id",
  clientSecret: "fake-client-secret",
  refreshToken: "fake-refresh-token",
  orgId: "ORG",
  dc: "ae",
};

Deno.test("refuses writes and every path not on the list", () => {
  for (
    const [m, p] of [
      ["POST", "/invoices"],
      ["PUT", "/invoices/1"],
      ["DELETE", "/bills/1"],
      ["GET", "/reports/profitandloss"],
      ["GET", "/invoices/1/email"],
      ["GET", "/invoices/1"],
      ["GET", "/contacts"],
    ]
  ) assertThrows(() => assertAllowed(m, p), NotAllowedError);
});

Deno.test("allows the listed reads", () => {
  for (
    const p of [
      "/organizations", "/invoices", "/bills", "/bankaccounts", "/chartofaccounts",
      "/chartofaccounts/transactions", "/chartofaccounts/accounttransactions", "/expenses",
    ]
  ) assertAllowed("GET", p);
});

Deno.test("the client has no post", () => {
  const client = createFinanceClient(cfg, () => Promise.reject(new Error("no network")));
  assertEquals(Object.keys(client), ["get"]);
  assert(!("post" in client));
});

Deno.test("a failed call message holds none of the secrets", async () => {
  const fetchFn = (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("/oauth/v2/token")) {
      return Promise.resolve(Response.json({ access_token: "fake-access-token", expires_in: 3600 }));
    }
    return Promise.resolve(
      Response.json(
        { message: "bad fake-client-secret fake-refresh-token fake-client-id fake-access-token" },
        { status: 400 },
      ),
    );
  };
  const client = createFinanceClient(cfg, fetchFn as typeof fetch);
  const err = await assertRejects(() => client.get("/invoices"), ZohoHttpError);
  for (const s of ["fake-client-secret", "fake-refresh-token", "fake-client-id", "fake-access-token"]) {
    assert(!err.message.includes(s), `message leaks ${s}`);
  }
});

Deno.test("a disallowed path never reaches the network", async () => {
  let calls = 0;
  const client = createFinanceClient(cfg, () => {
    calls++;
    return Promise.reject(new Error("no network"));
  });
  await assertRejects(() => client.get("/reports/profitandloss"), NotAllowedError);
  assertEquals(calls, 0);
});
