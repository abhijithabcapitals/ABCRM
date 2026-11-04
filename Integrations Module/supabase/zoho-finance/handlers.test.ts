import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { browserMessage, handle, UserError } from "./handlers.ts";
import { ZohoAccessError, ZohoHttpError } from "./zohoClient.ts";
import { MissingSecretError } from "./secrets.ts";

// deno-lint-ignore no-explicit-any
type Json = any;

const NAMES = ["Acme Trading LLC", "Secret Customer FZE", "Rent Payable Co", "Jane Doe"];
const calls: { path: string; q: Record<string, string> }[] = [];
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
    zoho: () =>
      Promise.resolve({
        orgId: "ORG1",
        get: (p: string, q?: Record<string, string>) => {
          calls.push({ path: p, q: q ?? {} });
          return Promise.resolve(sample(p, q));
        },
      }),
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
  assertEquals(out.otherCurrency, {
    invoices: { status: 200, count: 1, capped: false },
    bills: { status: 200, count: 0, capped: false },
    listHasExchangeRate: { invoices: true, bills: false },
  });
  assertEquals(out.openFilters.invoices.status_unpaid, { status: 200, count: 1, capped: false });
  assertEquals(out.dateParamsWorked, true);
  assertEquals(out.dateParamStyle, "date_start");
  assertEquals(out.transactionsPath["/chartofaccounts/transactions"], 200);
  assert(out.transactionFields.includes("debit_amount"));
  assertEquals(out.callsNeededFor12Months, { calls: 6, capped: false });
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

function depsWith(fn: (p: string, q: Record<string, string>) => Json) {
  return makeDeps({
    zoho: () => Promise.resolve({ orgId: "ORG1", get: (p: string, q?: Record<string, string>) => Promise.resolve(fn(p, q ?? {})) }),
  });
}

Deno.test("every chart of accounts call asks for balances", async () => {
  calls.length = 0;
  await handle("probe", {}, makeDeps());
  const coa = calls.filter((c) => c.path === "/chartofaccounts");
  assertEquals(coa.length, 3);
  for (const c of coa) assertEquals(c.q.showbalance, "true");
});

Deno.test("a missing balance is unknown, never zero", async () => {
  const out = await handle("probe", {}, depsWith((p, q) => {
    const r = sample(p, q);
    if (p === "/chartofaccounts") for (const a of r.chartofaccounts) delete a.current_balance;
    return r;
  })) as Json;
  for (const t of out.accountTypes) assertEquals(t.balanceSign, "unknown");
  assertEquals(out.incomeOrExpenseBalanceChangesWithDate, "unknown");
});

Deno.test("a rejected filter is a status, not a zero count", async () => {
  const out = await handle("probe", {}, depsWith((p, q) => {
    if (p === "/invoices" && q.status === "overdue") throw new ZohoHttpError(400, "bad filter");
    return sample(p, q);
  })) as Json;
  assertEquals(out.openFilters.invoices.status_overdue, { status: 400, count: null, capped: false });
  assertEquals(out.openFilters.invoices.status_unpaid.count, 1);
});

Deno.test("failed document lists give no other-currency answer", async () => {
  const out = await handle("probe", {}, depsWith((p, q) => {
    if (p === "/invoices" || p === "/bills") throw new ZohoHttpError(429, "busy");
    return sample(p, q);
  })) as Json;
  assertEquals(out.otherCurrency.invoices, { status: 429, count: null, capped: false });
  assertEquals(out.otherCurrency.listHasExchangeRate, { invoices: "unknown", bills: "unknown" });
});

Deno.test("a page with more pages and no total is capped", async () => {
  const out = await handle("probe", {}, depsWith((p, q) => {
    const r = sample(p, q);
    if (p === "/invoices") r.page_context = { has_more_page: true };
    return r;
  })) as Json;
  assertEquals(out.openFilters.invoices.status_unpaid, { status: 200, count: 1, capped: true });
  assertEquals(out.otherCurrency.invoices.capped, true);
});

Deno.test("dormant accounts give unknown date support, not true", async () => {
  const out = await handle("probe", {}, depsWith((p, q) => {
    const r = sample(p, q);
    if (p.startsWith("/chartofaccounts/")) r.transactions = [];
    return r;
  })) as Json;
  assertEquals(out.dateParamsWorked, "unknown");
  assertEquals(out.dateParamStyle, "unknown");
});

Deno.test("a window that leaks rows outside it is false", async () => {
  const out = await handle("probe", {}, depsWith((p, q) => {
    const r = sample(p, q);
    if (p.startsWith("/chartofaccounts/")) r.transactions[0].date = "2001-01-01";
    return r;
  })) as Json;
  assertEquals(out.dateParamsWorked, false);
});

Deno.test("transaction_date and the dotted style are understood", async () => {
  const out = await handle("probe", {}, depsWith((p, q) => {
    const r = sample(p, q);
    if (p.startsWith("/chartofaccounts/")) {
      const t = r.transactions[0];
      const start = q["date.start"];
      delete t.date;
      t.transaction_date = start ?? "2001-01-01";
      if (!start) r.transactions = [];
    }
    return r;
  })) as Json;
  assertEquals(out.dateParamsWorked, true);
  assertEquals(out.dateParamStyle, "date.start");
});

Deno.test("cost of goods sold counts, and the page cap is reported", async () => {
  const out = await handle("probe", {}, depsWith((p, q) => {
    const r = sample(p, q);
    if (p === "/chartofaccounts") {
      r.chartofaccounts = [{ account_id: "1", account_type: "cost_of_goods_sold", current_balance: 5 }];
    }
    if (p.startsWith("/chartofaccounts/")) r.page_context = { has_more_page: true };
    return r;
  })) as Json;
  assertEquals(out.callsNeededFor12Months, { calls: 6 + 4, capped: true });
});

Deno.test("odd field names are not reported", async () => {
  const out = await handle("probe", {}, depsWith((p, q) => {
    const r = sample(p, q);
    if (p.startsWith("/chartofaccounts/")) { r.transactions[0]["cf_secret"] = "x"; r.transactions[0]["Acme Co"] = "y"; }
    return r;
  })) as Json;
  assert(!out.transactionFields.includes("cf_secret"));
  assert(!out.transactionFields.includes("Acme Co"));
});

function checkDeps(chart: Json[], bank: Json = undefined) {
  return depsWith((p, q) => {
    if (p === "/chartofaccounts") return { chartofaccounts: chart };
    if (p === "/bankaccounts" && bank) return bank;
    return sample(p, q);
  });
}
const acct = (id: string, type: string, current_balance: Json, parent_account_id?: string) => ({ account_id: id, account_type: type, current_balance, parent_account_id });

Deno.test("probe counts parents with a balance and tests whether they equal their children", async () => {
  const rollup = await handle("probe", {}, checkDeps([
    acct("P", "expense", 30), acct("C1", "expense", 10, "P"), acct("C2", "expense", 20, "P"),
    acct("Q", "expense", 0), acct("C3", "expense", 5, "Q"),
  ])) as Json;
  assertEquals(rollup.parentsWithBalance, 1);
  assertEquals(rollup.parentEqualsChildren, true);

  const own = await handle("probe", {}, checkDeps([acct("P", "expense", 31), acct("C1", "expense", 10, "P")])) as Json;
  assertEquals(own.parentsWithBalance, 1);
  assertEquals(own.parentEqualsChildren, false);

  const none = await handle("probe", {}, checkDeps([acct("P", "expense", 0), acct("C1", "expense", 10, "P"), acct("X", "bank", 4)])) as Json;
  assertEquals(none.parentsWithBalance, 0);
  assertEquals(none.parentEqualsChildren, "unknown");

  const missing = await handle("probe", {}, checkDeps([acct("P", "expense", null), acct("C1", "expense", 10, "P")])) as Json;
  assertEquals(missing.parentsWithBalance, "unknown");
  assertEquals(missing.parentEqualsChildren, "unknown");
});

Deno.test("probe tests assets minus liabilities against equity", async () => {
  const check = async (chart: Json[]) => ((await handle("probe", {}, checkDeps(chart))) as Json).assetsMinusLiabilitiesEqualsEquity;
  const base = [acct("1", "bank", 100), acct("2", "fixed_asset", 50), acct("3", "accounts_payable", 30), acct("4", "long_term_liability", 20)];
  assertEquals(await check([...base, acct("5", "equity", 100), acct("6", "income", 999)]), true);
  assertEquals(await check([...base, acct("5", "equity", 60)]), false);
  assertEquals(await check([...base, acct("5", "equity", null)]), "unknown");
  assertEquals(await check([...base, acct("5", "equity", 100), acct("7", "some_new_type", 8)]), "unknown");
  assertEquals(await check([]), "unknown");
});

Deno.test("probe tests the bank list against the chart's bank plus cash, leaving out cards", async () => {
  const chart = [acct("1", "bank", 100), acct("2", "cash", 20), acct("3", "credit_card", 9)];
  const check = async (bank: Json) => ((await handle("probe", {}, checkDeps(chart, bank))) as Json).cashMatchesChart;
  const row = (over: Json) => ({ account_id: "1", account_type: "bank", currency_code: "AED", ...over });
  assertEquals(await check({ bankaccounts: [row({ bcy_balance: 120 }), row({ account_type: "credit_card", bcy_balance: 9 })] }), true);
  assertEquals(await check({ bankaccounts: [row({ balance: 120 })] }), true);
  assertEquals(await check({ bankaccounts: [row({ bcy_balance: 100 })] }), false);
  assertEquals(await check({ bankaccounts: [row({ currency_code: "USD", balance: 120 })] }), "unknown");
  assertEquals(await check({ bankaccounts: [] }), "unknown");
  assertEquals(await check({ bankaccounts: [row({ bcy_balance: 120 })], page_context: { has_more_page: true } }), "unknown");
});

Deno.test("a failed or cut-off chart gives unknown for all the new checks", async () => {
  const failed = await handle("probe", {}, depsWith((p, q) => {
    if (p === "/chartofaccounts") throw new ZohoHttpError(500, "x");
    return sample(p, q);
  })) as Json;
  const cut = await handle("probe", {}, depsWith((p, q) => {
    if (p === "/chartofaccounts") return { chartofaccounts: [acct("1", "bank", 1)], page_context: { has_more_page: true } };
    return sample(p, q);
  })) as Json;
  for (const out of [failed, cut]) {
    for (const k of ["parentsWithBalance", "parentEqualsChildren", "assetsMinusLiabilitiesEqualsEquity", "cashMatchesChart"]) {
      assertEquals(out[k], "unknown", k);
    }
  }
});

Deno.test("the new checks leak no amount, name or ID", async () => {
  const out = await handle("probe", {}, checkDeps([
    { ...acct("9001001", "bank", 987654.32), account_name: NAMES[1] },
    { ...acct("9001002", "equity", 987654.32), account_name: NAMES[2] },
    { ...acct("9001003", "expense", 123456.78, "9001009"), account_name: NAMES[3] },
    { ...acct("9001009", "expense", 123456.78), account_name: NAMES[0] },
  ], { bankaccounts: [{ account_id: "9001001", account_name: NAMES[1], account_type: "bank", currency_code: "AED", bcy_balance: 987654.32 }] })) as Json;
  assertEquals(out.parentEqualsChildren, true);
  assertEquals(out.assetsMinusLiabilitiesEqualsEquity, true);
  assertEquals(out.cashMatchesChart, true);
  const text = JSON.stringify(out);
  for (const bad of [...NAMES, "987654", "123456", "9001001", "9001002", "9001003", "9001009"]) {
    assert(!text.includes(bad), `probe output leaks ${bad}`);
  }
});

const TX_A = "/chartofaccounts/transactions";
const TX_B = "/chartofaccounts/accounttransactions";
const txDeps = (transactions: (path: string, q: Record<string, string>) => Json) =>
  makeDeps({
    zoho: () =>
      Promise.resolve({
        orgId: "ORG1",
        get: (p: string, q: Record<string, string> = {}) => Promise.resolve(p === TX_A || p === TX_B ? transactions(p, q) : sample(p, q)),
      }),
  });
const txRow = (id: string) => ({ transaction_id: id, date: "2026-10-20", debit_amount: 424242.42 });

Deno.test("account filter: different rows per account is true", async () => {
  const out = await handle("probe", {}, txDeps((_p, q) => ({ transactions: [txRow(q.account_id)], page_context: { has_more_page: false } }))) as Json;
  assertEquals(out.accountFilterWorked, true);
  assertEquals(out.accountFilterByPath, { [TX_A]: true, [TX_B]: true });
});

Deno.test("account filter: the same rows for both accounts is false, in any order", async () => {
  let turn = 0;
  const out = await handle("probe", {}, txDeps(() => {
    const rows = [txRow("1"), txRow("2")];
    return { transactions: turn++ % 2 ? rows : rows.reverse() };
  })) as Json;
  assertEquals(out.accountFilterWorked, false);
});

Deno.test("account filter: one account dormant and one not is true", async () => {
  const out = await handle("probe", {}, txDeps((_p, q) => ({ transactions: q.account_id === "9001001" ? [] : [txRow("1")] }))) as Json;
  assertEquals(out.accountFilterWorked, true);
});

Deno.test("account filter: both empty, failed replies, or one sample account is unknown", async () => {
  const empty = await handle("probe", {}, txDeps(() => ({ transactions: [] }))) as Json;
  assertEquals(empty.accountFilterWorked, "unknown");
  const failed = await handle("probe", {}, txDeps(() => Promise.reject(new ZohoHttpError(500, "x")))) as Json;
  assertEquals(failed.accountFilterWorked, "unknown");
  const one = await handle("probe", {}, makeDeps({
    zoho: () =>
      Promise.resolve({
        orgId: "ORG1",
        get: (p: string, q: Record<string, string> = {}) =>
          Promise.resolve(
            p === "/chartofaccounts"
              ? { chartofaccounts: [{ account_id: "1", account_name: "A", account_type: "income", current_balance: 1 }] }
              : sample(p, q),
          ),
      }),
  })) as Json;
  assertEquals(one.accountFilterWorked, "unknown");
});

Deno.test("account filter: a path that ignored it makes the answer false, and the path is named", async () => {
  const out = await handle("probe", {}, txDeps((p, q) => ({ transactions: [txRow(p === TX_A ? "same" : q.account_id)] }))) as Json;
  assertEquals(out.accountFilterWorked, false);
  assertEquals(out.accountFilterByPath, { [TX_A]: false, [TX_B]: true });
});

Deno.test("the probe says which key held the rows on each path", async () => {
  const out = await handle("probe", {}, txDeps((p) => (p === TX_A ? { transactions: [txRow("1")] } : { accounttransactions: [txRow("1")] }))) as Json;
  assertEquals(out.transactionsReplyKey, { [TX_A]: "transactions", [TX_B]: "accounttransactions" });
  assert(out.transactionFields.includes("debit_amount"));
});

Deno.test("the probe names another list key the refresh would refuse, and no key at all", async () => {
  const out = await handle("probe", {}, txDeps((p) => (p === TX_A ? { account_lines: [txRow("1")], code: 0 } : { code: 0 }))) as Json;
  assertEquals(out.transactionsReplyKey, { [TX_A]: "account_lines", [TX_B]: "none" });
  assertEquals(out.transactionFields, []);
});

Deno.test("the probe's rows and readLedger agree: a non-array under the first key falls to the second", async () => {
  const out = await handle("probe", {}, txDeps(() => ({ transactions: "odd", accounttransactions: [txRow("1")] }))) as Json;
  assertEquals(out.transactionsReplyKey[TX_A], "accounttransactions");
  assert(out.transactionFields.includes("debit_amount"));
});

Deno.test("a refused path has no reply key", async () => {
  const out = await handle("probe", {}, txDeps((p) => (p === TX_A ? Promise.reject(new ZohoHttpError(404, "x")) : { transactions: [] }))) as Json;
  assertEquals(out.transactionsReplyKey, { [TX_A]: "unknown", [TX_B]: "transactions" });
});

Deno.test("the exchange rate is reported separately for invoices and bills", async () => {
  const withLists = (invoices: Json, bills: Json) =>
    makeDeps({
      zoho: () =>
        Promise.resolve({
          orgId: "ORG1",
          get: (p: string, q: Record<string, string> = {}) =>
            Promise.resolve(p === "/invoices" ? invoices : p === "/bills" ? bills : sample(p, q)),
        }),
    });
  const rate = (over: Json = {}) => ({ currency_code: "AED", ...over });
  const a = await handle("probe", {}, withLists({ invoices: [rate()] }, { bills: [rate({ exchange_rate: 1 })] })) as Json;
  assertEquals(a.otherCurrency.listHasExchangeRate, { invoices: false, bills: true });
  const b = await handle("probe", {}, withLists({ invoices: [] }, { bills: [rate({ exchange_rate: "" })] })) as Json;
  assertEquals(b.otherCurrency.listHasExchangeRate, { invoices: "unknown", bills: false });
});

Deno.test("the probe reports which lists say whether more pages exist", async () => {
  const plain = await handle("probe", {}, makeDeps()) as Json;
  assertEquals(plain.pageContext, {
    chartofaccounts: false,
    bankaccounts: false,
    invoices: false,
    bills: false,
    transactions: { [TX_A]: true, [TX_B]: true },
  });
  const none = await handle("probe", {}, txDeps(() => ({ transactions: [] }))) as Json;
  assertEquals(none.pageContext.transactions, { [TX_A]: false, [TX_B]: false });
});

Deno.test("the new probe answers leak no amount, name or ID", async () => {
  const out = await handle("probe", {}, txDeps((p, q) => (p === TX_A ? { transactions: [txRow(q.account_id)] } : { account_lines: [txRow("7001")] }))) as Json;
  const text = JSON.stringify({ ...out, transactionFields: [] });
  for (const bad of [...NAMES, ...AMOUNTS, "9001001", "9001002", "7001", "ORG1"]) {
    assert(!text.includes(bad), `probe output leaks ${bad}`);
  }
});
