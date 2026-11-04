// Rebuilds the one zoho_finance_snapshot row. Limits: design document section 4.
// Stops at MAX_CALLS Zoho calls, and a section it did not finish has no total. A failure keeps the old numbers.

import { browserMessage, UserError } from "./errors.ts";
import { buildFigures, ledgerStart } from "./figures.ts";
import type { Deps, ZohoLike } from "./handlers.ts";
import { readAccounts, readCash, readLedger, readOrganization, readPayables, readReceivables } from "./zohoSources.ts";

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

  const table = () => deps.db.from("zoho_finance_snapshot");
  const now = deps.now();

  const { data: row, error: readError } = await table().select("as_of").eq("id", 1).maybeSingle();
  if (readError) throw new Error(`Snapshot read failed: ${readError.message}`);
  const waitMinutes = force ? FORCED_MINUTES : AUTO_MINUTES;
  if (row?.as_of && now.getTime() - Date.parse(row.as_of) <= waitMinutes * MINUTE) return { status: "fresh" };

  // Claim the row. If another run holds a live lock, no row matches.
  const claim = now.toISOString();
  const cutoff = new Date(now.getTime() - LOCK_MINUTES * MINUTE).toISOString();
  const { data: claimed, error: claimError } = await table()
    .update({ refreshing_since: claim })
    .eq("id", 1)
    .or(`refreshing_since.is.null,refreshing_since.lt."${cutoff}"`)
    .select("id");
  if (claimError) throw new Error(`Snapshot claim failed: ${claimError.message}`);
  if (!claimed?.length) return { status: "busy" };

  // Writes only while this run still holds the lock, so a run taken over as abandoned cannot overwrite the newer one.
  const finish = async (fields: Record<string, unknown>) => {
    const { error } = await table().update({ ...fields, refreshing_since: null }).eq("id", 1).eq("refreshing_since", claim);
    if (error) throw new Error(`Snapshot write failed: ${error.message}`);
  };

  let calls: ReturnType<typeof limited> | undefined;
  try {
    calls = limited(await deps.zoho());
    const zoho = calls.reader;
    let stopped = false;
    const section = async <T>(read: () => Promise<T>): Promise<T | null> => {
      if (stopped) return null;
      try {
        return await read();
      } catch (e) {
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
    await finish({
      data,
      as_of: deps.now().toISOString(),
      status,
      calls_used: calls.used(),
      error: stopped
        ? `Stopped at the limit of ${MAX_CALLS} Zoho calls. Some figures are incomplete.`
        : status === "partial"
        ? "Some figures could not be read from Zoho."
        : null,
    });
    return { status };
  } catch (e) {
    if ((e as Error)?.name === "MissingSecretError") {
      await finish({});
      return { status: "failed", error: "not_connected" };
    }
    // The raw detail is for the server log. Zoho client errors were scrubbed of secrets when they were made.
    console.error("zoho-finance: refresh failed:", (e as Error)?.name, (e as Error)?.message);
    const message = browserMessage(e);
    await finish({ status: "failed", error: message, calls_used: calls?.used() ?? 0 });
    return { status: "failed", error: message };
  }
}
