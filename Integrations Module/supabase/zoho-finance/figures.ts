// Financial figures for the Dashboard cards. Pure functions over plain inputs, with no knowledge of Zoho's
// responses (zohoSources.ts does that mapping). Rules: design document section 5.
// Dates are yyyy-mm-dd strings. Margins and shares are percent numbers: 10 means 10%.
// A zero or negative divisor, or an unknown input, gives null, which the card shows as "n/a". Never zero.
// Sums are rounded to cents before any ratio, so floating point dust cannot pass for a real divisor.

export type OpenDoc = {
  name: string;
  dueDate: string | null;
  // In the document's own currency. Null means it could not be read.
  balance: number | null;
  currency: string | null;
  rate: number | null;
};
// An open document in the base currency.
export type BaseDoc = { name: string; dueDate: string | null; amount: number };
// Balance in its natural sign: an asset, liability or equity normally has a positive balance. Null means unknown.
export type Balance = { type: string; balance: number | null };
export type CashAccount = { name: string; balance: number | null };
// Amount is in the base currency, positive for income earned or cost incurred, negative for a reversal.
// otherIncome counts in net profit and net margin only: never in revenue, gross margin or DSO.
export type LedgerEntry = { account: string; kind: "revenue" | "otherIncome" | "expense" | "cogs"; date: string; amount: number };

// A null list means that section was not finished in this refresh.
export type FiguresInput = {
  currency: string;
  fiscalStartMonth: number; // 1 is January
  receivables: OpenDoc[] | null;
  payables: OpenDoc[] | null;
  balances: Balance[] | null;
  cash: CashAccount[] | null;
  ledger: LedgerEntry[] | null;
};

export type Aging = { current: number; d1_30: number; d31_60: number; d61_90: number; d90p: number; total: number };
export type DocSection = {
  total: number;
  aging: Aging;
  top: { name: string; amount: number }[];
  ledger: number | null;
  // Aging total minus ledger, only when more than 1 apart.
  difference: number | null;
  excluded: number;
};
export type HealthFactors = {
  currentRatio: number | null;
  cashCover: number | null;
  netMargin: number | null;
  arOverdueShare: number | null;
  apOverdueShare: number | null;
};
export type Rating = "good" | "watch" | "poor";
export type Band = "Healthy" | "Watch" | "At risk";
export type Health = {
  score: number | null;
  band: Band | null;
  factors: { key: string; label: string; value: number; rating: Rating }[];
  missing: string[];
};
export type SnapshotData = {
  currency: string;
  period: { from: string; to: string };
  ar: DocSection | null;
  ap: DocSection | null;
  cash: { total: number | null; accounts: CashAccount[] } | null;
  monthly: { month: string; revenue: number; otherIncome: number; cost: number; cogs: number }[] | null;
  ytd: { revenue: number; otherIncome: number; cost: number; profit: number; netMargin: number | null; grossMargin: number | null } | null;
  topCosts: { name: string; amount: number }[] | null;
  ratios: {
    current: number | null;
    quick: number | null;
    cash: number | null;
    debtToEquity: number | null;
    dso: number | null;
    dpo: number | null;
  };
  health: Health;
  partial: string[];
};

const DAY = 86_400_000;
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100 + 0; // + 0 turns -0 into 0.
const fine = (n: number) => Math.round(n * 10000) / 10000;
const dayNumber = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY;
// A negative divisor is not a usable ratio: negative equity must not read as good debt to equity.
const ratioOf = (top: number | null, bottom: number | null) => (top === null || bottom === null || bottom <= 0 ? null : top / bottom);
const rounded = (n: number | null) => (n === null ? null : fine(n));

function daysPast(dueDate: string | null, today: string): number {
  if (!dueDate) return 0; // No due date cannot be overdue.
  const due = dayNumber(dueDate);
  // zohoSources.ts refuses these first. Calling it current would understate what is overdue.
  if (Number.isNaN(due)) throw new Error("Open document has an unreadable due date.");
  return dayNumber(today) - due;
}

export function agingBuckets(docs: BaseDoc[], today: string): Aging {
  const a: Aging = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90p: 0, total: 0 };
  for (const doc of docs) {
    const days = daysPast(doc.dueDate, today);
    const key = days <= 0 ? "current" : days <= 30 ? "d1_30" : days <= 60 ? "d31_60" : days <= 90 ? "d61_90" : "d90p";
    a[key] += doc.amount;
    a.total += doc.amount;
  }
  return {
    current: money(a.current),
    d1_30: money(a.d1_30),
    d31_60: money(a.d31_60),
    d61_90: money(a.d61_90),
    d90p: money(a.d90p),
    total: money(a.total),
  };
}

function largest(amounts: Map<string, number>, n: number) {
  return [...amounts]
    .map(([name, amount]) => ({ name, amount: money(amount) }))
    .filter((x) => x.amount > 0)
    .sort((x, y) => y.amount - x.amount)
    .slice(0, n);
}

export function topOverdue<T extends BaseDoc>(docs: T[], today: string, nameField: keyof T, n = 5): { name: string; amount: number }[] {
  const byName = new Map<string, number>();
  for (const doc of docs) {
    if (daysPast(doc.dueDate, today) <= 0) continue;
    const name = String(doc[nameField] ?? "");
    byName.set(name, (byName.get(name) ?? 0) + doc.amount);
  }
  return largest(byName, n);
}

// Converts to the base currency. A document that cannot be converted is left out and counted, never guessed.
function toBase(docs: OpenDoc[], currency: string): { docs: BaseDoc[]; excluded: number } {
  const out: BaseDoc[] = [];
  let excluded = 0;
  for (const d of docs) {
    const rate = d.currency === currency ? 1 : d.rate;
    if (d.balance === null || rate === null || !(rate > 0)) {
      excluded++;
      continue;
    }
    // Each document is rounded, as Zoho rounds it, so the sum can match Zoho's ledger.
    out.push({ name: d.name, dueDate: d.dueDate, amount: money(d.balance * rate) });
  }
  return { docs: out, excluded };
}

// Sum of the balances of these types. Any unknown balance makes the sum unknown.
function sumTypes(balances: Balance[] | null, types: string[]): number | null {
  if (balances === null) return null;
  let sum = 0;
  for (const b of balances) {
    if (!types.includes(b.type)) continue;
    if (b.balance === null) return null;
    sum += b.balance;
  }
  return money(sum);
}

function docSection(docs: OpenDoc[], currency: string, today: string, balances: Balance[] | null, ledgerType: string): DocSection {
  const base = toBase(docs, currency);
  const aging = agingBuckets(base.docs, today);
  // No ledger account at all is unknown, not a ledger of zero.
  const hasAccount = balances?.some((b) => b.type === ledgerType) ?? false;
  const raw = hasAccount ? sumTypes(balances, [ledgerType]) : null;
  const ledger = raw === null ? null : money(raw);
  // Both are rounded to cents first, so a gap of exactly 1 is exactly 1.
  const gap = ledger === null ? 0 : money(aging.total - ledger);
  return {
    total: aging.total,
    aging,
    top: topOverdue(base.docs, today, "name"),
    ledger,
    difference: Math.abs(gap) > 1 ? gap : null,
    excluded: base.excluded,
  };
}

const overdueShare = (s: DocSection | null) => (s === null ? null : percentOf(money(s.total - s.aging.current), s.total));

function fiscalStart(today: string, startMonth: number): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const y = month >= startMonth ? year : year - 1;
  return `${y}-${String(startMonth).padStart(2, "0")}-01`;
}

// "yyyy-mm" for the month this many months before the month of today.
function monthBack(today: string, back: number): string {
  const d = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - back, 1));
  return d.toISOString().slice(0, 7);
}

// First day of the 12 months the monthly figures cover. It always contains the fiscal year to date and the last 90 days.
export function ledgerStart(today: string): string {
  return `${monthBack(today, 11)}-01`;
}

const COST_KINDS = ["expense", "cogs"];

function ledgerFigures(ledger: LedgerEntry[], today: string, from: string) {
  const months = new Map<string, { revenue: number; otherIncome: number; cost: number; cogs: number }>();
  for (let i = 11; i >= 0; i--) months.set(monthBack(today, i), { revenue: 0, otherIncome: 0, cost: 0, cogs: 0 });
  let revenueSum = 0, otherIncomeSum = 0, costSum = 0, cogsSum = 0, revenue90 = 0, cost90 = 0, cost3Months = 0;
  const expenses = new Map<string, number>();
  const start90 = dayNumber(today) - 89; // 90 days, counting today.
  const thisMonth = monthBack(today, 0);
  const start3Months = monthBack(today, 3);

  for (const e of ledger) {
    if (e.date > today) continue;
    const isCost = COST_KINDS.includes(e.kind);
    const m = months.get(e.date.slice(0, 7));
    if (m) {
      if (e.kind === "revenue") m.revenue += e.amount;
      if (e.kind === "otherIncome") m.otherIncome += e.amount;
      if (isCost) m.cost += e.amount;
      if (e.kind === "cogs") m.cogs += e.amount;
    }
    if (e.date >= from) {
      if (e.kind === "revenue") revenueSum += e.amount;
      if (e.kind === "otherIncome") otherIncomeSum += e.amount;
      if (isCost) costSum += e.amount;
      if (e.kind === "cogs") cogsSum += e.amount;
      if (e.kind === "expense") expenses.set(e.account, (expenses.get(e.account) ?? 0) + e.amount);
    }
    if (dayNumber(e.date) >= start90) {
      if (e.kind === "revenue") revenue90 += e.amount;
      if (isCost) cost90 += e.amount;
    }
    const month = e.date.slice(0, 7);
    if (isCost && month >= start3Months && month < thisMonth) cost3Months += e.amount;
  }

  const revenue = money(revenueSum);
  const otherIncome = money(otherIncomeSum);
  const cost = money(costSum);
  const profit = money(revenue + otherIncome - cost);
  const netMargin = percentOf(profit, revenue);
  return {
    monthly: [...months].map(([month, v]) => ({
      month,
      revenue: money(v.revenue),
      otherIncome: money(v.otherIncome),
      cost: money(v.cost),
      cogs: money(v.cogs),
    })),
    ytd: {
      revenue,
      otherIncome,
      cost,
      profit,
      netMargin: rounded(netMargin),
      grossMargin: rounded(percentOf(money(revenue - cogsSum), revenue)),
    },
    rawNetMargin: netMargin,
    topCosts: largest(expenses, 5),
    revenue90: money(revenue90),
    cost90: money(cost90),
    // Average monthly cost over the last 3 complete months. The current month is not over, so it is left out.
    avgMonthlyCost: money(cost3Months / 3),
  };
}

function percentOf(top: number, bottom: number): number | null {
  const r = ratioOf(top, bottom);
  return r === null ? null : r * 100;
}

export function buildFigures(input: FiguresInput, today: string): SnapshotData {
  const { currency, balances, cash } = input;
  const from = fiscalStart(today, input.fiscalStartMonth);

  const ar = input.receivables && docSection(input.receivables, currency, today, balances, "accounts_receivable");
  const ap = input.payables && docSection(input.payables, currency, today, balances, "accounts_payable");
  const led = input.ledger && ledgerFigures(input.ledger, today, from);

  const cashKnown = cash !== null && cash.every((a) => a.balance !== null);
  const cashTotal = cashKnown ? money(cash.reduce((s, a) => s + (a.balance as number), 0)) : null;

  const currentAssets = sumTypes(balances, ["accounts_receivable", "cash", "bank", "stock", "other_current_asset"]);
  const stock = sumTypes(balances, ["stock"]);
  const currentLiabilities = sumTypes(balances, ["accounts_payable", "credit_card", "other_current_liability"]);
  const longTerm = sumTypes(balances, ["long_term_liability"]);
  const equity = sumTypes(balances, ["equity"]);
  const quickAssets = currentAssets === null || stock === null ? null : money(currentAssets - stock);
  const allLiabilities = currentLiabilities === null || longTerm === null ? null : money(currentLiabilities + longTerm);

  const current = ratioOf(currentAssets, currentLiabilities);
  const dso = ar && led ? ratioOf(ar.total, led.revenue90) : null;
  const dpo = ap && led ? ratioOf(ap.total, led.cost90) : null;

  const partial: string[] = [];
  if (!ar) partial.push("ar");
  if (!ap) partial.push("ap");
  if (!cashKnown) partial.push("cash");
  if (!led) partial.push("monthly", "ytd", "topCosts");
  // Ratios and health draw on every source. Each keeps what could be worked out, and is marked incomplete.
  const unfinished = !ar || !ap || !cashKnown || !led || balances === null;
  if (unfinished) partial.push("ratios", "health");

  return {
    currency,
    period: { from, to: today },
    ar,
    ap,
    cash: cash === null ? null : { total: cashTotal, accounts: cash },
    monthly: led ? led.monthly : null,
    ytd: led ? led.ytd : null,
    topCosts: led ? led.topCosts : null,
    ratios: {
      current: rounded(current),
      quick: rounded(ratioOf(quickAssets, currentLiabilities)),
      cash: rounded(ratioOf(cashTotal, currentLiabilities)),
      debtToEquity: rounded(ratioOf(allLiabilities, equity)),
      dso: rounded(dso === null ? null : dso * 90),
      dpo: rounded(dpo === null ? null : dpo * 90),
    },
    // A factor whose source is unfinished is left out and named, as a factor showing n/a is. "health" in partial marks it.
    health: healthScore({
      currentRatio: current,
      cashCover: led ? ratioOf(cashTotal, led.avgMonthlyCost) : null,
      netMargin: led ? led.rawNetMargin : null,
      arOverdueShare: overdueShare(ar),
      apOverdueShare: overdueShare(ap),
    }),
    partial,
  };
}

// ---- Company Health. Thresholds: design document section 5. ----

const atLeast = (good: number, watch: number) => (v: number): Rating => v >= good ? "good" : v >= watch ? "watch" : "poor";
const atMost = (good: number, watch: number) => (v: number): Rating => v <= good ? "good" : v <= watch ? "watch" : "poor";

const FACTORS: { key: keyof HealthFactors; label: string; rate: (v: number) => Rating }[] = [
  { key: "currentRatio", label: "Current ratio", rate: atLeast(1.5, 1) },
  { key: "cashCover", label: "Cash cover", rate: atLeast(3, 1) },
  { key: "netMargin", label: "Net margin", rate: atLeast(10, 0) },
  { key: "arOverdueShare", label: "Receivables overdue share", rate: atMost(20, 40) },
  { key: "apOverdueShare", label: "Payables overdue share", rate: atMost(20, 40) },
];
const POINTS: Record<Rating, number> = { good: 20, watch: 10, poor: 0 };

export function healthBand(score: number): Band {
  return score >= 70 ? "Healthy" : score >= 40 ? "Watch" : "At risk";
}

export function healthScore(factors: HealthFactors): Health {
  const scored: Health["factors"] = [];
  const missing: string[] = [];
  let points = 0;
  for (const f of FACTORS) {
    const value = factors[f.key];
    if (value === null) {
      missing.push(f.label);
      continue;
    }
    // Rated on the stored value, so 3.3 / 2.2, which is 1.4999999999999998 in floating point, is the true 1.5 it shows.
    const shown = fine(value);
    const rating = f.rate(shown);
    points += POINTS[rating];
    scored.push({ key: f.key, label: f.label, value: shown, rating });
  }
  if (scored.length === 0) return { score: null, band: null, factors: scored, missing };
  const score = Math.round((points / (scored.length * 20)) * 1000) / 10;
  return { score, band: healthBand(score), factors: scored, missing };
}
