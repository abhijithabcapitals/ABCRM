// Actions for the zoho-finance Edge Function. Read-only. Kept free of Deno and Supabase imports so tests run offline.

export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

import { ZohoAccessError, ZohoHttpError } from "./zohoClient.ts";

// deno-lint-ignore no-explicit-any
type Json = any;

export type ZohoLike = {
  orgId: string;
  get(path: string, query?: Record<string, string>): Promise<Json>;
};

export type Deps = {
  isAdmin(): Promise<boolean>;
  zoho(): Promise<ZohoLike>;
  // Service-role Supabase client. Unused by these two actions.
  db: Json;
  now(): Date;
};

// The only error text the browser sees for a Zoho or unexpected failure. Raw detail stays in the server log.
export function browserMessage(e: unknown): string {
  if (e instanceof ZohoAccessError) return "Zoho access has stopped. An admin must reconnect.";
  if (e instanceof ZohoHttpError) {
    return e.status === 429 ? "Zoho is busy, try again shortly." : "Zoho refused the request.";
  }
  return "Something went wrong talking to Zoho.";
}

async function requireAdmin(deps: Deps) {
  if (!(await deps.isAdmin())) throw new UserError("Only a CRM admin can do this.");
}

export async function handle(action: string, body: Json, deps: Deps): Promise<object> {
  try {
    return await run(action, body ?? {}, deps);
  } catch (e) {
    if ((e as Error)?.name === "MissingSecretError") {
      return { connected: false, message: "Zoho finance credentials are missing. Add them in Settings > Integrations." };
    }
    if (e instanceof ZohoAccessError) {
      return { connected: false, message: "Zoho access has stopped. An admin must reconnect the finance login." };
    }
    throw e;
  }
}

async function run(action: string, _body: Json, deps: Deps): Promise<object> {
  if (action === "connection_test") {
    await requireAdmin(deps);
    const zoho = await deps.zoho();
    const res = await zoho.get("/organizations");
    const match = (res?.organizations ?? []).find((o: Json) => String(o?.organization_id) === zoho.orgId);
    if (!match) {
      return {
        connected: false,
        message: "Zoho answered, but the organisation in ZOHO_BOOKS_ORG_ID is not one this login can see. Check that setting.",
      };
    }
    return { connected: true, organisation: String(match.name ?? "") };
  }

  if (action === "probe") {
    await requireAdmin(deps);
    return await probe(await deps.zoho(), deps.now());
  }

  throw new UserError("Unknown action.");
}

// ---- probe: structure only. Nothing below may copy an amount, a name or an ID into the result. ----

const TX_PATHS = ["/chartofaccounts/transactions", "/chartofaccounts/accounttransactions"] as const;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const TOKEN = /^[A-Za-z0-9_]{1,40}$/;

type Call = { status: number; data: Json };

// A refused or failed call becomes its HTTP status. A lost login is not swallowed.
async function attempt(zoho: ZohoLike, path: string, query: Record<string, string> = {}): Promise<Call> {
  try {
    return { status: 200, data: await zoho.get(path, query) };
  } catch (e) {
    if (e instanceof ZohoHttpError) return { status: e.status, data: undefined };
    if ((e as Error)?.name === "NotAllowedError") return { status: 403, data: undefined };
    throw e;
  }
}

function sign(values: number[]): "pos" | "neg" | "mixed" | "zero" {
  const nz = values.filter((v) => v !== 0);
  if (nz.length === 0) return "zero";
  if (nz.every((v) => v > 0)) return "pos";
  if (nz.every((v) => v < 0)) return "neg";
  return "mixed";
}

const rowsOf = (data: Json): Json[] => {
  const r = data?.transactions ?? data?.accounttransactions ?? [];
  return Array.isArray(r) ? r : [];
};

// Counts only. The numbers come from page_context.total or the list length, never from a row value.
function countOf(call: Call, key: string): number {
  const list = call.data?.[key];
  const total = call.data?.page_context?.total;
  if (typeof total === "number" && Number.isFinite(total)) return total;
  return Array.isArray(list) ? list.length : 0;
}

async function probe(zoho: ZohoLike, now: Date): Promise<object> {
  const start12 = new Date(now);
  start12.setUTCFullYear(start12.getUTCFullYear() - 1);
  const startMonth = new Date(now);
  startMonth.setUTCMonth(startMonth.getUTCMonth() - 1);
  const wide = { date_start: iso(start12), date_end: iso(now) };
  const narrow = { date_start: iso(startMonth), date_end: iso(now) };

  // Organisation: fiscal start and base currency are settings, not amounts.
  const orgRes = await zoho.get("/organizations");
  const org = (orgRes?.organizations ?? []).find((o: Json) => String(o?.organization_id) === zoho.orgId) ?? {};
  const fy = org.fiscal_year_start_month;
  const fiscalStartMonth = typeof fy === "number" ? fy : typeof fy === "string" && /^[A-Za-z]{3,9}$/.test(fy) ? fy.toLowerCase() : null;
  const baseCurrency = typeof org.currency_code === "string" && /^[A-Z]{3}$/.test(org.currency_code) ? org.currency_code : null;

  // Account types: type name, count, and the sign of the balances only.
  const coa = await attempt(zoho, "/chartofaccounts");
  const accounts: Json[] = Array.isArray(coa.data?.chartofaccounts) ? coa.data.chartofaccounts : [];
  const byType = new Map<string, number[]>();
  for (const a of accounts) {
    const t = typeof a?.account_type === "string" && TOKEN.test(a.account_type) ? a.account_type : "other";
    const list = byType.get(t) ?? [];
    list.push(Number(a?.current_balance) || 0);
    byType.set(t, list);
  }
  const accountTypes = [...byType].map(([type, vals]) => ({ type, count: vals.length, balanceSign: sign(vals) }));

  // Two sample income or expense accounts. Their IDs stay inside this function.
  const samples = accounts.filter((a) => a?.account_type === "income" || a?.account_type === "expense").slice(0, 2);
  const ieCount = accounts.filter((a) => a?.account_type === "income" || a?.account_type === "expense").length;

  const transactionsPath: Record<string, number> = {};
  let fields = new Set<string>();
  let dateParamsWorked = false;
  const sample0 = samples[0];
  for (const p of TX_PATHS) {
    if (!sample0) { transactionsPath[p] = 0; continue; }
    const wideCall = await attempt(zoho, p, { account_id: String(sample0.account_id), ...wide, per_page: "200" });
    transactionsPath[p] = wideCall.status;
    const rows = rowsOf(wideCall.data);
    if (rows[0] && typeof rows[0] === "object" && fields.size === 0) {
      fields = new Set(Object.keys(rows[0]).filter((k) => TOKEN.test(k)));
    }
    if (wideCall.status === 200 && !dateParamsWorked) {
      const narrowCall = await attempt(zoho, p, { account_id: String(sample0.account_id), ...narrow, per_page: "200" });
      const nr = rowsOf(narrowCall.data);
      dateParamsWorked = narrowCall.status === 200 &&
        nr.length <= rows.length &&
        nr.every((r) => typeof r?.date === "string" && r.date >= narrow.date_start && r.date <= narrow.date_end);
    }
  }

  // Does an income or expense balance move when the date range moves? Compared in memory, only a boolean leaves.
  let balanceChanges: boolean | "unknown" = "unknown";
  const early = await attempt(zoho, "/chartofaccounts", { date_start: wide.date_start, date_end: narrow.date_start });
  const late = await attempt(zoho, "/chartofaccounts", narrow);
  if (early.status === 200 && late.status === 200) {
    const pick = (d: Json) =>
      (Array.isArray(d?.chartofaccounts) ? d.chartofaccounts : [])
        .filter((a: Json) => a?.account_type === "income" || a?.account_type === "expense")
        .map((a: Json) => [String(a.account_id), Number(a.current_balance) || 0]);
    balanceChanges = JSON.stringify(pick(early.data)) !== JSON.stringify(pick(late.data));
  }

  // Open invoice and bill filters: one count each, so overlap between filters can be seen.
  const inv = async (status: string) => countOf(await attempt(zoho, "/invoices", { status, per_page: "200" }), "invoices");
  const bill = async (status: string) => countOf(await attempt(zoho, "/bills", { status, per_page: "200" }), "bills");
  const openFilters = {
    invoices: {
      status_unpaid: await inv("unpaid"),
      status_overdue: await inv("overdue"),
      status_partially_paid: await inv("partially_paid"),
    },
    bills: {
      open: await bill("open"),
      overdue: await bill("overdue"),
      partially_paid: await bill("partially_paid"),
    },
  };

  // Other-currency documents: counts and one boolean.
  const invAll = await attempt(zoho, "/invoices", { per_page: "200" });
  const billAll = await attempt(zoho, "/bills", { per_page: "200" });
  const invList: Json[] = Array.isArray(invAll.data?.invoices) ? invAll.data.invoices : [];
  const billList: Json[] = Array.isArray(billAll.data?.bills) ? billAll.data.bills : [];
  const foreign = (l: Json[]) => l.filter((x) => typeof x?.currency_code === "string" && baseCurrency && x.currency_code !== baseCurrency).length;
  const otherCurrency = {
    invoices: foreign(invList),
    bills: foreign(billList),
    listHasExchangeRate: [...invList, ...billList].some((x) => x?.exchange_rate !== undefined && x?.exchange_rate !== null),
  };

  // Calls for 12 months: pages seen on up to two sample accounts, scaled to all income and expense accounts,
  // plus the fixed list calls (invoices, bills, bank accounts).
  let callsNeededFor12Months: number | "unknown" = "unknown";
  const pageCounts: number[] = [];
  for (const a of samples) {
    let pages = 0;
    for (let page = 1; page <= 6; page++) {
      const r = await attempt(zoho, TX_PATHS[0], { account_id: String(a.account_id), ...wide, per_page: "200", page: String(page) });
      if (r.status !== 200) break;
      pages++;
      if (r.data?.page_context?.has_more_page !== true) break;
    }
    if (pages > 0) pageCounts.push(pages);
  }
  if (pageCounts.length > 0) {
    const avg = pageCounts.reduce((s, n) => s + n, 0) / pageCounts.length;
    callsNeededFor12Months = Math.ceil(avg * ieCount) + 3;
  }

  return {
    transactionsPath,
    transactionFields: [...fields].sort(),
    dateParamsWorked,
    fiscalStartMonth,
    baseCurrency,
    accountTypes,
    incomeOrExpenseBalanceChangesWithDate: balanceChanges,
    openFilters,
    otherCurrency,
    callsNeededFor12Months,
  };
}
