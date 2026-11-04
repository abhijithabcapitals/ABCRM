import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  fiscalMonthFrom,
  ledgerAccountCount,
  readAccounts,
  readCash,
  readLedger,
  readOrganization,
  readPayables,
  readReceivables,
  TRANSACTIONS_PATH,
} from "./zohoSources.ts";
import { assertAllowed } from "./zohoClient.ts";

// deno-lint-ignore no-explicit-any
type Json = any;
type Call = { path: string; q: Record<string, string> };

function fake(fn: (path: string, q: Record<string, string>) => Json) {
  const calls: Call[] = [];
  return {
    calls,
    orgId: "ORG1",
    get: (path: string, q: Record<string, string> = {}) => {
      calls.push({ path, q });
      return Promise.resolve(fn(path, q));
    },
  };
}

Deno.test("every path this file reads is on the client's allowlist", () => {
  for (const p of ["/organizations", "/chartofaccounts", "/invoices", "/bills", "/bankaccounts", TRANSACTIONS_PATH]) {
    assertAllowed("GET", p);
  }
});

Deno.test("fiscal month: month names, the zero-based number, and January when absent", () => {
  assertEquals(fiscalMonthFrom("january"), 1);
  assertEquals(fiscalMonthFrom("April"), 4);
  assertEquals(fiscalMonthFrom(0), 1);
  assertEquals(fiscalMonthFrom(3), 4);
  assertEquals(fiscalMonthFrom(11), 12);
  assertEquals(fiscalMonthFrom("3"), 4);
  for (const bad of [undefined, null, "", "soon", 12, -1, 1.5, true]) assertEquals(fiscalMonthFrom(bad), 1);
});

Deno.test("readOrganization finds this organisation", async () => {
  const z = fake(() => ({
    organizations: [
      { organization_id: "OTHER", currency_code: "USD", fiscal_year_start_month: 6 },
      { organization_id: "ORG1", currency_code: "AED", fiscal_year_start_month: "april" },
    ],
  }));
  assertEquals(await readOrganization(z), { currency: "AED", fiscalStartMonth: 4 });
});

Deno.test("readOrganization defaults the fiscal month to January", async () => {
  const z = fake(() => ({ organizations: [{ organization_id: "ORG1", currency_code: "AED" }] }));
  assertEquals((await readOrganization(z)).fiscalStartMonth, 1);
});

Deno.test("readOrganization fails when the organisation or its currency is missing", async () => {
  await assertRejects(() => readOrganization(fake(() => ({ organizations: [] }))));
  await assertRejects(() => readOrganization(fake(() => ({ organizations: [{ organization_id: "ORG1" }] }))));
});

Deno.test("readAccounts asks for balances, reads every page, and keeps an unknown balance unknown", async () => {
  const z = fake((_p, q) =>
    q.page === "1"
      ? {
        chartofaccounts: [
          { account_id: "1", account_name: "Bank", account_type: "bank", current_balance: 10.5 },
          { account_id: "2", account_name: "AP", account_type: "accounts_payable", current_balance: "20" },
        ],
        page_context: { has_more_page: true },
      }
      : {
        chartofaccounts: [
          { account_id: "3", account_name: "Odd", account_type: "equity", current_balance: null, parent_account_id: "1" },
          { account_id: "4", account_name: "Empty", account_type: "equity" },
          { account_id: "5", account_name: "Word", account_type: "equity", current_balance: "n/a" },
        ],
        page_context: { has_more_page: false },
      }
  );
  const out = await readAccounts(z);
  assertEquals(out.map((a) => a.balance), [10.5, 20, null, null, null]);
  assertEquals(out[0], { id: "1", name: "Bank", type: "bank", balance: 10.5, parentId: null });
  assertEquals(out[2].parentId, "1");
  assertEquals(z.calls.length, 2);
  for (const c of z.calls) assertEquals(c.q.showbalance, "true");
});

Deno.test("a page without pagination details but full of rows asks for the next", async () => {
  const row = { account_id: "1", account_name: "A", account_type: "bank", current_balance: 1 };
  const z = fake((_p, q) => ({ chartofaccounts: q.page === "1" ? Array(200).fill(row) : [row] }));
  assertEquals((await readAccounts(z)).length, 201);
  assertEquals(z.calls.length, 2);
});

Deno.test("a response without the expected list is an error, not an empty list", async () => {
  await assertRejects(() => readAccounts(fake(() => ({ message: "odd" }))));
  await assertRejects(() => readReceivables(fake(() => ({}))));
});

const inv = (id: string, over: Json = {}) => ({
  invoice_id: id,
  customer_name: "Cust",
  status: "sent",
  due_date: "2026-11-01",
  balance: 100,
  currency_code: "AED",
  exchange_rate: 1,
  ...over,
});

Deno.test("readReceivables combines the open filters without counting one invoice twice", async () => {
  const z = fake((_p, q) => {
    if (q.status === "unpaid") return { invoices: [inv("1"), inv("2", { status: "overdue" })] };
    if (q.status === "overdue") return { invoices: [inv("2", { status: "overdue" })] };
    return { invoices: [inv("1"), inv("3", { status: "partially_paid", balance: 40 })] };
  });
  const out = await readReceivables(z);
  assertEquals(out.map((d) => d.balance), [100, 100, 40]);
  assertEquals(out[0], { name: "Cust", dueDate: "2026-11-01", balance: 100, currency: "AED", rate: 1 });
  assertEquals(z.calls.map((c) => c.q.status), ["unpaid", "overdue", "partially_paid"]);
});

Deno.test("readReceivables leaves out paid, draft, void and nil balance documents, and keeps a missing rate missing", async () => {
  const z = fake((_p, q) =>
    q.status === "unpaid"
      ? {
        invoices: [
          inv("1", { status: "paid" }),
          inv("2", { status: "draft" }),
          inv("3", { status: "void" }),
          inv("4", { balance: 0 }),
          inv("5", { currency_code: "USD", exchange_rate: undefined }),
          inv("6", { balance: undefined }),
        ],
      }
      : { invoices: [] }
  );
  const out = await readReceivables(z);
  assertEquals(out.length, 2);
  assertEquals(out[0].rate, null);
  assertEquals(out[0].currency, "USD");
  assertEquals(out[1].balance, null);
});

Deno.test("readPayables uses the bill filters and vendor name", async () => {
  const bill = { bill_id: "9", vendor_name: "Vend", status: "open", due_date: "2026-12-01", balance: 40, currency_code: "AED", exchange_rate: 1 };
  const z = fake(() => ({ bills: [bill] }));
  assertEquals(await readPayables(z), [{ name: "Vend", dueDate: "2026-12-01", balance: 40, currency: "AED", rate: 1 }]);
  assertEquals(z.calls.map((c) => c.q.status), ["open", "overdue", "partially_paid"]);
});

Deno.test("readCash uses base currency balances, leaves out credit cards, and adds cash accounts the list omits", async () => {
  const z = fake(() => ({
    bankaccounts: [
      { account_id: "1", account_name: "AED acct", account_type: "bank", currency_code: "AED", balance: 100, bcy_balance: 100 },
      { account_id: "2", account_name: "USD acct", account_type: "bank", currency_code: "USD", balance: 10, bcy_balance: 36.7 },
      { account_id: "3", account_name: "Card", account_type: "credit_card", currency_code: "AED", balance: 9, bcy_balance: 9 },
      { account_id: "4", account_name: "Plain", account_type: "bank", currency_code: "AED", balance: 5 },
      { account_id: "5", account_name: "No rate", account_type: "bank", currency_code: "EUR", balance: 5 },
    ],
  }));
  const coa = [
    { id: "1", name: "AED acct", type: "bank", balance: 100, parentId: null },
    { id: "6", name: "Petty cash", type: "cash", balance: 7, parentId: null },
    { id: "7", name: "Rent", type: "expense", balance: 50, parentId: null },
  ];
  assertEquals(await readCash(z, coa, "AED"), [
    { name: "AED acct", balance: 100 },
    { name: "USD acct", balance: 36.7 },
    { name: "Plain", balance: 5 },
    { name: "No rate", balance: null },
    { name: "Petty cash", balance: 7 },
  ]);
});

Deno.test("readLedger reads income, expense and cost accounts in the window, netting debits and credits", async () => {
  const accounts = [
    { id: "1", name: "Sales", type: "income", balance: 0, parentId: null },
    { id: "2", name: "Interest", type: "other_income", balance: 0, parentId: null },
    { id: "3", name: "Rent", type: "expense", balance: 0, parentId: null },
    { id: "4", name: "Fines", type: "other_expense", balance: 0, parentId: null },
    { id: "5", name: "Goods", type: "cost_of_goods_sold", balance: 0, parentId: null },
    { id: "6", name: "Bank", type: "bank", balance: 0, parentId: null },
  ];
  const z = fake((path, q) => {
    assertEquals(path, TRANSACTIONS_PATH);
    assertEquals([q.date_start, q.date_end], ["2025-12-01", "2026-11-04"]);
    const byId: Record<string, Json[]> = {
      "1": [
        { transaction_date: "2026-05-01", debit_or_credit: "credit", credit_amount: 100, debit_amount: "" },
        { transaction_date: "2026-05-02", debit_or_credit: "debit", debit_amount: "30", credit_amount: "" },
      ],
      "2": [{ transaction_date: "2026-05-03", credit_amount: 5 }],
      "3": [
        { transaction_date: "2026-05-04", debit_amount: 40 },
        { transaction_date: "2026-05-05", credit_amount: 10 },
      ],
      "4": [{ transaction_date: "2026-05-06", debit_amount: 2 }],
      "5": [{ transaction_date: "2026-05-07", debit_amount: 20 }],
    };
    return { transactions: byId[q.account_id] };
  });
  const out = await readLedger(z, accounts, "2025-12-01", "2026-11-04");
  assertEquals(out, [
    { account: "Sales", kind: "revenue", date: "2026-05-01", amount: 100 },
    { account: "Sales", kind: "revenue", date: "2026-05-02", amount: -30 },
    { account: "Interest", kind: "otherIncome", date: "2026-05-03", amount: 5 },
    { account: "Rent", kind: "expense", date: "2026-05-04", amount: 40 },
    { account: "Rent", kind: "expense", date: "2026-05-05", amount: -10 },
    { account: "Fines", kind: "expense", date: "2026-05-06", amount: 2 },
    { account: "Goods", kind: "cogs", date: "2026-05-07", amount: 20 },
  ]);
  assertEquals(z.calls.length, 5);
});

Deno.test("a transaction with no readable date or amount fails rather than being dropped", async () => {
  const accounts = [{ id: "1", name: "Sales", type: "income", balance: 0, parentId: null }];
  const withRow = (row: Json) => fake(() => ({ transactions: [row] }));
  await assertRejects(() => readLedger(withRow({ credit_amount: 5 }), accounts, "2025-12-01", "2026-11-04"));
  await assertRejects(() => readLedger(withRow({ transaction_date: "2026-13-45", credit_amount: 5 }), accounts, "2025-12-01", "2026-11-04"));
  await assertRejects(() => readLedger(withRow({ transaction_date: "2026-01-01" }), accounts, "2025-12-01", "2026-11-04"));
  await assertRejects(() => readLedger(withRow({ transaction_date: "2026-01-01", credit_amount: "AED 5" }), accounts, "2025-12-01", "2026-11-04"));
});

Deno.test("an open document with no ID fails, so documents cannot collapse into one", async () => {
  const z = fake((_p, q) => ({ invoices: q.status === "unpaid" ? [inv("1", { invoice_id: undefined }), inv("2", { invoice_id: undefined })] : [] }));
  await assertRejects(() => readReceivables(z));
});

Deno.test("a malformed due date fails the refresh; a blank one stays blank", async () => {
  for (const bad of ["soon", "2026-13-45", "04/11/2026"]) {
    const z = fake((_p, q) => ({ invoices: q.status === "unpaid" ? [inv("1", { due_date: bad })] : [] }));
    await assertRejects(() => readReceivables(z));
  }
  const z = fake((_p, q) => ({ invoices: q.status === "unpaid" ? [inv("1", { due_date: "" })] : [] }));
  assertEquals((await readReceivables(z))[0].dueDate, null);
});

Deno.test("ledgerAccountCount counts income and cost accounts only", () => {
  const a = (type: string) => ({ id: "1", name: "A", type, balance: 0, parentId: null });
  assertEquals(ledgerAccountCount([a("income"), a("other_income"), a("expense"), a("other_expense"), a("cost_of_goods_sold"), a("bank"), a("equity")]), 5);
});
