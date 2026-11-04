import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { MAX_CALLS, refresh, TIME_BUDGET_MS } from "./refresh.ts";
import { handle } from "./handlers.ts";
import { UserError } from "./errors.ts";
import { ZohoAccessError, ZohoHttpError } from "./zohoClient.ts";
import { MissingSecretError } from "./secrets.ts";

// deno-lint-ignore no-explicit-any
type Json = any;

const NOW = new Date("2026-11-04T08:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

// Behaves like the Supabase client for the one row, including the filters a claim depends on.
function fakeDb(start: Json = {}) {
  const row: Json = { id: 1, data: null, as_of: null, status: null, error: null, calls_used: null, refreshing_since: null, last_attempt_at: null, ...start };
  const db = {
    row,
    updates: [] as Json[],
    beforeUpdate: undefined as undefined | (() => void),
    from(table: string) {
      assertEquals(table, "zoho_finance_snapshot");
      const filters: ((r: Json) => boolean)[] = [];
      let patch: Json;
      const q: Json = {
        select: () => q,
        update: (p: Json) => {
          patch = p;
          return q;
        },
        eq: (col: string, val: unknown) => {
          filters.push((r) => r[col] === val);
          return q;
        },
        or: (expr: string) => {
          const m = expr.match(/^(\w+)\.is\.null,(\w+)\.lt\."(.+)"$/);
          assert(m && m[1] === m[2], `unexpected filter ${expr}`);
          filters.push((r) => r[m![1]] === null || Date.parse(r[m![1]]) < Date.parse(m![3]));
          return q;
        },
        maybeSingle: () => Promise.resolve({ data: { ...row }, error: null }),
        then: (ok: (v: Json) => unknown) => {
          db.beforeUpdate?.();
          const hit = filters.every((f) => f(row));
          if (hit) {
            Object.assign(row, patch);
            db.updates.push(patch);
          }
          return Promise.resolve({ data: hit ? [{ id: 1 }] : [], error: null }).then(ok);
        },
      };
      return q;
    },
  };
  return db;
}

function fakeZoho(accountCount = 2, over: (path: string, q: Record<string, string>) => Json = () => undefined) {
  const calls: { path: string; q: Record<string, string> }[] = [];
  const answer = (path: string, q: Record<string, string>): Json => {
    const special = over(path, q);
    if (special !== undefined) return special;
    if (path === "/organizations") return { organizations: [{ organization_id: "ORG1", currency_code: "AED", fiscal_year_start_month: "january" }] };
    if (path === "/chartofaccounts") {
      const accounts = [
        { account_id: "A1", account_name: "AR", account_type: "accounts_receivable", current_balance: 100 },
        { account_id: "A2", account_name: "AP", account_type: "accounts_payable", current_balance: 50 },
        { account_id: "A3", account_name: "Bank", account_type: "bank", current_balance: 300 },
      ];
      for (let i = 0; i < accountCount; i++) {
        accounts.push({ account_id: `E${i}`, account_name: `Exp ${i}`, account_type: i === 0 ? "income" : "expense", current_balance: 0 });
      }
      return { chartofaccounts: accounts, page_context: { has_more_page: false } };
    }
    if (path === "/invoices") {
      return { invoices: q.status === "unpaid" ? [{ invoice_id: "1", customer_name: "C", status: "sent", due_date: "2026-11-30", balance: 100, currency_code: "AED", exchange_rate: 1 }] : [] };
    }
    if (path === "/bills") {
      return { bills: q.status === "open" ? [{ bill_id: "2", vendor_name: "V", status: "open", due_date: "2026-11-30", balance: 50, currency_code: "AED", exchange_rate: 1 }] : [] };
    }
    if (path === "/bankaccounts") return { bankaccounts: [{ account_id: "A3", account_name: "Bank", account_type: "bank", currency_code: "AED", balance: 300, bcy_balance: 300 }] };
    return { transactions: [{ transaction_date: "2026-10-01", credit_amount: 10, debit_amount: 10 }], page_context: { has_more_page: false } };
  };
  return {
    calls,
    orgId: "ORG1",
    get: (path: string, q: Record<string, string> = {}) => {
      calls.push({ path, q });
      // A reply says it is the last page unless the test sets page_context itself. Set to undefined, it is left out.
      return Promise.resolve().then(() => {
        const reply = answer(path, q);
        return reply && typeof reply === "object" && !("page_context" in reply) ? { ...reply, page_context: { has_more_page: false } } : reply;
      });
    },
  };
}

// A clock that moves only when a test or the limiter's sleep moves it, so no test waits.
function fakeClock(start: Date = NOW) {
  let t = start.getTime();
  return {
    now: () => new Date(t),
    sleep: (ms: number) => {
      t += ms;
      return Promise.resolve();
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function deps(db: Json, zoho: Json = fakeZoho(), over: Json = {}) {
  const clock = fakeClock();
  return { isAdmin: () => Promise.resolve(true), zoho: () => Promise.resolve(zoho), db, now: clock.now, sleep: clock.sleep, scrub: (t: string) => t, ...over };
}

const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
};

Deno.test("the limit is 200 calls and 125 seconds", () => {
  assertEquals(MAX_CALLS, 200);
  assertEquals(TIME_BUDGET_MS, 125_000);
});

Deno.test("a second refresh while one is 1 minute old is busy, with no Zoho call", async () => {
  const z = fakeZoho();
  const db = fakeDb({ refreshing_since: minutesAgo(1) });
  assertEquals(await refresh({ force: false }, deps(db, z)), { status: "busy" });
  assertEquals(z.calls.length, 0);
  assertEquals(db.row.refreshing_since, minutesAgo(1));
});

Deno.test("a refresh 6 minutes old counts as abandoned, so this one runs", async () => {
  const z = fakeZoho();
  const db = fakeDb({ refreshing_since: minutesAgo(6) });
  assertEquals((await refresh({ force: false }, deps(db, z))).status, "ok");
  assert(z.calls.length > 0);
  assertEquals(db.row.refreshing_since, null);
});

Deno.test("an automatic refresh waits for 360 minutes", async () => {
  for (const [age, want] of [[359, "fresh"], [360, "fresh"], [361, "ok"]] as const) {
    const out = await refresh({ force: false }, deps(fakeDb({ as_of: minutesAgo(age) })));
    assertEquals(out.status, want, `${age} minutes`);
  }
});

Deno.test("the Refresh button waits for 5 minutes", async () => {
  for (const [age, want] of [[4, "fresh"], [5, "fresh"], [6, "ok"]] as const) {
    const out = await refresh({ force: true }, deps(fakeDb({ as_of: minutesAgo(age) })));
    assertEquals(out.status, want, `${age} minutes`);
  }
});

Deno.test("fresh makes no Zoho call and writes nothing", async () => {
  const z = fakeZoho();
  const db = fakeDb({ as_of: minutesAgo(1) });
  await refresh({ force: true }, deps(db, z));
  assertEquals(z.calls.length, 0);
  assertEquals(db.updates, []);
});

Deno.test("a successful refresh stores the figures, the time and the calls, and clears the lock", async () => {
  const z = fakeZoho();
  const db = fakeDb({ error: "old error" });
  assertEquals(await refresh({ force: false }, deps(db, z)), { status: "ok" });
  assertEquals(db.row.status, "ok");
  assertEquals(db.row.error, null);
  assertEquals(db.row.as_of, NOW.toISOString());
  assertEquals(db.row.refreshing_since, null);
  assertEquals(db.row.calls_used, z.calls.length);
  assertEquals(db.row.data.ar.total, 100);
  assertEquals(db.row.data.ap.total, 50);
  assertEquals(db.row.data.cash.total, 300);
  assertEquals(db.row.data.currency, "AED");
  assertEquals(db.row.data.ratios.current, 8); // (100 + 300) / 50
  assertEquals(db.row.data.partial, []);
});

Deno.test("today is the date in the UAE, not in UTC", async () => {
  const late = new Date("2026-12-31T21:00:00.000Z"); // 01:00 on 1 January in the UAE
  const db = fakeDb();
  await refresh({ force: false }, deps(db, fakeZoho(), { now: () => late }));
  assertEquals(db.row.data.period, { from: "2027-01-01", to: "2027-01-01" });
});

Deno.test("the 201st call never happens: status is partial and the unfinished sections are named", async () => {
  // Few enough accounts to try, but one account's transactions never run out of pages.
  const z = fakeZoho(2, (p) =>
    p.startsWith("/chartofaccounts/")
      ? { transactions: [{ transaction_date: "2026-10-01", credit_amount: 1 }], page_context: { has_more_page: true } }
      : undefined);
  const db = fakeDb();
  const clock = fakeClock();
  assertEquals(await refresh({ force: false }, deps(db, z, { now: clock.now, sleep: clock.sleep })), { status: "partial" });
  assertEquals(z.calls.length, MAX_CALLS);
  assertEquals(db.row.calls_used, MAX_CALLS);
  assertEquals(db.row.status, "partial");
  assertEquals(db.row.as_of, clock.now().toISOString());
  assertEquals(db.row.refreshing_since, null);
  assertEquals(db.row.data.partial, ["monthly", "ytd", "topCosts", "ratios", "health"]);
  assertEquals(db.row.error, "The limit of 200 Zoho calls was not enough. Some figures are incomplete.");
});

Deno.test("a section that did not finish has no total in data, though earlier sections do", async () => {
  const z = fakeZoho(200);
  const db = fakeDb();
  await refresh({ force: false }, deps(db, z));
  assertEquals(db.row.data.monthly, null);
  assertEquals(db.row.data.ytd, null);
  assertEquals(db.row.data.topCosts, null);
  assertEquals(db.row.data.health.missing, ["Cash cover", "Net margin"]);
  assertEquals(db.row.data.partial.includes("health"), true);
  assertEquals(db.row.data.ar.total, 100);
  assertEquals(db.row.data.ratios.current !== null, true);
  assertEquals(db.row.data.ratios.dso, null);
});

Deno.test("stopping part way through a list gives no partial total for it", async () => {
  // Invoices never run out of pages, so the limit lands inside the first receivables list.
  const z = fakeZoho(2, (p, q) =>
    p === "/invoices"
      ? {
        invoices: [{ invoice_id: `I${q.page}`, customer_name: "C", status: "sent", due_date: "2026-11-30", balance: 100, currency_code: "AED", exchange_rate: 1 }],
        page_context: { has_more_page: true },
      }
      : undefined);
  const db = fakeDb();
  assertEquals((await refresh({ force: false }, deps(db, z))).status, "partial");
  assertEquals(z.calls.length, MAX_CALLS);
  assertEquals([db.row.data.ar, db.row.data.ap, db.row.data.cash], [null, null, null]);
  assertEquals(db.row.data.partial, ["ar", "ap", "cash", "monthly", "ytd", "topCosts", "ratios", "health"]);
});

Deno.test("a Zoho failure keeps the data and time, says failed in plain words, and clears the lock", async () => {
  const old = { ar: { total: 1 } };
  const z = fakeZoho(2, (p) => {
    if (p === "/bills") throw new ZohoHttpError(429, "raw detail");
  });
  const db = fakeDb({ data: old, as_of: minutesAgo(600), status: "ok" });
  const out = await quiet(() => refresh({ force: false }, deps(db, z)));
  assertEquals(out, { status: "failed", error: "Zoho is busy, try again shortly." });
  assertEquals(db.row.data, old);
  assertEquals(db.row.as_of, minutesAgo(600));
  assertEquals(db.row.status, "failed");
  assertEquals(db.row.error, "Zoho is busy, try again shortly.");
  assertEquals(db.row.refreshing_since, null);
  assert(!JSON.stringify(db.row).includes("raw detail"));
});

Deno.test("ZohoAccessError stores the reconnect message", async () => {
  const z = fakeZoho(2, () => {
    throw new ZohoAccessError("invalid_code");
  });
  const db = fakeDb();
  const out = await quiet(() => refresh({ force: false }, deps(db, z)));
  assertEquals(out.status, "failed");
  assertEquals(db.row.error, "Zoho access has stopped. An admin must reconnect.");
});

Deno.test("a response of the wrong shape fails and keeps the old numbers", async () => {
  const z = fakeZoho(2, (p) => (p === "/bills" ? { nothing: true } : undefined));
  const db = fakeDb({ data: { keep: true }, as_of: minutesAgo(600) });
  assertEquals((await quiet(() => refresh({ force: false }, deps(db, z)))).status, "failed");
  assertEquals(db.row.data, { keep: true });
});

Deno.test("a non-admin gets UserError, before anything is read", async () => {
  const z = fakeZoho();
  const db = fakeDb();
  await assertRejects(() => refresh({ force: false }, deps(db, z, { isAdmin: () => Promise.resolve(false) })), UserError);
  assertEquals(z.calls.length, 0);
  assertEquals(db.updates, []);
});

Deno.test("MissingSecretError is not_connected and leaves stored data alone", async () => {
  const start = { data: { keep: true }, as_of: minutesAgo(600), status: "ok", error: null, calls_used: 9 };
  const db = fakeDb(start);
  const out = await refresh({ force: false }, deps(db, null, { zoho: () => Promise.reject(new MissingSecretError("X")) }));
  assertEquals(out, { status: "failed", error: "not_connected" });
  for (const [k, v] of Object.entries(start)) assertEquals(db.row[k], v);
  assertEquals(db.row.refreshing_since, null);
  // Not an attempt: adding the login must let the next open refresh at once.
  assertEquals(db.row.last_attempt_at, null);
  assertEquals(db.updates, []);
});

Deno.test("a run that lost its lock does not overwrite the run that took over", async () => {
  const db = fakeDb();
  const z = fakeZoho(2, (p) => {
    // Another run claims the row while this one is reading Zoho.
    if (p === "/bankaccounts") db.row.refreshing_since = "2026-11-04T08:06:00.000Z";
    return undefined;
  });
  assertEquals(await refresh({ force: false }, deps(db, z)), { status: "busy" });
  assertEquals(db.row.data, null);
  assertEquals(db.row.refreshing_since, "2026-11-04T08:06:00.000Z");
});

Deno.test("handle routes refresh and passes only a true force", async () => {
  const forced = fakeDb({ as_of: minutesAgo(6) });
  assertEquals(await handle("refresh", { force: true }, deps(forced)), { status: "ok" });
  const notForced = fakeDb({ as_of: minutesAgo(6) });
  assertEquals(await handle("refresh", { force: "yes" }, deps(notForced)), { status: "fresh" });
});

Deno.test("a run that lost its lock and then failed also reports busy, and writes nothing", async () => {
  const db = fakeDb();
  const z = fakeZoho(2, (p) => {
    if (p === "/bankaccounts") {
      db.row.refreshing_since = "2026-11-04T08:06:00.000Z";
      throw new ZohoHttpError(429, "x");
    }
  });
  assertEquals(await quiet(() => refresh({ force: false }, deps(db, z))), { status: "busy" });
  assertEquals(db.row.status, null);
  assertEquals(db.row.error, null);
});

Deno.test("claiming records the attempt, and a failure keeps it", async () => {
  const z = fakeZoho(2, (p) => {
    if (p === "/bills") throw new ZohoHttpError(500, "x");
  });
  const db = fakeDb();
  await quiet(() => refresh({ force: false }, deps(db, z)));
  assertEquals(db.row.last_attempt_at, NOW.toISOString());
  assertEquals(db.updates[0].last_attempt_at, NOW.toISOString());
  assertEquals(db.updates[0].refreshing_since, NOW.toISOString());
});

Deno.test("an automatic refresh skips for 360 minutes after any attempt, even with old figures", async () => {
  for (const [age, want] of [[359, "fresh"], [360, "fresh"], [361, "ok"]] as const) {
    const z = fakeZoho();
    const db = fakeDb({ as_of: minutesAgo(600), status: "failed", last_attempt_at: minutesAgo(age) });
    assertEquals((await refresh({ force: false }, deps(db, z))).status, want, `${age} minutes`);
    assertEquals(z.calls.length > 0, want === "ok");
  }
});

Deno.test("the Refresh button waits 5 minutes after any attempt", async () => {
  for (const [age, want] of [[4, "fresh"], [5, "fresh"], [6, "ok"]] as const) {
    const db = fakeDb({ as_of: minutesAgo(600), status: "failed", last_attempt_at: minutesAgo(age) });
    assertEquals((await refresh({ force: true }, deps(db))).status, want, `${age} minutes`);
  }
});

Deno.test("repeat opens after a failure spend Zoho calls only once", async () => {
  const z = fakeZoho(2, (p) => {
    if (p === "/bills") throw new ZohoHttpError(500, "x");
  });
  const db = fakeDb({ as_of: minutesAgo(600) });
  await quiet(() => refresh({ force: false }, deps(db, z)));
  const spent = z.calls.length;
  for (let i = 0; i < 5; i++) assertEquals((await refresh({ force: false }, deps(db, z))).status, "fresh");
  assertEquals(z.calls.length, spent);
});

Deno.test("the age condition is inside the claim, with no read first that could go stale", async () => {
  // Another run finishes at the moment this run claims. Only a condition in the claim itself can see that.
  const db = fakeDb({ as_of: minutesAgo(600) });
  db.beforeUpdate = () => Object.assign(db.row, { as_of: NOW.toISOString(), last_attempt_at: NOW.toISOString() });
  assertEquals((await refresh({ force: true }, deps(db))).status, "fresh");
  assertEquals(db.updates, []);
});

Deno.test("a list that does not say whether more pages exist leaves only its section unfinished", async () => {
  const z = fakeZoho(2, (p) => (p === "/bills" ? { bills: [], page_context: undefined } : undefined));
  const db = fakeDb();
  assertEquals(await refresh({ force: false }, deps(db, z)), { status: "partial" });
  assertEquals(db.row.data.ap, null);
  assert(db.row.data.ar !== null);
  assert(db.row.data.partial.includes("ap"));
  assert(!db.row.data.partial.includes("ar"));
  // Later sections are still read.
  assert(z.calls.some((c) => c.path === "/bankaccounts"));
  assert(z.calls.some((c) => c.path.startsWith("/chartofaccounts/")));
});

Deno.test("a live lock with recent figures is reported as busy", async () => {
  const db = fakeDb({ refreshing_since: minutesAgo(1), last_attempt_at: minutesAgo(1) });
  assertEquals(await refresh({ force: false }, deps(db)), { status: "busy" });
});

Deno.test("a chart too large for the calls left skips the ledger, marked partial, without wasting calls", async () => {
  const z = fakeZoho(200);
  const db = fakeDb();
  assertEquals(await refresh({ force: false }, deps(db, z)), { status: "partial" });
  assertEquals(z.calls.some((c) => c.path.startsWith("/chartofaccounts/")), false);
  assert(z.calls.length < 15, `spent ${z.calls.length} calls`);
  assertEquals(db.row.calls_used, z.calls.length);
  assertEquals(db.row.data.partial, ["monthly", "ytd", "topCosts", "ratios", "health"]);
  assertEquals(db.row.error, "This Zoho organisation has 200 income and cost accounts, more than the limit of 200 calls.");
});

Deno.test("a chart that exactly fits the calls left is read", async () => {
  // 9 fixed calls: organisation, chart, 3 invoice filters, 3 bill filters, bank accounts. 191 are left.
  const fits = fakeZoho(191);
  assertEquals((await refresh({ force: false }, deps(fakeDb(), fits))).status, "ok");
  assertEquals(fits.calls.length, MAX_CALLS);
  const over = fakeZoho(192);
  assertEquals((await refresh({ force: false }, deps(fakeDb(), over))).status, "partial");
  assertEquals(over.calls.length, 9);
});

Deno.test("the failure log is scrubbed", async () => {
  const z = fakeZoho(2, () => {
    throw new Error("bad token SECRET123");
  });
  const logged: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => logged.push(a.join(" "));
  try {
    await refresh({ force: false }, deps(fakeDb(), z, { scrub: (t: string) => t.replaceAll("SECRET123", "[hidden]") }));
  } finally {
    console.error = original;
  }
  assertEquals(logged.length, 1);
  assert(!logged[0].includes("SECRET123"));
  assert(logged[0].includes("[hidden]"));
});

Deno.test("a login that cannot be built fails like any Zoho failure, and counts as an attempt", async () => {
  const db = fakeDb({ data: { keep: true }, as_of: minutesAgo(600) });
  const out = await quiet(() => refresh({ force: false }, deps(db, null, { zoho: () => Promise.reject(new ZohoAccessError("x")) })));
  assertEquals(out, { status: "failed", error: "Zoho access has stopped. An admin must reconnect." });
  assertEquals(db.row.data, { keep: true });
  assertEquals(db.row.last_attempt_at, NOW.toISOString());
});

Deno.test("200 calls fit: a chart using all of them is read in full", async () => {
  const z = fakeZoho(191);
  const db = fakeDb();
  assertEquals((await refresh({ force: false }, deps(db, z))).status, "ok");
  assertEquals(z.calls.length, 200);
  assertEquals(db.row.error, null);
  assertEquals(db.row.data.partial, []);
});

Deno.test("the time budget stops new calls, stores the message, and leaves the unfinished sections without totals", async () => {
  const clock = fakeClock();
  // Each call takes 20 seconds, so the budget is gone during the first sections.
  const z = fakeZoho(2);
  const slow = {
    ...z,
    get: (p: string, q?: Record<string, string>) => {
      clock.advance(20_000);
      return z.get(p, q);
    },
  };
  const db = fakeDb();
  const out = await refresh({ force: false }, deps(db, slow, { now: clock.now, sleep: clock.sleep }));
  assertEquals(out, { status: "partial" });
  // A call starts only while less than 125 s have passed: the starts are at 0, 20, ... 120 s.
  assertEquals(z.calls.length, 7);
  assertEquals(db.row.calls_used, 7);
  assertEquals(db.row.error, "Zoho took too long, so some figures are incomplete. Refresh to try again.");
  assertEquals(db.row.refreshing_since, null);
  assertEquals(db.row.data.monthly, null);
  assertEquals(db.row.data.ytd, null);
  assertEquals(db.row.data.topCosts, null);
  assert(db.row.data.partial.includes("monthly"));
});

Deno.test("a call that is already running when the budget ends is allowed to finish", async () => {
  const clock = fakeClock();
  let finished = 0;
  const z = fakeZoho(2);
  const slow = {
    ...z,
    get: async (p: string, q?: Record<string, string>) => {
      if (p === "/bills" && q?.status === "open") clock.advance(TIME_BUDGET_MS + 1); // Ends the budget mid-call.
      const r = await z.get(p, q);
      finished++;
      return r;
    },
  };
  const db = fakeDb();
  await refresh({ force: false }, deps(db, slow, { now: clock.now, sleep: clock.sleep }));
  assertEquals(finished, z.calls.length); // Every call that started also finished.
  assertEquals(db.row.error, "Zoho took too long, so some figures are incomplete. Refresh to try again.");
});

Deno.test("ledger reads never run more than 2 at once, and never start more than 90 in a minute", async () => {
  const clock = fakeClock();
  const z = fakeZoho(190);
  const starts: number[] = [];
  let open = 0;
  let mostOpen = 0;
  const watched = {
    ...z,
    get: async (p: string, q?: Record<string, string>) => {
      starts.push(clock.now().getTime());
      open++;
      mostOpen = Math.max(mostOpen, open);
      try {
        await Promise.resolve();
        await Promise.resolve();
        return await z.get(p, q);
      } finally {
        open--;
      }
    },
  };
  const db = fakeDb();
  assertEquals((await refresh({ force: false }, deps(db, watched, { now: clock.now, sleep: clock.sleep }))).status, "ok");
  assertEquals(starts.length, 199);
  assert(mostOpen <= 2, `${mostOpen} at once`);
  assert(mostOpen === 2, "the ledger should use both slots");
  for (const t of starts) {
    const inWindow = starts.filter((s) => s > t - 60_000 && s <= t).length;
    assert(inWindow <= 90, `${inWindow} calls started within a minute`);
  }
  assertEquals(db.row.error, null);
});

Deno.test("a ledger that stops part way through the accounts leaves monthly, ytd and topCosts without totals", async () => {
  // One account never runs out of pages, so the call limit lands inside the ledger with other accounts already read.
  const z = fakeZoho(150, (p, q) =>
    p.startsWith("/chartofaccounts/") && q.account_id === "E100"
      ? { transactions: [{ transaction_date: "2026-10-01", credit_amount: 5 }], page_context: { has_more_page: true } }
      : undefined);
  const db = fakeDb();
  assertEquals((await refresh({ force: false }, deps(db, z))).status, "partial");
  assertEquals(z.calls.length, MAX_CALLS);
  assertEquals(db.row.data.monthly, null);
  assertEquals(db.row.data.ytd, null);
  assertEquals(db.row.data.topCosts, null);
  for (const key of ["monthly", "ytd", "topCosts"]) assert(db.row.data.partial.includes(key), key);
  assertEquals(db.row.data.ar.total, 100); // Sections that finished still show.
});

Deno.test("the first error in the ledger stops new reads, waits for those running, and fails the refresh", async () => {
  const z = fakeZoho(20, (p, q) => {
    if (p.startsWith("/chartofaccounts/") && q.account_id === "E3") throw new ZohoHttpError(500, "boom");
  });
  let open = 0;
  const watched = {
    ...z,
    get: async (p: string, q?: Record<string, string>) => {
      open++;
      try {
        await Promise.resolve();
        return await z.get(p, q);
      } finally {
        open--;
      }
    },
  };
  const db = fakeDb({ as_of: minutesAgo(600), data: { old: true } });
  const out = await quiet(() => refresh({ force: false }, deps(db, watched)));
  assertEquals(out.status, "failed");
  assertEquals(open, 0); // Nothing was left running when refresh returned.
  const spent = z.calls.length;
  await new Promise((r) => setTimeout(r, 20));
  assertEquals(z.calls.length, spent); // And nothing starts afterwards.
  assert(spent < 9 + 20, "reads kept starting after the error");
  assertEquals(db.row.data, { old: true });
  assertEquals(db.row.refreshing_since, null);
});
