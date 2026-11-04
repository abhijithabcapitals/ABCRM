import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { browserMessage, handle, UserError } from "./handlers.ts";
import { ZohoAccessError, ZohoHttpError } from "./zohoClient.ts";
import { MissingSecretError } from "./secrets.ts";

// deno-lint-ignore no-explicit-any
type Json = any;

const NAMES = ["Acme Trading LLC", "Secret Customer FZE", "Rent Payable Co", "Jane Doe"];
const AMOUNTS = ["987654.32", "123456.78", "424242.42"];

function sample(path: string, q: Record<string, string> = {}): Json {
  if (path === "/organizations") {
    return { organizations: [{ organization_id: "ORG1", name: NAMES[0], fiscal_year_start_month: 4, currency_code: "AED" }] };
  }
  if (path === "/chartofaccounts") {
    return {
      chartofaccounts: [
        { account_id: "9001001", account_name: NAMES[1], account_type: "income", current_balance: 987654.32 },
        { account_id: "9001002", account_name: NAMES[2], account_type: "expense", current_balance: -123456.78 },
        { account_id: "9001003", account_name: "Bank", account_type: "bank", current_balance: 0 },
      ],
    };
  }
  if (path === "/chartofaccounts/transactions" || path === "/chartofaccounts/accounttransactions") {
    return {
      transactions: [{ transaction_id: "7001", date: q.date_start ?? "2026-01-05", debit_amount: 424242.42, customer_name: NAMES[3], description: NAMES[1] }],
      page_context: { page: 1, has_more_page: false },
    };
  }
  if (path === "/invoices") {
    return {
      invoices: [{ invoice_id: "5001", customer_name: NAMES[0], total: 987654.32, currency_code: "USD", exchange_rate: 3.67 }],
      page_context: { total: 1 },
    };
  }
  if (path === "/bills") {
    return { bills: [{ bill_id: "6001", vendor_name: NAMES[2], total: 123456.78, currency_code: "AED" }], page_context: { total: 1 } };
  }
  return {};
}

function makeDeps(over: Record<string, unknown> = {}) {
  const deps = {
    isAdmin: () => Promise.resolve(true),
    db: {},
    zoho: () => Promise.resolve({ orgId: "ORG1", get: (p: string, q?: Record<string, string>) => Promise.resolve(sample(p, q)) }),
    now: () => new Date("2026-11-04T00:00:00Z"),
    ...over,
  };
  return deps as Json;
}

Deno.test("a non-admin is refused on both actions", async () => {
  const deps = makeDeps({ isAdmin: () => Promise.resolve(false) });
  for (const a of ["connection_test", "probe"]) {
    await assertRejects(() => handle(a, {}, deps), UserError);
  }
});

Deno.test("unknown action is a UserError", async () => {
  await assertRejects(() => handle("nope", {}, makeDeps()), UserError);
});

Deno.test("connection_test returns the organisation name", async () => {
  assertEquals(await handle("connection_test", {}, makeDeps()), { connected: true, organisation: NAMES[0] });
});

Deno.test("connection_test says not connected, in plain words, on ZohoAccessError", async () => {
  const deps = makeDeps({ zoho: () => Promise.reject(new ZohoAccessError("invalid_code fake-detail")) });
  const out = await handle("connection_test", {}, deps) as Json;
  assertEquals(out.connected, false);
  assert(typeof out.message === "string" && out.message.length > 0);
  assert(!out.message.includes("fake-detail"));
});

Deno.test("missing secret gives connected false", async () => {
  const deps = makeDeps({ zoho: () => Promise.reject(new MissingSecretError("ZOHO_FINANCE_CLIENT_ID")) });
  const out = await handle("probe", {}, deps) as Json;
  assertEquals(out.connected, false);
});

Deno.test("probe output holds no name, amount or id from the sample data", async () => {
  const out = await handle("probe", {}, makeDeps()) as Json;
  const text = JSON.stringify(out);
  for (const bad of [...NAMES, ...AMOUNTS, "987654", "123456", "424242", "9001001", "9001002", "7001", "5001", "6001", "ORG1", "Bank"]) {
    assert(!text.includes(bad), `probe output leaks ${bad}`);
  }
  assertEquals(out.fiscalStartMonth, 4);
  assertEquals(out.baseCurrency, "AED");
  assertEquals(out.accountTypes.find((t: Json) => t.type === "income"), { type: "income", count: 1, balanceSign: "pos" });
  assertEquals(out.accountTypes.find((t: Json) => t.type === "expense").balanceSign, "neg");
  assertEquals(out.accountTypes.find((t: Json) => t.type === "bank").balanceSign, "zero");
  assertEquals(out.otherCurrency, { invoices: 1, bills: 0, listHasExchangeRate: true });
  assertEquals(out.openFilters.invoices.status_unpaid, 1);
  assertEquals(out.transactionsPath["/chartofaccounts/transactions"], 200);
  assert(out.transactionFields.includes("debit_amount"));
  assert(typeof out.callsNeededFor12Months === "number");
});

Deno.test("probe records a refused path as its HTTP status", async () => {
  const deps = makeDeps({
    zoho: () => Promise.resolve({
      orgId: "ORG1",
      get: (p: string, q?: Record<string, string>) =>
        p === "/chartofaccounts/accounttransactions" ? Promise.reject(new ZohoHttpError(404, "x")) : Promise.resolve(sample(p, q)),
    }),
  });
  const out = await handle("probe", {}, deps) as Json;
  assertEquals(out.transactionsPath["/chartofaccounts/accounttransactions"], 404);
});

Deno.test("browserMessage hides detail", () => {
  assertEquals(browserMessage(new ZohoHttpError(429, "x")), "Zoho is busy, try again shortly.");
  assertEquals(browserMessage(new ZohoHttpError(400, "secret")), "Zoho refused the request.");
  assertEquals(browserMessage(new ZohoAccessError("secret")), "Zoho access has stopped. An admin must reconnect.");
  assertEquals(browserMessage(new Error("secret")), "Something went wrong talking to Zoho.");
});
