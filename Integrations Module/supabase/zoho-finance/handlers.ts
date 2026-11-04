// Actions for the zoho-finance Edge Function. Read-only. Kept free of Deno and Supabase imports so tests run offline.

import { UserError } from "./errors.ts";
import { refresh } from "./refresh.ts";
import { ZohoAccessError, ZohoHttpError } from "./zohoClient.ts";

export { browserMessage, UserError } from "./errors.ts";

// deno-lint-ignore no-explicit-any
type Json = any;

export type ZohoLike = {
  orgId: string;
  get(path: string, query?: Record<string, string>): Promise<Json>;
};

export type Deps = {
  isAdmin(): Promise<boolean>;
  zoho(): Promise<ZohoLike>;
  // Service-role Supabase client. Used by refresh.
  db: Json;
  now(): Date;
};

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
      // The message was scrubbed of secrets when the error was made. It is for the server log only.
      console.error("zoho-finance: access refused:", e.name, e.message);
      return { connected: false, message: "Zoho access has stopped. An admin must reconnect the finance login." };
    }
    throw e;
  }
}

async function run(action: string, body: Json, deps: Deps): Promise<object> {
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

  if (action === "refresh") {
    return await refresh({ force: body.force === true }, deps);
  }

  throw new UserError("Unknown action.");
}

// ---- probe: structure only. Nothing below may copy an amount, a name or an ID into the result. ----

const TX_PATHS = ["/chartofaccounts/transactions", "/chartofaccounts/accounttransactions"] as const;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const TOKEN = /^[a-z][a-z0-9_]{0,39}$/i;
// Income, expense and cost account types in Zoho Books. Cost of goods sold counts as a cost.
const IE_TYPES = new Set(["income", "other_income", "expense", "other_expense", "cost_of_goods_sold"]);
const MAX_PAGES = 6;

type Call = { status: number; data: Json };
type Unknown = "unknown";
type Counted = { status: number; count: number | null; capped: boolean };

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

// A balance that is absent or not a number is unknown, never zero.
function balanceOf(a: Json): number | null {
  const v = a?.current_balance;
  if (v === undefined || v === null || v === "" || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sign(values: (number | null)[]): "pos" | "neg" | "mixed" | "zero" | Unknown {
  if (values.length === 0 || values.some((v) => v === null)) return "unknown";
  const nz = (values as number[]).filter((v) => v !== 0);
  if (nz.length === 0) return "zero";
  if (nz.every((v) => v > 0)) return "pos";
  if (nz.every((v) => v < 0)) return "neg";
  return "mixed";
}

const rowsOf = (data: Json): Json[] => {
  const r = data?.transactions ?? data?.accounttransactions ?? [];
  return Array.isArray(r) ? r : [];
};
const rowDate = (r: Json): string | null => {
  const d = r?.date ?? r?.transaction_date;
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
};

// Counts only. A failed call has no count. capped means the real figure may be higher than count.
function counted(call: Call, key: string): Counted {
  if (call.status !== 200) return { status: call.status, count: null, capped: false };
  const list = call.data?.[key];
  const total = call.data?.page_context?.total;
  const more = call.data?.page_context?.has_more_page === true;
  if (typeof total === "number" && Number.isFinite(total)) return { status: 200, count: total, capped: false };
  return { status: 200, count: Array.isArray(list) ? list.length : 0, capped: more };
}

const STYLES: { name: string; start: string; end: string }[] = [
  { name: "date_start", start: "date_start", end: "date_end" },
  { name: "date.start", start: "date.start", end: "date.end" },
];

async function probe(zoho: ZohoLike, now: Date): Promise<object> {
  const start12 = new Date(now);
  start12.setUTCFullYear(start12.getUTCFullYear() - 1);
  const startMonth = new Date(now);
  startMonth.setUTCMonth(startMonth.getUTCMonth() - 1);
  const win = (from: Date, style: (typeof STYLES)[number]) => ({ [style.start]: iso(from), [style.end]: iso(now) });

  // Organisation: fiscal start and base currency are settings, not amounts.
  const orgRes = await zoho.get("/organizations");
  const org = (orgRes?.organizations ?? []).find((o: Json) => String(o?.organization_id) === zoho.orgId) ?? {};
  const fy = org.fiscal_year_start_month;
  const fiscalStartMonth = typeof fy === "number" && Number.isInteger(fy) && fy >= 0 && fy <= 12
    ? fy
    : typeof fy === "string" && /^[A-Za-z]{3,9}$/.test(fy) ? fy.toLowerCase() : null;
  const baseCurrency = typeof org.currency_code === "string" && /^[A-Z]{3}$/.test(org.currency_code) ? org.currency_code : null;

  // Account types: type name, count, and the sign of the balances only.
  const coa = await attempt(zoho, "/chartofaccounts", { showbalance: "true" });
  const accounts: Json[] = Array.isArray(coa.data?.chartofaccounts) ? coa.data.chartofaccounts : [];
  const byType = new Map<string, (number | null)[]>();
  for (const a of accounts) {
    const t = typeof a?.account_type === "string" && TOKEN.test(a.account_type) && !/^cf_/i.test(a.account_type) ? a.account_type : "other";
    const list = byType.get(t) ?? [];
    list.push(balanceOf(a));
    byType.set(t, list);
  }
  const accountTypes = [...byType].map(([type, vals]) => ({ type, count: vals.length, balanceSign: sign(vals) }));

  // Sample income or expense accounts. Their IDs stay inside this function.
  const ie = accounts.filter((a) => IE_TYPES.has(a?.account_type));
  const samples = ie.slice(0, 2);

  // Transaction paths, fields and date parameters. A date test needs a narrow-window row and a wide-window
  // row that the narrow window excludes; otherwise the answer is unknown (or false if a window leaked rows).
  const transactionsPath: Record<string, number> = {};
  const fields = new Set<string>();
  let worked = false;
  let violated = false;
  let styleWorked: string = "unknown";
  let goodPath: (typeof TX_PATHS)[number] | undefined;
  for (const p of TX_PATHS) {
    transactionsPath[p] = 0; // 0 means not tried
    for (const a of samples) {
      const id = String(a.account_id);
      for (const st of STYLES) {
        const wideCall = await attempt(zoho, p, { account_id: id, ...win(start12, st), per_page: "200" });
        if (st === STYLES[0] && transactionsPath[p] !== 200) transactionsPath[p] = wideCall.status;
        if (wideCall.status !== 200) continue;
        goodPath ??= p;
        const wideRows = rowsOf(wideCall.data);
        for (const r of wideRows.slice(0, 1)) {
          if (r && typeof r === "object") {
            for (const k of Object.keys(r)) if (TOKEN.test(k) && !/^cf_/i.test(k)) fields.add(k);
          }
        }
        const narrowCall = await attempt(zoho, p, { account_id: id, ...win(startMonth, st), per_page: "200" });
        if (narrowCall.status !== 200) continue;
        const nDates = rowsOf(narrowCall.data).map(rowDate);
        const wDates = wideRows.map(rowDate);
        const inside = (d: string | null) => d !== null && d >= iso(startMonth) && d <= iso(now);
        if (nDates.some((d) => d !== null && !inside(d))) { violated = true; continue; }
        if (nDates.some(inside) && wDates.some((d) => d !== null && !inside(d))) {
          worked = true;
          if (styleWorked === "unknown") styleWorked = st.name;
        }
      }
    }
  }
  const dateParamsWorked: boolean | Unknown = worked ? true : violated ? false : "unknown";

  // Does an income or expense balance move when the date range moves? Only a boolean leaves.
  let balanceChanges: boolean | Unknown = "unknown";
  const early = await attempt(zoho, "/chartofaccounts", { showbalance: "true", date_start: iso(start12), date_end: iso(startMonth) });
  const late = await attempt(zoho, "/chartofaccounts", { showbalance: "true", date_start: iso(startMonth), date_end: iso(now) });
  if (early.status === 200 && late.status === 200) {
    const pick = (d: Json) =>
      (Array.isArray(d?.chartofaccounts) ? d.chartofaccounts : [])
        .filter((a: Json) => IE_TYPES.has(a?.account_type))
        .map((a: Json) => [String(a.account_id), balanceOf(a)]);
    const e = pick(early.data);
    const l = pick(late.data);
    if (e.length > 0 && e.every((x: Json) => x[1] !== null) && l.every((x: Json) => x[1] !== null)) {
      balanceChanges = JSON.stringify(e) !== JSON.stringify(l);
    }
  }

  // Open invoice and bill filters: status and count per filter, so overlap and failure can be seen.
  const inv = async (status: string) => counted(await attempt(zoho, "/invoices", { status, per_page: "200" }), "invoices");
  const bill = async (status: string) => counted(await attempt(zoho, "/bills", { status, per_page: "200" }), "bills");
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

  // Other-currency documents. Counts come from the first page only, so capped is true when more pages exist.
  const invAll = await attempt(zoho, "/invoices", { per_page: "200" });
  const billAll = await attempt(zoho, "/bills", { per_page: "200" });
  const foreignCount = (c: Call, key: string): Counted => {
    if (c.status !== 200 || !baseCurrency) return { status: c.status, count: null, capped: false };
    const list: Json[] = Array.isArray(c.data?.[key]) ? c.data[key] : [];
    return {
      status: 200,
      count: list.filter((x) => typeof x?.currency_code === "string" && x.currency_code !== baseCurrency).length,
      capped: c.data?.page_context?.has_more_page === true,
    };
  };
  const allRows: Json[] = [
    ...(Array.isArray(invAll.data?.invoices) ? invAll.data.invoices : []),
    ...(Array.isArray(billAll.data?.bills) ? billAll.data.bills : []),
  ];
  const otherCurrency = {
    invoices: foreignCount(invAll, "invoices"),
    bills: foreignCount(billAll, "bills"),
    listHasExchangeRate: allRows.length === 0
      ? "unknown"
      : allRows.some((x) => x?.exchange_rate !== undefined && x?.exchange_rate !== null),
  };

  // Calls for 12 months: pages seen on up to two sample accounts, scaled to every income, expense and cost
  // account, plus the fixed calls (chart of accounts, invoices, bills, bank accounts).
  let callsNeededFor12Months: { calls: number; capped: boolean } | Unknown = "unknown";
  if (goodPath && samples.length > 0) {
    const style = STYLES.find((s) => s.name === styleWorked) ?? STYLES[0];
    const pageCounts: number[] = [];
    let capped = false;
    for (const a of samples) {
      let pages = 0;
      for (let page = 1; page <= MAX_PAGES; page++) {
        const r = await attempt(zoho, goodPath, { account_id: String(a.account_id), ...win(start12, style), per_page: "200", page: String(page) });
        if (r.status !== 200) break;
        pages++;
        if (r.data?.page_context?.has_more_page !== true) break;
        if (page === MAX_PAGES) capped = true;
      }
      if (pages > 0) pageCounts.push(pages);
    }
    if (pageCounts.length > 0) {
      const avg = pageCounts.reduce((s, n) => s + n, 0) / pageCounts.length;
      callsNeededFor12Months = { calls: Math.ceil(avg * ie.length) + 4, capped };
    }
  }

  return {
    transactionsPath,
    transactionFields: [...fields].sort(),
    dateParamsWorked,
    dateParamStyle: styleWorked,
    fiscalStartMonth,
    baseCurrency,
    accountTypes,
    incomeOrExpenseBalanceChangesWithDate: balanceChanges,
    openFilters,
    otherCurrency,
    callsNeededFor12Months,
  };
}
