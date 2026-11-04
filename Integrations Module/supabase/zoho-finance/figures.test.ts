import { assertEquals } from "jsr:@std/assert@1";
import { agingBuckets, buildFigures, type FiguresInput, healthBand, healthScore, topOverdue } from "./figures.ts";

const today = "2026-11-04";

// A date this many days before today (a negative number is in the future).
function daysAgo(n: number): string {
  const d = new Date(Date.UTC(2026, 10, 4));
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
const doc = (days: number, amount: number, name = "A") => ({ name, dueDate: daysAgo(days), amount });

function input(over: Partial<FiguresInput> = {}): FiguresInput {
  return {
    currency: "AED",
    fiscalStartMonth: 1,
    receivables: [],
    payables: [],
    balances: [],
    cash: [],
    ledger: [],
    ...over,
  };
}
const open = (balance: number | null, currency = "AED", rate: number | null = 1, days = 0, name = "A") => ({
  name,
  dueDate: daysAgo(days),
  balance,
  currency,
  rate,
});

Deno.test("agingBuckets places each boundary day", () => {
  const cases: [number, keyof ReturnType<typeof agingBuckets>][] = [
    [-5, "current"],
    [0, "current"],
    [1, "d1_30"],
    [30, "d1_30"],
    [31, "d31_60"],
    [60, "d31_60"],
    [61, "d61_90"],
    [90, "d61_90"],
    [91, "d90p"],
  ];
  for (const [days, bucket] of cases) {
    const a = agingBuckets([doc(days, 10)], today);
    assertEquals(a[bucket], 10, `${days} days past due`);
    assertEquals(a.total, 10);
  }
});

Deno.test("agingBuckets sums without floating point dust", () => {
  const a = agingBuckets([doc(1, 0.1), doc(2, 0.2)], today);
  assertEquals(a.d1_30, 0.3);
  assertEquals(a.total, 0.3);
});

Deno.test("agingBuckets treats a document with no due date as current", () => {
  assertEquals(agingBuckets([{ name: "A", dueDate: null, amount: 5 }], today).current, 5);
});

Deno.test("topOverdue groups by name, skips what is not overdue, and keeps the largest", () => {
  const docs = [
    doc(10, 100, "A"), doc(20, 50, "A"), doc(5, 120, "B"), doc(0, 9999, "NotDue"),
    doc(1, 10, "C"), doc(1, 20, "D"), doc(1, 30, "E"), doc(1, 40, "F"),
  ];
  assertEquals(topOverdue(docs, today, "name"), [
    { name: "A", amount: 150 },
    { name: "B", amount: 120 },
    { name: "F", amount: 40 },
    { name: "E", amount: 30 },
    { name: "D", amount: 20 },
  ]);
  assertEquals(topOverdue(docs, today, "name", 1), [{ name: "A", amount: 150 }]);
});

Deno.test("current assets exclude fixed assets, and include each listed type", () => {
  const f = buildFigures(input({
    balances: [
      { type: "accounts_receivable", balance: 100 },
      { type: "cash", balance: 50 },
      { type: "bank", balance: 25 },
      { type: "stock", balance: 15 },
      { type: "other_current_asset", balance: 10 },
      { type: "fixed_asset", balance: 1000 },
      { type: "accounts_payable", balance: 40 },
      { type: "credit_card", balance: 40 },
      { type: "other_current_liability", balance: 20 },
    ],
  }), today);
  // 200 / 100
  assertEquals(f.ratios.current, 2);
});

Deno.test("quick ratio excludes stock", () => {
  const f = buildFigures(input({
    balances: [
      { type: "bank", balance: 100 },
      { type: "stock", balance: 50 },
      { type: "accounts_payable", balance: 100 },
    ],
  }), today);
  assertEquals(f.ratios.current, 1.5);
  assertEquals(f.ratios.quick, 1);
});

Deno.test("cash ratio uses the cash section over current liabilities", () => {
  const f = buildFigures(input({
    cash: [{ name: "Main", balance: 30 }, { name: "Petty", balance: 20 }],
    balances: [{ type: "accounts_payable", balance: 200 }],
  }), today);
  assertEquals(f.cash, { total: 50, accounts: [{ name: "Main", balance: 30 }, { name: "Petty", balance: 20 }] });
  assertEquals(f.ratios.cash, 0.25);
});

Deno.test("debt to equity includes long-term liabilities", () => {
  const f = buildFigures(input({
    balances: [
      { type: "accounts_payable", balance: 100 },
      { type: "long_term_liability", balance: 300 },
      { type: "equity", balance: 200 },
    ],
  }), today);
  assertEquals(f.ratios.debtToEquity, 2);
});

Deno.test("zero current liabilities, revenue and equity give null, never zero", () => {
  const f = buildFigures(input({ balances: [{ type: "bank", balance: 100 }] }), today);
  assertEquals(f.ratios.current, null);
  assertEquals(f.ratios.quick, null);
  assertEquals(f.ratios.cash, null);
  assertEquals(f.ratios.debtToEquity, null);
  assertEquals(f.ratios.dso, null);
  assertEquals(f.ratios.dpo, null);
  assertEquals(f.ytd!.netMargin, null);
  assertEquals(f.ytd!.grossMargin, null);
});

Deno.test("a balance that is unknown makes its ratio null, not a smaller number", () => {
  const f = buildFigures(input({
    balances: [
      { type: "bank", balance: null },
      { type: "accounts_payable", balance: 100 },
      { type: "equity", balance: 100 },
    ],
  }), today);
  assertEquals(f.ratios.current, null);
  assertEquals(f.ratios.debtToEquity, 1);
});

Deno.test("a difference over 1 between aging and ledger is reported, and exactly 1 is not", () => {
  const withLedger = (ledger: number) =>
    buildFigures(input({
      receivables: [open(100)],
      balances: [{ type: "accounts_receivable", balance: ledger }],
    }), today).ar!;
  assertEquals(withLedger(99).difference, null);
  assertEquals(withLedger(101).difference, null);
  assertEquals(withLedger(98.99).difference, 1.01);
  assertEquals(withLedger(101.01).difference, -1.01);
  assertEquals(withLedger(98.99).ledger, 98.99);
  // 100.1 - 99.1 is 0.9999999999999 or 1.0000000000001 in floating point. It is exactly 1 in money.
  const ar = buildFigures(input({
    receivables: [open(100.1)],
    balances: [{ type: "accounts_receivable", balance: 99.1 }],
  }), today).ar!;
  assertEquals(ar.difference, null);
});

Deno.test("an unknown ledger gives no difference and no ledger figure", () => {
  const f = buildFigures(input({ receivables: [open(100)] }), today);
  assertEquals(f.ar!.ledger, null);
  assertEquals(f.ar!.difference, null);
  const g = buildFigures(input({ receivables: [open(100)], balances: null }), today);
  assertEquals(g.ar!.total, 100);
  assertEquals(g.ar!.ledger, null);
});

Deno.test("a foreign document with a rate converts, and one with no rate is excluded and counted", () => {
  const f = buildFigures(input({
    receivables: [
      open(100),
      open(10, "USD", 3.67),
      open(500, "EUR", null),
      open(600, "EUR", 0),
      open(null),
    ],
  }), today);
  assertEquals(f.ar!.total, 136.7);
  assertEquals(f.ar!.excluded, 3);
});

Deno.test("a base currency document needs no rate", () => {
  assertEquals(buildFigures(input({ payables: [open(100, "AED", null)] }), today).ap!.total, 100);
});

Deno.test("AR and AP carry aging and the top overdue list", () => {
  const f = buildFigures(input({
    receivables: [open(100, "AED", 1, 10, "Cust"), open(50, "AED", 1, 0, "Cust")],
    payables: [open(70, "USD", 2, 95, "Vend")],
  }), today);
  assertEquals(f.ar!.aging, { current: 50, d1_30: 100, d31_60: 0, d61_90: 0, d90p: 0, total: 150 });
  assertEquals(f.ar!.top, [{ name: "Cust", amount: 100 }]);
  assertEquals(f.ap!.aging.d90p, 140);
  assertEquals(f.ap!.top, [{ name: "Vend", amount: 140 }]);
});

const entry = (account: string, kind: "revenue" | "expense" | "cogs", date: string, amount: number) => ({ account, kind, date, amount });

Deno.test("monthly has 12 months ending this month, and ignores what is outside them", () => {
  const f = buildFigures(input({
    ledger: [
      entry("Sales", "revenue", "2026-11-04", 100),
      entry("Sales", "revenue", "2026-11-05", 7777), // after today
      entry("Sales", "revenue", "2025-12-01", 40),
      entry("Sales", "revenue", "2025-11-30", 8888), // before the window
      entry("Rent", "expense", "2026-11-01", 30),
      entry("Goods", "cogs", "2026-11-02", 20),
    ],
  }), today);
  assertEquals(f.monthly!.length, 12);
  assertEquals(f.monthly![0], { month: "2025-12", revenue: 40, cost: 0, cogs: 0 });
  assertEquals(f.monthly![11], { month: "2026-11", revenue: 100, cost: 50, cogs: 20 });
});

Deno.test("year to date figures by hand", () => {
  const f = buildFigures(input({
    ledger: [
      entry("Sales", "revenue", "2026-02-01", 1000),
      entry("Sales", "revenue", "2025-12-31", 9999), // last fiscal year
      entry("Rent", "expense", "2026-03-01", 300),
      entry("Goods", "cogs", "2026-03-01", 200),
    ],
  }), today);
  assertEquals(f.period, { from: "2026-01-01", to: today });
  // Profit 1000 - 500 = 500. Net margin 500 / 1000 = 50%. Gross margin (1000 - 200) / 1000 = 80%.
  assertEquals(f.ytd, { revenue: 1000, cost: 500, profit: 500, netMargin: 50, grossMargin: 80 });
});

Deno.test("year to date follows the fiscal start month, across a year boundary", () => {
  const ledger = [
    entry("Sales", "revenue", "2026-03-31", 1000),
    entry("Sales", "revenue", "2026-04-01", 10),
    entry("Sales", "revenue", "2026-11-04", 5),
  ];
  const april = buildFigures(input({ fiscalStartMonth: 4, ledger }), today);
  assertEquals(april.period.from, "2026-04-01");
  assertEquals(april.ytd!.revenue, 15);
  // A December start has not arrived yet in November, so the year began last December.
  const dec = buildFigures(input({ fiscalStartMonth: 12, ledger }), today);
  assertEquals(dec.period.from, "2025-12-01");
  assertEquals(dec.ytd!.revenue, 1015);
  // A start month equal to the current month begins this year.
  assertEquals(buildFigures(input({ fiscalStartMonth: 11, ledger }), today).period.from, "2026-11-01");
});

Deno.test("top costs are the five largest expense accounts in the period, without cost of goods sold", () => {
  const f = buildFigures(input({
    ledger: [
      entry("Goods", "cogs", "2026-05-01", 99999),
      entry("Old", "expense", "2025-12-31", 99999),
      entry("Refunded", "expense", "2026-05-01", -50),
      ...["A", "B", "C", "D", "E", "F"].map((n, i) => entry(n, "expense", "2026-05-01", (i + 1) * 10)),
      entry("F", "expense", "2026-06-01", 5),
    ],
  }), today);
  assertEquals(f.topCosts, [
    { name: "F", amount: 65 },
    { name: "E", amount: 50 },
    { name: "D", amount: 40 },
    { name: "C", amount: 30 },
    { name: "B", amount: 20 },
  ]);
});

Deno.test("DSO and DPO use the last 90 days, counting today", () => {
  const f = buildFigures(input({
    receivables: [open(500)],
    payables: [open(100)],
    ledger: [
      entry("Sales", "revenue", daysAgo(0), 600),
      entry("Sales", "revenue", daysAgo(89), 300),
      entry("Sales", "revenue", daysAgo(90), 77777), // day 91
      entry("Rent", "expense", daysAgo(10), 150),
      entry("Goods", "cogs", daysAgo(20), 150),
    ],
  }), today);
  // 500 / 900 * 90 = 50. 100 / 300 * 90 = 30.
  assertEquals(f.ratios.dso, 50);
  assertEquals(f.ratios.dpo, 30);
});

Deno.test("health in buildFigures: cash cover uses the last 3 complete months, shares are percent", () => {
  const f = buildFigures(input({
    receivables: [open(100, "AED", 1, 0), open(100, "AED", 1, 10)],
    payables: [open(100, "AED", 1, 0)],
    cash: [{ name: "Main", balance: 600 }],
    balances: [{ type: "bank", balance: 600 }, { type: "accounts_payable", balance: 300 }],
    ledger: [
      entry("Sales", "revenue", "2026-10-01", 1000),
      entry("Rent", "expense", "2026-08-01", 100),
      entry("Rent", "expense", "2026-09-01", 200),
      entry("Rent", "expense", "2026-10-01", 300),
      entry("Rent", "expense", "2026-07-31", 88888), // before the 3 months, year to date only
      entry("Rent", "expense", "2026-11-01", 99999), // this month is not complete
    ],
  }), today);
  const by = Object.fromEntries(f.health!.factors.map((x) => [x.key, x]));
  // Average of 100, 200, 300 is 200. 600 / 200 = 3 months.
  assertEquals(by.cashCover.value, 3);
  assertEquals(by.cashCover.rating, "good");
  assertEquals(by.currentRatio.value, 2);
  assertEquals(by.arOverdueShare.value, 50);
  assertEquals(by.arOverdueShare.rating, "poor");
  assertEquals(by.apOverdueShare.value, 0);
  assertEquals(by.apOverdueShare.rating, "good");
  assertEquals(by.netMargin.rating, "poor");
});

Deno.test("no open documents means no overdue share, and it is named as missing", () => {
  const f = buildFigures(input(), today);
  assertEquals(f.health!.missing.includes("Receivables overdue share"), true);
  assertEquals(f.health!.missing.includes("Payables overdue share"), true);
});

const all = (over: Record<string, number | null> = {}) => ({
  currentRatio: 1.5,
  cashCover: 3,
  netMargin: 10,
  arOverdueShare: 20,
  apOverdueShare: 20,
  ...over,
});
const rating = (key: string, value: number) =>
  healthScore(all({ [key]: value })).factors.find((f) => f.key === key)!.rating;

Deno.test("health thresholds at each edge", () => {
  const cases: [string, number, string][] = [
    ["currentRatio", 1.5, "good"],
    ["currentRatio", 1, "watch"],
    ["currentRatio", 0.99, "poor"],
    ["cashCover", 3, "good"],
    ["cashCover", 1, "watch"],
    ["cashCover", 0.99, "poor"],
    ["netMargin", 10, "good"],
    ["netMargin", 0, "watch"],
    ["netMargin", -0.01, "poor"],
    ["arOverdueShare", 20, "good"],
    ["arOverdueShare", 20.01, "watch"],
    ["arOverdueShare", 40, "watch"],
    ["arOverdueShare", 40.01, "poor"],
    ["apOverdueShare", 20, "good"],
    ["apOverdueShare", 20.01, "watch"],
    ["apOverdueShare", 40, "watch"],
    ["apOverdueShare", 40.01, "poor"],
  ];
  for (const [key, value, want] of cases) assertEquals(rating(key, value), want, `${key} ${value}`);
});

Deno.test("all good is 100 and Healthy, all poor is 0 and At risk", () => {
  const good = healthScore(all());
  assertEquals([good.score, good.band], [100, "Healthy"]);
  assertEquals(good.missing, []);
  const poor = healthScore({ currentRatio: 0, cashCover: 0, netMargin: -1, arOverdueShare: 100, apOverdueShare: 100 });
  assertEquals([poor.score, poor.band], [0, "At risk"]);
});

Deno.test("band edges", () => {
  assertEquals(healthBand(70), "Healthy");
  assertEquals(healthBand(69), "Watch");
  assertEquals(healthBand(40), "Watch");
  assertEquals(healthBand(39), "At risk");
});

Deno.test("a null factor is left out, named, and the score is over points available", () => {
  // Good 20, good 20, watch 10, poor 0, of 80 available = 62.5.
  const h = healthScore({ currentRatio: 1.5, cashCover: null, netMargin: 10, arOverdueShare: 30, apOverdueShare: 50 });
  assertEquals(h.missing, ["Cash cover"]);
  assertEquals(h.factors.length, 4);
  assertEquals(h.score, 62.5);
  assertEquals(h.band, "Watch");
});

Deno.test("no factors at all gives no score", () => {
  const h = healthScore({ currentRatio: null, cashCover: null, netMargin: null, arOverdueShare: null, apOverdueShare: null });
  assertEquals(h.score, null);
  assertEquals(h.band, null);
  assertEquals(h.missing.length, 5);
});

Deno.test("an unfinished section has no total and is named in partial", () => {
  const noAr = buildFigures(input({ receivables: null }), today);
  assertEquals(noAr.ar, null);
  assertEquals(noAr.partial, ["ar", "ratios", "health"]);
  assertEquals(noAr.health, null);

  const noLedger = buildFigures(input({ ledger: null }), today);
  assertEquals([noLedger.monthly, noLedger.ytd, noLedger.topCosts], [null, null, null]);
  assertEquals(noLedger.partial, ["monthly", "ytd", "topCosts", "ratios", "health"]);

  const noCash = buildFigures(input({ cash: null, balances: [{ type: "accounts_payable", balance: 10 }] }), today);
  assertEquals(noCash.cash, null);
  assertEquals(noCash.ratios.cash, null);
  assertEquals(noCash.partial, ["cash", "ratios", "health"]);
});

Deno.test("what did finish is still calculated when another section did not", () => {
  const f = buildFigures(input({
    ledger: null,
    receivables: [open(100)],
    balances: [{ type: "bank", balance: 200 }, { type: "accounts_payable", balance: 100 }],
  }), today);
  assertEquals(f.ar!.total, 100);
  assertEquals(f.ratios.current, 2);
  assertEquals(f.ratios.dso, null);
});

Deno.test("an account with an unknown cash balance leaves cash without a total", () => {
  const f = buildFigures(input({
    cash: [{ name: "Main", balance: 100 }, { name: "Odd", balance: null }],
    balances: [{ type: "accounts_payable", balance: 10 }],
  }), today);
  assertEquals(f.cash!.total, null);
  assertEquals(f.ratios.cash, null);
  assertEquals(f.partial.includes("cash"), true);
});

Deno.test("a complete input has an empty partial and carries the currency", () => {
  const f = buildFigures(input(), today);
  assertEquals(f.partial, []);
  assertEquals(f.currency, "AED");
});
