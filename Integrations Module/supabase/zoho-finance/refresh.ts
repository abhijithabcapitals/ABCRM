// Rebuilds the one zoho_finance_snapshot row. Limits: design document section 4.
// Stops at MAX_CALLS Zoho calls, and a section it did not finish has no total. A failure keeps the old numbers.

import { browserMessage, UserError } from "./errors.ts";
import { buildFigures, ledgerStart } from "./figures.ts";
import type { Deps, ZohoLike } from "./handlers.ts";
import { ledgerAccountCount, readAccounts, readCash, readLedger, readOrganization, readPayables, readReceivables, UnfinishedRead } from "./zohoSources.ts";

export const MAX_CALLS = 90;
const LOCK_MINUTES = 5;
const AUTO_MINUTES = 60;
const FORCED_MINUTES = 5;
const MINUTE = 60_000;
const UAE_OFFSET_MS = 4 * 60 * MINUTE; // The UAE has no daylight saving.

export type RefreshResult = { status: "ok" | "partial" | "failed" | "busy" | "fresh"; error?: string };

class CallLimitReached extends Error {}

// A due date falls on a UAE calendar day, so "today" must too.
const uaeToday = (now: Date) => new Date(now.getTime() + UAE_OFFSET_MS).toISOString().slice(0, 10);

function limited(zoho: ZohoLike) {
  let used = 0;
  return {
    used: () => used,
    reader: {
      orgId: zoho.orgId,
      get: (path: string, query?: Record<string, string>) => {
        if (used >= MAX_CALLS) throw new CallLimitReached();
        used++;
        return zoho.get(path, query);
      },
    },
  };
}

export async function refresh({ force }: { force: boolean }, deps: Deps): Promise<RefreshResult> {
  if (!(await deps.isAdmin())) throw new UserError("Only a CRM admin can do this.");

  // Before the claim, because not being connected is not an attempt: adding the login must let the next open refresh.
  let client: ZohoLike | undefined;
  let clientError: unknown;
  try {
    client = await deps.zoho();
  } catch (e) {
    if ((e as Error)?.name === "MissingSecretError") return { status: "failed", error: "not_connected" };
    clientError = e;
  }

  const table = () => deps.db.from("zoho_finance_snapshot");
  const now = deps.now();
  const ago = (minutes: number) => new Date(now.getTime() - minutes * MINUTE).toISOString();
  const olderThan = (column: string, cutoff: string) => `${column}.is.null,${column}.lt."${cutoff}"`;

  // Claim the row. The lock and both age limits sit in this one update, so there is no gap between checking and claiming.
  // A failure keeps the old as_of, so last_attempt_at is what stops each Dashboard open spending up to 90 calls again.
  const claim = now.toISOString();
  const wait = ago(force ? FORCED_MINUTES : AUTO_MINUTES);
  const { data: claimed, error: claimError } = await table()
    .update({ refreshing_since: claim, last_attempt_at: claim })
    .eq("id", 1)
    .or(olderThan("refreshing_since", ago(LOCK_MINUTES)))
    .or(olderThan("last_attempt_at", wait))
    .or(olderThan("as_of", wait))
    .select("id");
  if (claimError) throw new Error(`Snapshot claim failed: ${claimError.message}`);
  if (!claimed?.length) {
    const { data: row, error: readError } = await table().select("refreshing_since").eq("id", 1).maybeSingle();
    if (readError) throw new Error(`Snapshot read failed: ${readError.message}`);
    const live = row?.refreshing_since && Date.parse(row.refreshing_since) >= Date.parse(ago(LOCK_MINUTES));
    return { status: live ? "busy" : "fresh" };
  }

  // Writes only while this run still holds the lock, so a run taken over as abandoned cannot overwrite the newer one.
  // False means the lock was lost and nothing was stored.
  const finish = async (fields: Record<string, unknown>): Promise<boolean> => {
    const { data: stored, error } = await table()
      .update({ ...fields, refreshing_since: null })
      .eq("id", 1)
      .eq("refreshing_since", claim)
      .select("id");
    if (error) throw new Error(`Snapshot write failed: ${error.message}`);
    return (stored?.length ?? 0) > 0;
  };

  let calls: ReturnType<typeof limited> | undefined;
  try {
    if (!client) throw clientError;
    calls = limited(client);
    const zoho = calls.reader;
    let stopped = false;
    const section = async <T>(read: () => Promise<T>): Promise<T | null> => {
      if (stopped) return null;
      try {
        return await read();
      } catch (e) {
        // Only this section is unfinished. The others can still be read.
        if (e instanceof UnfinishedRead) return null;
        if (!(e instanceof CallLimitReached)) throw e;
        stopped = true;
        return null;
      }
    };

    const today = uaeToday(now);
    const { currency, fiscalStartMonth } = await readOrganization(zoho);
    const accounts = await section(() => readAccounts(zoho));
    const receivables = await section(() => readReceivables(zoho));
    const payables = await section(() => readPayables(zoho));
    const cash = await section(() => readCash(zoho, accounts, currency));
    // At least one call per account. If they cannot fit, the ledger could only end partial, so no calls are spent on it.
    if (accounts && ledgerAccountCount(accounts) > MAX_CALLS - calls.used()) stopped = true;
    const ledger = accounts && await section(() => readLedger(zoho, accounts, ledgerStart(today), today));

    const data = buildFigures({
      currency,
      fiscalStartMonth,
      receivables,
      payables,
      balances: accounts && accounts.map(({ type, balance }) => ({ type, balance })),
      cash,
      ledger,
    }, today);

    const status = data.partial.length > 0 ? "partial" : "ok";
    const stored = await finish({
      data,
      as_of: deps.now().toISOString(),
      status,
      calls_used: calls.used(),
      error: stopped
        ? `The limit of ${MAX_CALLS} Zoho calls was not enough. Some figures are incomplete.`
        : status === "partial"
        ? "Some figures could not be read from Zoho."
        : null,
    });
    return stored ? { status } : { status: "busy" };
  } catch (e) {
    // The raw detail is for the server log only, scrubbed of secrets.
    console.error("zoho-finance: refresh failed:", (e as Error)?.name, deps.scrub(String((e as Error)?.message)));
    const message = browserMessage(e);
    const stored = await finish({ status: "failed", error: message, calls_used: calls?.used() ?? 0 });
    return stored ? { status: "failed", error: message } : { status: "busy" };
  }
}
