// Everything specific to Zoho's responses: paths, query parameters, filters, field names and balance signs,
// mapped to the plain inputs figures.ts takes. Later live probe results should change only this file.
//
// The live probe has NOT run. All of this comes from Zoho's public documentation
// (https://www.zoho.com/books/api/v3/). Each comment marked UNVERIFIED is a choice the probe must confirm.

import type { Balance, CashAccount, LedgerEntry, OpenDoc } from "./figures.ts";

// deno-lint-ignore no-explicit-any
type Json = any;

export type ZohoReader = {
  orgId: string;
  get(path: string, query?: Record<string, string>): Promise<Json>;
};
export type SourceAccount = Balance & { id: string; name: string; parentId: string | null };

// The probe on the live organisation, 2026-11-04: this path filters by account and date, lists rows under "transactions"
// and says whether more pages exist. /chartofaccounts/accounttransactions does none of the last two, despite the docs.
export const TRANSACTIONS_PATH = "/chartofaccounts/transactions";
const PER_PAGE = 200;

const num = (v: unknown): number | null => {
  if (typeof v !== "number" && typeof v !== "string") return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const blank = (v: unknown) => v === undefined || v === null || v === "";
// Read to the day. Zoho may send a longer timestamp. Returns null for anything that is not a real date.
const dateOf = (v: unknown): string | null => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const day = v.slice(0, 10);
  const parsed = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : null;
};

// A list whose end could not be seen. refresh.ts leaves that section unfinished, rather than failing the whole refresh.
export class UnfinishedRead extends Error {}

// The keys an account transactions reply may hold its rows under. handlers.ts reads this same list, so the probe and
// readLedger cannot disagree. UNVERIFIED: which of them Zoho uses. The probe reports it.
export const TRANSACTION_KEYS = ["transactions", "accounttransactions"];
export const transactionKey = (res: Json): string | undefined => TRANSACTION_KEYS.find((k) => Array.isArray(res?.[k]));

// True when the reply says whether more pages exist. Only then can its list be called complete.
export const hasPageContext = (res: Json): boolean => typeof res?.page_context?.has_more_page === "boolean";

// Reads every page of a list. A reply without the list is an error: an empty result would look like a real zero.
// A reply that does not say whether more pages exist is an unfinished read: the server's page can be smaller than the
// one asked for, so a short page does not prove the end. UNVERIFIED: the documented account transactions reply shows no
// page_context. If Zoho really omits it, the ledger stays unfinished until this is changed. The probe's pageContext reports it.
async function readAll(zoho: ZohoReader, path: string, keys: string | string[], query: Record<string, string> = {}): Promise<Json[]> {
  const names = Array.isArray(keys) ? keys : [keys];
  const rows: Json[] = [];
  for (let page = 1;; page++) {
    const res = await zoho.get(path, { ...query, per_page: String(PER_PAGE), page: String(page) });
    const key = names.find((k) => Array.isArray(res?.[k]));
    if (!key) throw new Error(`Zoho reply to ${path} had no ${names.join(" or ")} list.`);
    rows.push(...res[key]);
    if (!hasPageContext(res)) throw new UnfinishedRead(`Zoho reply to ${path} did not say whether more pages exist.`);
    if (res.page_context.has_more_page !== true) return rows;
  }
}

// ---- Organisation ----

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// Returns 1 for January. UNVERIFIED: the documentation creates an organisation with "january" and shows 0 in the
// reply, so a number is read as zero-based, and a name as itself. Anything else falls back to January.
export function fiscalMonthFrom(v: unknown): number {
  if (typeof v === "string" && MONTHS.includes(v.toLowerCase())) return MONTHS.indexOf(v.toLowerCase()) + 1;
  if (typeof v === "boolean") return 1;
  const n = num(v);
  return n !== null && Number.isInteger(n) && n >= 0 && n <= 11 ? n + 1 : 1;
}

export async function readOrganization(zoho: ZohoReader): Promise<{ currency: string; fiscalStartMonth: number }> {
  const res = await zoho.get("/organizations");
  const orgs: Json[] = Array.isArray(res?.organizations) ? res.organizations : [];
  const org = orgs.find((o) => String(o?.organization_id) === zoho.orgId);
  // UNVERIFIED: currency_code is assumed to be in this reply. The documentation's create reply does not show it.
  // Without a base currency no amount can be stated, so this stops the refresh rather than guess one.
  const currency = text(org?.currency_code);
  if (!org || !currency) throw new Error("Zoho organisation or its base currency could not be read.");
  return { currency, fiscalStartMonth: fiscalMonthFrom(org.fiscal_year_start_month) };
}

// ---- Chart of accounts ----

// UNVERIFIED: current_balance is assumed to be in the natural sign (assets, liabilities and equity positive) and in
// the base currency. If the probe finds a type reversed, set it to -1 here. The value is never made positive with
// abs, because an overdrawn bank or a negative equity is a real figure.
const BALANCE_SIGN: Record<string, 1 | -1> = {};

// UNVERIFIED: a parent account's current_balance is assumed to hold only its own postings. If it rolls up its
// children, sums here would count those twice. The probe's parentEqualsChildren tests this, and parentId is kept for a fix.
// UNVERIFIED: whether equity accounts hold this year's earnings. Zoho's balance sheet may work that out separately,
// which would make equity here too low and debt to equity too high. The probe's assetsMinusLiabilitiesEqualsEquity
// tests this. Paging this list with per_page and page is also assumed.
export async function readAccounts(zoho: ZohoReader): Promise<SourceAccount[]> {
  const rows = await readAll(zoho, "/chartofaccounts", "chartofaccounts", { showbalance: "true" });
  return rows.map((a) => {
    const type = String(a?.account_type ?? "");
    const balance = num(a?.current_balance);
    return {
      id: String(a?.account_id ?? ""),
      name: String(a?.account_name ?? ""),
      type,
      balance: balance === null ? null : balance * (BALANCE_SIGN[type] ?? 1),
      parentId: blank(a?.parent_account_id) ? null : String(a.parent_account_id),
    };
  });
}

// ---- Open invoices and bills ----

// UNVERIFIED: which of these filters overlap. Rows are matched by ID, so an overlap cannot count a document twice and
// the union is right whichever way they overlap. The reconciliation line shows anything these filters miss.
const INVOICE_FILTERS = ["unpaid", "overdue", "partially_paid"];
const BILL_FILTERS = ["open", "overdue", "partially_paid"];
const CLOSED = new Set(["paid", "void", "draft"]);

async function readOpen(zoho: ZohoReader, path: string, key: string, filters: string[], idField: string, nameField: string): Promise<OpenDoc[]> {
  const byId = new Map<string, OpenDoc>();
  for (const status of filters) {
    for (const d of await readAll(zoho, path, key, { status })) {
      if (CLOSED.has(d?.status)) continue;
      const balance = num(d?.balance);
      // A balance that cannot be read is kept, so figures.ts counts it as excluded. A balance of nil is simply settled.
      if (balance !== null && balance <= 0) continue;
      // Without an ID, documents would collapse into one and the total would come out low.
      if (blank(d?.[idField])) throw new Error(`Zoho ${key} row had no ${idField}.`);
      // A due date that cannot be read fails: treated as current, it would understate what is overdue. A blank one
      // stays blank, and figures.ts counts it as current. UNVERIFIED: whether Zoho ever sends a blank due date.
      const dueDate = dateOf(d?.due_date);
      if (dueDate === null && !blank(d?.due_date)) throw new Error(`Zoho ${key} row had an unreadable due date.`);
      byId.set(String(d[idField]), {
        name: String(d?.[nameField] ?? ""),
        dueDate,
        balance,
        currency: text(d?.currency_code),
        // UNVERIFIED: balance is assumed to be in the document's currency, and exchange_rate to be base currency per
        // one unit of it. The bills list reply documents both; the invoices list is assumed to match.
        rate: num(d?.exchange_rate),
      });
    }
  }
  return [...byId.values()];
}

export const readReceivables = (zoho: ZohoReader) => readOpen(zoho, "/invoices", "invoices", INVOICE_FILTERS, "invoice_id", "customer_name");
export const readPayables = (zoho: ZohoReader) => readOpen(zoho, "/bills", "bills", BILL_FILTERS, "bill_id", "vendor_name");

// ---- Cash ----

const CASH_TYPES = ["bank", "cash"];

// The documented list also holds credit cards, which are liabilities, so they are left out. An account in another
// currency needs bcy_balance (UNVERIFIED: read as the base currency balance); without it the balance is unknown.
// UNVERIFIED: whether the list holds cash accounts such as petty cash. Any bank or cash account in the chart of
// accounts but not in the list is added from there, and its balance is assumed to be in the base currency.
// UNVERIFIED: this join assumes account_id is the same in /bankaccounts and /chartofaccounts. If it differs, every bank
// account is added twice. The probe's cashMatchesChart tests the totals.
export async function readCash(zoho: ZohoReader, accounts: SourceAccount[] | null, currency: string): Promise<CashAccount[]> {
  const rows = await readAll(zoho, "/bankaccounts", "bankaccounts");
  const seen = new Set<string>();
  const out: CashAccount[] = [];
  for (const a of rows) {
    if (!blank(a?.account_type) && !CASH_TYPES.includes(a.account_type)) continue;
    seen.add(String(a?.account_id)); // UNVERIFIED join key, see above.
    const base = num(a?.bcy_balance);
    const own = a?.currency_code === currency ? num(a?.balance) : null;
    out.push({ name: String(a?.account_name ?? ""), balance: base ?? own });
  }
  for (const a of accounts ?? []) {
    // UNVERIFIED join key, see above.
    if (CASH_TYPES.includes(a.type) && !seen.has(a.id)) out.push({ name: a.name, balance: a.balance });
  }
  return out;
}

// ---- Revenue and cost ----

// Revenue is income accounts only. Other income counts in net profit and net margin alone. Other expense counts in cost
// and net profit, and is not cost of goods sold. So net profit can match Zoho's own Profit and Loss screen, which
// section 8's accuracy check compares.
const KINDS: Record<string, LedgerEntry["kind"]> = {
  income: "revenue",
  other_income: "otherIncome",
  expense: "expense",
  other_expense: "expense",
  cost_of_goods_sold: "cogs",
};

// The fewest calls readLedger can make: one per account. refresh.ts skips the ledger when these do not fit the calls left.
export const ledgerAccountCount = (accounts: SourceAccount[]) => accounts.filter((a) => KINDS[a.type]).length;

// UNVERIFIED: date_start and date_end are the documented filter names, and the probe tests a second style.
// UNVERIFIED: debit_amount and credit_amount are assumed to be in the base currency, even where currency_code differs.
// UNVERIFIED: a parent account's list is assumed to hold only its own postings.
// One call or more per income and cost account, so a large chart of accounts can hit the call limit.
// Two accounts are read at once. The rows are joined in account order, so the order they finish in changes nothing.
const LEDGER_PARALLEL = 2;

export async function readLedger(zoho: ZohoReader, accounts: SourceAccount[], from: string, to: string): Promise<LedgerEntry[]> {
  const todo = accounts.filter((a) => KINDS[a.type]);
  const perAccount: LedgerEntry[][] = todo.map(() => []);
  let next = 0;
  let failed = false;
  let firstError: unknown;
  const worker = async () => {
    while (!failed && next < todo.length) {
      const i = next++;
      try {
        perAccount[i] = await readAccountLedger(zoho, todo[i], from, to);
      } catch (e) {
        // Nothing new starts after the first error. The other worker finishes what it is reading.
        // An unfinished list is the least serious error, so a limit, time or Zoho error from the other worker wins.
        if (!failed || (firstError instanceof UnfinishedRead && !(e instanceof UnfinishedRead))) firstError = e;
        failed = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(LEDGER_PARALLEL, todo.length) }, worker));
  if (failed) throw firstError;
  return perAccount.flat();
}

async function readAccountLedger(zoho: ZohoReader, a: SourceAccount, from: string, to: string): Promise<LedgerEntry[]> {
  const kind = KINDS[a.type];
  const out: LedgerEntry[] = [];
  const rows = await readAll(zoho, TRANSACTIONS_PATH, TRANSACTION_KEYS, { account_id: a.id, date_start: from, date_end: to });
  for (const r of rows) {
    // A row that cannot be read fails the refresh. Dropping it would understate the totals without any sign.
    const date = dateOf(text(r?.transaction_date) ?? text(r?.date));
    if (!date) throw new Error("Zoho transaction had no readable date.");
    const debit = num(r?.debit_amount);
    const credit = num(r?.credit_amount);
    const unreadable = (!blank(r?.debit_amount) && debit === null) || (!blank(r?.credit_amount) && credit === null);
    if (unreadable || (debit === null && credit === null)) throw new Error("Zoho transaction had no readable amount.");
    // Income grows with credits, and costs with debits. The opposite side is a reversal, such as a credit note.
    const net = (credit ?? 0) - (debit ?? 0);
    const earned = kind === "revenue" || kind === "otherIncome";
    out.push({ account: a.name, kind, date, amount: earned ? net : -net || 0 });
  }
  return out;
}
