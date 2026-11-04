import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { browserMessage, handle, pdfFileName, permissionCheck, UserError } from "./handlers.ts";
import { ZohoAccessError, ZohoHttpError, ZohoTimeoutError } from "./zohoClient.ts";
import { MissingSecretError } from "./secrets.ts";

type Call = { path: string; query?: Record<string, string> };
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

// In-memory stand-in for the service-role client. Supports the calls the handlers make.
function fakeDb(
  tables: Record<string, Row[]>,
  log: { tables: string[]; saved: unknown[]; conflicts: unknown[] },
  errors: Record<string, unknown> = {},
) {
  let seq = 0;
  return {
    from: (t: string) => {
      log.tables.push(t);
      tables[t] ??= [];
      let op = "select";
      let payload: Row = {};
      const filters: [string, unknown][] = [];
      const match = () => tables[t].filter((r) => filters.every(([k, v]) => r[k] === v));
      const run = (): { rows: Row[]; error: unknown } => {
        const err = errors[`${t}.${op}`];
        if (err) return { rows: [], error: err };
        if (op === "select" && errors[`${t}.hide`] === true) {
          // The first read misses a row that exists, as a second caller would see.
          errors[`${t}.hide`] = false;
          return { rows: [], error: null };
        }
        if (op === "insert") {
          if (t === "business_setup_invoices" && tables[t].some((r) => r.zoho_id === payload.zoho_id)) {
            return { rows: [], error: { code: "23505", message: "duplicate key value" } };
          }
          if (t === "zoho_documents") {
            const dup = tables[t].some((r) =>
              r.source_table === payload.source_table && r.source_id === payload.source_id && r.kind === payload.kind
            );
            if (dup) return { rows: [], error: { code: "23505", message: "duplicate key value" } };
          }
          const row = { id: `id-${++seq}`, ...payload };
          tables[t].push(row);
          return { rows: [{ ...row }], error: null };
        }
        if (op === "delete") {
          const rows = match();
          tables[t] = tables[t].filter((r) => !rows.includes(r));
          return { rows: rows.map((r) => ({ ...r })), error: null };
        }
        if (op === "update") {
          if (errors[`${t}.update.nomatch`]) return { rows: [], error: null };
          const rows = match();
          for (const r of rows) Object.assign(r, payload);
          return { rows: rows.map((r) => ({ ...r })), error: null };
        }
        return { rows: match(), error: null };
      };
      const b = {
        select: () => b,
        insert: (row: Row) => {
          op = "insert";
          payload = row;
          return b;
        },
        update: (row: Row) => {
          op = "update";
          payload = row;
          return b;
        },
        delete: () => {
          op = "delete";
          return b;
        },
        upsert: (row: Row, opts?: unknown) => {
          log.saved.push(row);
          log.conflicts.push(opts);
          const err = errors[`${t}.upsert`] ?? null;
          if (!err) {
            tables[t] = tables[t].filter((r) => r.client_id !== row.client_id);
            tables[t].push({ ...row });
          }
          return Promise.resolve({ error: err });
        },
        eq: (k: string, v: unknown) => {
          filters.push([k, v]);
          return b;
        },
        order: () => b,
        limit: () => b,
        maybeSingle: () => {
          const r = run();
          return Promise.resolve({ data: r.rows[0] ?? null, error: r.error });
        },
        single: () => {
          const r = run();
          return Promise.resolve({ data: r.rows[0] ?? null, error: r.error });
        },
        // deno-lint-ignore no-explicit-any
        then: (res: any, rej: any) => {
          const r = run();
          return Promise.resolve({ data: r.rows, error: r.error }).then(res, rej);
        },
      };
      return b;
    },
  };
}

function makeDeps(over: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const posts: { path: string; body: Row }[] = [];
  const pdfCalls: string[] = [];
  const asked: string[] = [];
  const log = { tables: [] as string[], saved: [] as unknown[], conflicts: [] as unknown[] };
  const tables: Record<string, Row[]> = {
    client_master: [{ client_id: "c1" }, { client_id: "CL000001" }, { client_id: "CL000002" }],
    banking_clients: [
      { id: "bc1", client_master_id: "CL000002" },
      { id: "bc2", client_master_id: null },
      { id: "bc3", client_master_id: "c1" },
    ],
    banking_cases: [{ id: "case1", client_id: "bc1" }, { id: "case2", client_id: "bc2" }],
    zoho_contact_links: [
      { client_id: "CL000001", zoho_contact_id: "11", zoho_contact_name: "Acme LLC" },
      { client_id: "CL000002", zoho_contact_id: "11", zoho_contact_name: "Acme LLC" },
    ],
    hub_documents: [{
      id: "h1",
      doc_type: "quote",
      department: "Business Setup",
      client_id: "CL000001",
      document_number: "Q-1",
      status: "issued",
      total_amount: 105,
      vat_mode: "inclusive",
      lines: [{ service_name: "Setup", amount: 105 }],
      revises_id: null,
    }],
    banking_quotations: [{
      id: "b1",
      case_id: "case1",
      quotation_number: "BQ-1",
      version: 1,
      status: "Accepted",
      vat_mode: "inclusive",
      total_amount: 205,
      bank_fee_total: 100,
      direct_to_bank_total: 0,
      service_fee_total: 105,
      supplementary_total: 0,
      discount_total: 0,
      supersedes_id: null,
    }],
    zoho_documents: [],
  };
  if (over.link) tables.zoho_contact_links.push({ client_id: "c1", ...(over.link as Row) });
  const errors: Record<string, unknown> = {};
  if (over.dbError) errors["zoho_contact_links.upsert"] = over.dbError;
  if (over.readError) errors["zoho_contact_links.select"] = over.readError;
  const replies: Record<string, unknown> = {
    "/organizations": { organizations: [{ organization_id: "ORG1", name: "Acme Trading LLC" }] },
    "/settings/taxes": { taxes: [{ tax_id: "1", tax_name: "VAT", tax_percentage: 5 }] },
    "/contacts": { contacts: [{ contact_id: "11", contact_name: "Acme", tax_reg_no: "100", currency_code: "AED", extra: "x" }] },
    "/contacts/11": { contact: { contact_id: "11", contact_name: "Acme LLC", currency_code: "AED" } },
    "/contacts/22": { contact: { contact_id: "22", contact_name: "Dollar Co", currency_code: "USD" } },
    "/estimates": { estimates: [] },
    "/invoices": { invoices: [] },
  };
  const state = {
    postImpl: (path: string): Promise<unknown> =>
      Promise.resolve(
        path === "/invoices"
          ? { invoice: { invoice_id: "9001", invoice_number: "INV-0001", total: 105, status: "draft" } }
          : { estimate: { estimate_id: "7001", estimate_number: "EST-0001", total: 105, status: "draft" } },
      ),
    pdfImpl: (_path: string): Promise<Uint8Array> => Promise.resolve(new TextEncoder().encode("%PDF-1.4 fake")),
    now: new Date("2026-11-03T00:00:00Z"),
  };
  const { link: _l, dbError: _d, readError: _r, ...rest } = over;
  const deps = {
    isAdmin: () => Promise.resolve(true),
    can: (_d: string, p: string) => {
      asked.push(p);
      return Promise.resolve(true);
    },
    db: fakeDb(tables, log, errors),
    zoho: () =>
      Promise.resolve({
        orgId: "ORG1",
        dc: "ae",
        get: (path: string, query?: Record<string, string>) => {
          calls.push({ path, query });
          const r = replies[path];
          return Promise.resolve(typeof r === "function" ? r(query) : r);
        },
        getPdf: (path: string) => {
          pdfCalls.push(path);
          return state.pdfImpl(path);
        },
        post: (path: string, body: Row) => {
          posts.push({ path, body });
          return state.postImpl(path);
        },
      }),
    vatTaxId: () => Promise.resolve("TAX5"),
    userId: "user-1",
    now: () => state.now,
    ...rest,
  };
  const { saved, tables: touched, conflicts } = log;
  // deno-lint-ignore no-explicit-any
  return { deps: deps as any, calls, posts, pdfCalls, saved, asked, tables: touched, conflicts, replies, db: tables, state, errors };
}

Deno.test("connection_test and taxes_list are admin only", async () => {
  const { deps } = makeDeps({ isAdmin: () => Promise.resolve(false) });
  await assertRejects(() => handle("connection_test", {}, deps), UserError, "Only a CRM admin");
  await assertRejects(() => handle("taxes_list", {}, deps), UserError, "Only a CRM admin");
});

Deno.test("connection_test succeeds when the org is returned", async () => {
  const { deps } = makeDeps();
  assertEquals(await handle("connection_test", {}, deps), { connected: true, organisation: "Acme Trading LLC" });
});

Deno.test("connection_test fails when the org is not returned", async () => {
  const { deps, replies } = makeDeps();
  replies["/organizations"] = { organizations: [{ organization_id: "OTHER" }] };
  const r = await handle("connection_test", {}, deps) as { connected: boolean; message: string };
  assertEquals(r.connected, false);
  assertEquals(r.message.includes("ZOHO_BOOKS_ORG_ID"), true);
  assertEquals(r.message.includes("ORG1"), false);
  assertEquals(r.message.includes("OTHER"), false);
});

Deno.test("taxes_list returns the taxes", async () => {
  const { deps } = makeDeps();
  const r = await handle("taxes_list", {}, deps) as { taxes: unknown[] };
  assertEquals(r.taxes.length, 1);
});

Deno.test("contacts_search needs the department permission", async () => {
  const no = makeDeps({ can: () => Promise.resolve(false) });
  await assertRejects(
    () => handle("contacts_search", { query: "ac", department: "business_setup" }, no.deps),
    UserError,
    "permission",
  );
  assertEquals(no.calls.length, 0);

  const bs = makeDeps();
  await handle("contacts_search", { query: "ac", department: "business_setup" }, bs.deps);
  assertEquals(bs.asked, ["setup.quotes.manage"]);

  const bk = makeDeps();
  await handle("contacts_search", { query: "ac", department: "banking" }, bk.deps);
  assertEquals(bk.asked, ["cases.manage"]);
});

Deno.test("contacts_search trims, refuses empty, and returns only the listed fields", async () => {
  const { deps, calls } = makeDeps();
  await assertRejects(() => handle("contacts_search", { query: "   ", department: "banking" }, deps), UserError);
  const r = await handle("contacts_search", { query: "  ac ", department: "banking" }, deps) as {
    contacts: Record<string, unknown>[];
  };
  assertEquals(calls[0].query, { contact_name_contains: "ac" });
  assertEquals(r.contacts, [{ id: "11", name: "Acme", tax_reg_no: "100", currency_code: "AED" }]);
});

Deno.test("an unknown department is refused", async () => {
  const { deps } = makeDeps();
  await assertRejects(() => handle("contacts_search", { query: "ac", department: "sales" }, deps), UserError, "department");
  await assertRejects(() => handle("contact_get", { client_id: "c1", department: "sales" }, deps), UserError, "department");
});

Deno.test("contact_link saves the name Zoho returns, not one from the browser", async () => {
  const { deps, saved, tables, conflicts } = makeDeps();
  await handle(
    "contact_link",
    { client_id: "c1", zoho_contact_id: "11", department: "banking", zoho_contact_name: "Fake" },
    deps,
  );
  assertEquals(saved.length, 1);
  const row = saved[0] as Record<string, unknown>;
  assertEquals(row.zoho_contact_name, "Acme LLC");
  assertEquals(row.zoho_contact_id, "11");
  assertEquals(row.client_id, "c1");
  assertEquals(row.linked_by, "user-1");
  assertEquals(tables.includes("zoho_contact_links"), true);
  assertEquals(conflicts, [{ onConflict: "client_id" }]);
});

Deno.test("contact_link maps a missing client to a plain message", async () => {
  const fk = { code: "23503", message: 'insert violates foreign key constraint "zoho_contact_links_client_id_fkey"' };
  const { deps } = makeDeps({ dbError: fk });
  await assertRejects(
    () => handle("contact_link", { client_id: "CL000002", zoho_contact_id: "11", department: "banking" }, deps),
    UserError,
    "That client was not found.",
  );
});

Deno.test("other database errors reach the caller as plain text only", async () => {
  const pg = { code: "XX000", message: 'relation "zoho_contact_links" constraint "secret_name" broke' };
  const quiet = console.error;
  console.error = () => {};
  try {
    for (
      const [fn, args, msg, over] of [
        ["contact_link", { client_id: "c1", zoho_contact_id: "11", department: "banking" }, "Could not save the Zoho link.", { dbError: pg }],
        ["contact_link", { client_id: "c1", zoho_contact_id: "11", department: "banking" }, "Could not read the Zoho link.", { readError: pg }],
        ["contact_get", { client_id: "c1", department: "banking" }, "Could not read the Zoho link.", { readError: pg }],
      ] as const
    ) {
      const { deps } = makeDeps(over);
      const e = await assertRejects(() => handle(fn, args, deps), UserError, msg);
      assertEquals(e.message.includes("zoho_contact_links"), false);
      assertEquals(e.message.includes("secret_name"), false);
    }
  } finally {
    console.error = quiet;
  }
});

Deno.test("contact_link refuses a Zoho contact with no name", async () => {
  const { deps, saved, replies } = makeDeps();
  replies["/contacts/11"] = { contact: { contact_id: "11", contact_name: "  ", currency_code: "AED" } };
  await assertRejects(
    () => handle("contact_link", { client_id: "c1", zoho_contact_id: "11", department: "banking" }, deps),
    UserError,
    "That Zoho contact has no name. Add one in Zoho first.",
  );
  assertEquals(saved.length, 0);
});

Deno.test("contact_link refuses a non-AED contact", async () => {
  const { deps, saved } = makeDeps();
  await assertRejects(
    () => handle("contact_link", { client_id: "c1", zoho_contact_id: "22", department: "banking" }, deps),
    UserError,
    "Only a Zoho contact billed in AED can be linked, because CRM amounts are in AED.",
  );
  assertEquals(saved.length, 0);
});

Deno.test("contact_link needs the manage permission and a numeric Zoho id", async () => {
  const no = makeDeps({ can: () => Promise.resolve(false) });
  await assertRejects(
    () => handle("contact_link", { client_id: "c1", zoho_contact_id: "11", department: "banking" }, no.deps),
    UserError,
    "permission",
  );
  assertEquals(no.calls.length, 0);
  assertEquals(no.saved.length, 0);
  const { deps, saved } = makeDeps();
  await assertRejects(
    () => handle("contact_link", { client_id: "c1", zoho_contact_id: "../x", department: "banking" }, deps),
    UserError,
  );
  assertEquals(saved.length, 0);
});

Deno.test("contact_get needs a view permission", async () => {
  const no = makeDeps({ can: () => Promise.resolve(false) });
  await assertRejects(
    () => handle("contact_get", { client_id: "c1", department: "banking" }, no.deps),
    UserError,
    "permission",
  );
  assertEquals(no.calls.length, 0);
  assertEquals(no.tables.length, 0);

  const bs = makeDeps();
  await handle("contact_get", { client_id: "c1", department: "business_setup" }, bs.deps);
  assertEquals(bs.asked, ["setup.access"]);
  const bk = makeDeps();
  await handle("contact_get", { client_id: "c1", department: "banking" }, bk.deps);
  assertEquals(bk.asked, ["cases.view"]);
});

Deno.test("contact_get returns the link or linked:false", async () => {
  const none = makeDeps();
  assertEquals(await handle("contact_get", { client_id: "c1", department: "banking" }, none.deps), { linked: false });
  const some = makeDeps({ link: { zoho_contact_id: "11", zoho_contact_name: "Acme LLC" } });
  assertEquals(await handle("contact_get", { client_id: "c1", department: "banking" }, some.deps), {
    linked: true,
    zoho_contact_id: "11",
    zoho_contact_name: "Acme LLC",
  });
});

Deno.test("missing credentials report connected:false", async () => {
  const { deps } = makeDeps({ zoho: () => Promise.reject(new MissingSecretError("ZOHO_CLIENT_ID")) });
  const r = await handle("connection_test", {}, deps) as { connected: boolean; message: string };
  assertEquals(r.connected, false);
  assertEquals(typeof r.message, "string");
});

Deno.test("an unknown action is refused", async () => {
  const { deps } = makeDeps();
  await assertRejects(() => handle("nope", {}, deps), UserError, "Unknown action");
});

Deno.test("permissionCheck fails closed", async () => {
  const ok = (_n: string, _a: { p_permission: string }) => Promise.resolve({ data: true, error: null });
  assertEquals(await permissionCheck(ok, "banking", "cases.view"), true);

  const calls: string[] = [];
  const spy = (n: string, a: { p_permission: string }) => {
    calls.push(n + ":" + a.p_permission);
    return Promise.resolve({ data: true, error: null });
  };
  await permissionCheck(spy, "business_setup", "setup.access");
  await permissionCheck(spy, "banking", "cases.manage");
  assertEquals(calls, ["business_setup_can:setup.access", "banking_can:cases.manage"]);

  const missing = () => Promise.resolve({ data: null, error: { message: "function does not exist" } });
  assertEquals(await permissionCheck(missing, "business_setup", "setup.access"), false);
  const falsy = () => Promise.resolve({ data: false, error: null });
  assertEquals(await permissionCheck(falsy, "banking", "cases.view"), false);
  const notTrue = () => Promise.resolve({ data: "yes", error: null });
  assertEquals(await permissionCheck(notTrue, "banking", "cases.view"), false);
  const throws = () => Promise.reject(new Error("boom"));
  assertEquals(await permissionCheck(throws, "banking", "cases.view"), false);
  assertEquals(await permissionCheck(ok, "sales", "x"), false);
});

Deno.test("browserMessage gives fixed text and never raw detail", () => {
  const raw = "fake-client-secret raw zoho text";
  assertEquals(browserMessage(new ZohoAccessError(raw)), "Zoho access has stopped. An admin must reconnect.");
  assertEquals(browserMessage(new ZohoHttpError(429, raw)), "Zoho is busy, try again shortly.");
  assertEquals(browserMessage(new ZohoHttpError(500, raw)), "Zoho refused the request.");
  assertEquals(browserMessage(new ZohoHttpError(404, raw, 1002)), "Zoho refused the request.");
  assertEquals(browserMessage(new Error(raw)), "Something went wrong talking to Zoho.");
  assertEquals(browserMessage("odd"), "Something went wrong talking to Zoho.");
  for (const e of [new ZohoAccessError(raw), new ZohoHttpError(500, raw), new Error(raw)]) {
    const m = browserMessage(e);
    assertEquals(m.includes("secret") || m.includes("raw"), false);
  }
});

// ---- contact_link ownership and overwrite ----

Deno.test("contact_link in Banking needs a Banking client with that Client Master id", async () => {
  const { deps, saved } = makeDeps();
  await assertRejects(
    () => handle("contact_link", { client_id: "CL000001", zoho_contact_id: "11", department: "banking" }, deps),
    UserError,
    "This client is not in Business Banking.",
  );
  assertEquals(saved.length, 0);
});

Deno.test("contact_link in Business Setup needs a Client Master row", async () => {
  const { deps, saved } = makeDeps();
  await assertRejects(
    () => handle("contact_link", { client_id: "CL999999", zoho_contact_id: "11", department: "business_setup" }, deps),
    UserError,
    "That client was not found.",
  );
  assertEquals(saved.length, 0);
});

Deno.test("contact_link asks before replacing a different link, and saves nothing", async () => {
  const { deps, saved, calls } = makeDeps({ link: { zoho_contact_id: "99", zoho_contact_name: "Old Co" } });
  const r = await handle("contact_link", { client_id: "c1", zoho_contact_id: "11", department: "business_setup" }, deps);
  assertEquals(r, { needs_replace: true, current_name: "Old Co" });
  assertEquals(saved.length, 0);
  assertEquals(calls.length, 0);
});

Deno.test("contact_link replaces when replace is true, and re-saving the same contact needs no replace", async () => {
  const a = makeDeps({ link: { zoho_contact_id: "99", zoho_contact_name: "Old Co" } });
  const r = await handle("contact_link", { client_id: "c1", zoho_contact_id: "11", department: "business_setup", replace: true }, a.deps);
  assertEquals(r, { ok: true, zoho_contact_id: "11", zoho_contact_name: "Acme LLC" });
  assertEquals(a.saved.length, 1);
  const b = makeDeps({ link: { zoho_contact_id: "11", zoho_contact_name: "Acme LLC" } });
  assertEquals((await handle("contact_link", { client_id: "c1", zoho_contact_id: "11", department: "business_setup" }, b.deps) as Row).ok, true);
});

// ---- document_create ----

const hub = { source_table: "hub_documents", source_id: "h1", kind: "estimate" };
const bank = { source_table: "banking_quotations", source_id: "b1", kind: "estimate" };
const ref = (r: unknown) => r as Row;
const estimateReply = (total = 105) => ({ estimate: { estimate_id: "7001", estimate_number: "EST-0001", total, status: "draft" } });

Deno.test("Business Setup estimate needs setup.quotes.manage, invoice needs setup.services.manage, Banking needs cases.manage", async () => {
  const a = makeDeps();
  await handle("document_create", hub, a.deps);
  assertEquals(a.asked, ["setup.quotes.manage"]);
  const b = makeDeps();
  b.db.hub_documents[0].status = "accepted";
  await handle("document_create", { ...hub, kind: "invoice" }, b.deps);
  assertEquals(b.asked, ["setup.services.manage"]);
  const c = makeDeps();
  await handle("document_create", bank, c.deps);
  assertEquals(c.asked, ["cases.manage"]);
  const d = makeDeps();
  await handle("document_create", { ...bank, kind: "invoice" }, d.deps);
  assertEquals(d.asked, ["cases.manage"]);
});

Deno.test("without permission nothing is read or sent", async () => {
  const { deps, calls, posts, tables } = makeDeps({ can: () => Promise.resolve(false) });
  await assertRejects(() => handle("document_create", hub, deps), UserError, "permission");
  assertEquals([calls.length, posts.length, tables.length], [0, 0, 0]);
});

Deno.test("unknown source_table or kind is refused", async () => {
  const { deps, posts } = makeDeps();
  await assertRejects(() => handle("document_create", { ...hub, source_table: "profiles" }, deps), UserError);
  await assertRejects(() => handle("document_create", { ...hub, kind: "credit_note" }, deps), UserError);
  await assertRejects(() => handle("document_create", { ...hub, source_id: "" }, deps), UserError);
  assertEquals(posts.length, 0);
});

Deno.test("a hub row must be a quote of Business Setup", async () => {
  const a = makeDeps();
  a.db.hub_documents[0].doc_type = "letter";
  await assertRejects(() => handle("document_create", hub, a.deps), UserError, "quote");
  const b = makeDeps();
  b.db.hub_documents[0].department = "Banking";
  await assertRejects(() => handle("document_create", hub, b.deps), UserError, "Business Setup");
  const c = makeDeps();
  await assertRejects(() => handle("document_create", { ...hub, source_id: "nope" }, c.deps), UserError, "not found");
  for (const x of [a, b, c]) assertEquals([x.posts.length, x.db.zoho_documents.length], [0, 0]);
});

Deno.test("amounts come from the stored row, not the browser", async () => {
  const { deps, posts } = makeDeps();
  await handle("document_create", { ...hub, total_amount: 1, lines: [{ amount: 1 }], department: "banking" }, deps);
  const items = posts[0].body.line_items as Row[];
  assertEquals(items[0].rate, 105);
  assertEquals(posts[0].body.reference_number, "Q-1");
  assertEquals(posts[0].body.customer_id, "11");
  assertEquals(posts[0].body.date, "2026-11-03");
});

Deno.test("no contact link returns needs_contact and calls nothing", async () => {
  const { deps, calls, posts, db } = makeDeps();
  db.zoho_contact_links.length = 0;
  assertEquals(await handle("document_create", hub, deps), { needs_contact: true });
  assertEquals([calls.length, posts.length, db.zoho_documents.length], [0, 0, 0]);
});

Deno.test("a banking client with no client_master_id says so", async () => {
  const { deps, posts, db } = makeDeps();
  db.banking_quotations.push({ ...db.banking_quotations[0], id: "b2", case_id: "case2" });
  await assertRejects(
    () => handle("document_create", { ...bank, source_id: "b2" }, deps),
    UserError,
    "no Client Master record",
  );
  assertEquals([posts.length, db.zoho_documents.length], [0, 0]);
});

Deno.test("a quote that cannot be sent is refused before any row is written", async () => {
  const { deps, posts, db } = makeDeps();
  db.hub_documents[0].status = "draft";
  await assertRejects(() => handle("document_create", hub, deps), UserError, "issued, sent or accepted");
  assertEquals([posts.length, db.zoho_documents.length], [0, 0]);
});

Deno.test("a missing VAT code is refused before any row is written", async () => {
  const { deps, posts, calls, db } = makeDeps({ vatTaxId: () => Promise.resolve(null) });
  await assertRejects(() => handle("document_create", hub, deps), UserError, "Pick the 5% VAT code in Settings first.");
  assertEquals([posts.length, calls.length, db.zoho_documents.length], [0, 0, 0]);
});

Deno.test("the row is written as creating before the POST", async () => {
  const m = makeDeps();
  let seen: Row | undefined;
  m.state.postImpl = () => {
    seen = { ...m.db.zoho_documents[0] };
    return Promise.resolve(estimateReply());
  };
  const r = ref(await handle("document_create", hub, m.deps));
  assertEquals(seen?.state, "creating");
  assertEquals(seen?.reference, "Q-1");
  assertEquals(seen?.crm_total, 105);
  assertEquals(seen?.created_by, "user-1");
  const row = m.db.zoho_documents[0];
  assertEquals([row.state, row.zoho_id, row.zoho_number, row.zoho_status, row.total, row.crm_total], ["created", "7001", "EST-0001", "draft", 105, 105]);
  assertEquals(r, {
    state: "created",
    zoho_id: "7001",
    zoho_number: "EST-0001",
    total_warning: false,
    earlier_draft: null,
    url: "https://books.zoho.ae/app/ORG1#/quotes/7001",
  });
});

Deno.test("the invoice link uses invoices, and the POST never carries send", async () => {
  const m = makeDeps();
  m.db.hub_documents[0].status = "accepted";
  const r = ref(await handle("document_create", { ...hub, kind: "invoice" }, m.deps));
  assertEquals(m.posts[0].path, "/invoices");
  assertEquals("send" in m.posts[0].body, false);
  assertEquals(r.url, "https://books.zoho.ae/app/ORG1#/invoices/9001");
});

Deno.test("a match on reference_number is adopted with no POST", async () => {
  const m = makeDeps();
  m.replies["/estimates"] = {
    estimates: [
      { estimate_id: "1", estimate_number: "EST-9", reference_number: "Q-1-OTHER", customer_id: "11", total: 105, status: "draft" },
      { estimate_id: "2", estimate_number: "EST-8", reference_number: "Q-1", customer_id: "55", total: 105, status: "draft" },
      { estimate_id: "7001", estimate_number: "EST-0001", reference_number: "Q-1", customer_id: "11", total: 105, status: "sent" },
    ],
  };
  const r = ref(await handle("document_create", hub, m.deps));
  assertEquals(m.posts.length, 0);
  assertEquals(m.calls[0], { path: "/estimates", query: { reference_number: "Q-1" } });
  assertEquals([r.state, r.zoho_id, r.zoho_number, r.adopted_count], ["created", "7001", "EST-0001", 1]);
  assertEquals(m.db.zoho_documents[0].zoho_status, "sent");
});

Deno.test("several exact matches: the newest is adopted and the count returned", async () => {
  const m = makeDeps();
  const e = (id: string, created: string) => ({
    estimate_id: id, estimate_number: `EST-${id}`, reference_number: "Q-1", customer_id: "11", total: 105, status: "draft", created_time: created,
  });
  m.replies["/estimates"] = { estimates: [e("1", "2026-11-01T08:00:00+0400"), e("3", "2026-11-03T08:00:00+0400"), e("2", "2026-11-02T08:00:00+0400")] };
  const r = ref(await handle("document_create", hub, m.deps));
  assertEquals([r.zoho_id, r.adopted_count, m.posts.length], ["3", 3, 0]);
});

Deno.test("a double press: unique violation returns the existing row, one POST only", async () => {
  const m = makeDeps();
  const [a, b] = await Promise.all([handle("document_create", hub, m.deps), handle("document_create", hub, m.deps)]);
  assertEquals(m.posts.length, 1);
  assertEquals(m.db.zoho_documents.length, 1);
  assertEquals([ref(a).state, ["creating", "created"].includes(ref(b).state)], ["created", true]);
});

Deno.test("an existing created row is returned with no Zoho request", async () => {
  const m = makeDeps();
  await handle("document_create", hub, m.deps);
  const before = [m.calls.length, m.posts.length];
  const r = ref(await handle("document_create", hub, m.deps));
  assertEquals([m.calls.length, m.posts.length], before);
  assertEquals([r.state, r.zoho_number], ["created", "EST-0001"]);
});

Deno.test("a fresh creating row says it is being created; an old one counts as unknown", async () => {
  const m = makeDeps();
  const seed = { source_table: "hub_documents", source_id: "h1", kind: "estimate", state: "creating", reference: "Q-1" };
  m.db.zoho_documents.push({ id: "r1", ...seed, created_at: "2026-11-02T23:59:00.000Z" });
  await assertRejects(() => handle("document_create", hub, m.deps), UserError, "This draft is already being created. Try again in a moment.");
  assertEquals(m.posts.length, 0);
  m.db.zoho_documents[0].created_at = "2026-11-02T23:57:00.000Z";
  const r = ref(await handle("document_create", hub, m.deps));
  assertEquals(m.calls[0].path, "/estimates");
  assertEquals([r.state, m.posts.length, m.db.zoho_documents.length], ["created", 1, 1]);
});

Deno.test("a timeout after POST sets unknown; retry searches first and adopts", async () => {
  const m = makeDeps();
  m.state.postImpl = () => Promise.reject(new ZohoTimeoutError());
  const r = ref(await handle("document_create", hub, m.deps));
  assertEquals(r.state, "unknown");
  assertEquals(typeof r.error, "string");
  assertEquals(m.db.zoho_documents[0].state, "unknown");
  // Zoho did create it.
  m.state.now = new Date("2026-11-03T00:03:00Z");
  m.replies["/estimates"] = {
    estimates: [{ estimate_id: "7001", estimate_number: "EST-0001", reference_number: "Q-1", customer_id: "11", total: 105, status: "draft" }],
  };
  const r2 = ref(await handle("document_create", hub, m.deps));
  assertEquals([r2.state, r2.zoho_id, m.posts.length, m.db.zoho_documents.length], ["created", "7001", 1, 1]);
});

Deno.test("a network failure after POST also sets unknown", async () => {
  const m = makeDeps();
  m.state.postImpl = () => Promise.reject(new TypeError("connection reset by https://secret.example"));
  const quiet = console.error;
  console.error = () => {};
  try {
    const r = ref(await handle("document_create", hub, m.deps));
    assertEquals(r.state, "unknown");
    assertEquals(JSON.stringify(r).includes("secret.example"), false);
    assertEquals(m.db.zoho_documents[0].error.includes("secret.example"), false);
  } finally {
    console.error = quiet;
  }
});

Deno.test("a Zoho validation error sets failed with Zoho's message, and retry reuses the row", async () => {
  const m = makeDeps();
  m.state.postImpl = () => Promise.reject(new ZohoHttpError(400, "Customer is inactive.", 1001));
  const r = ref(await handle("document_create", hub, m.deps));
  assertEquals([r.state, r.error], ["failed", "Customer is inactive."]);
  assertEquals([m.db.zoho_documents[0].state, m.db.zoho_documents[0].error], ["failed", "Customer is inactive."]);
  m.state.postImpl = () => Promise.resolve(estimateReply());
  const r2 = ref(await handle("document_create", hub, m.deps));
  assertEquals([r2.state, m.db.zoho_documents.length, m.posts.length, m.db.zoho_documents[0].error], ["created", 1, 2, null]);
});

Deno.test("429 says Zoho is busy and leaves the row retryable", async () => {
  const m = makeDeps();
  m.state.postImpl = () => Promise.reject(new ZohoHttpError(429, "Too many requests"));
  const r = ref(await handle("document_create", hub, m.deps));
  assertEquals([r.state, r.error], ["failed", "Zoho is busy, try again shortly."]);
  assertEquals(m.db.zoho_documents[0].state, "failed");
  m.state.postImpl = () => Promise.resolve(estimateReply());
  assertEquals(ref(await handle("document_create", hub, m.deps)).state, "created");
});

Deno.test("lost Zoho access sets failed with the reconnect message", async () => {
  const m = makeDeps();
  m.state.postImpl = () => Promise.reject(new ZohoAccessError("invalid_code client-secret"));
  const quiet = console.error;
  console.error = () => {};
  try {
    const r = ref(await handle("document_create", hub, m.deps));
    assertEquals([r.state, r.error], ["failed", "Zoho access has stopped. An admin must reconnect."]);
  } finally {
    console.error = quiet;
  }
});

Deno.test("a failed search before the POST sets failed and sends nothing", async () => {
  const m = makeDeps();
  m.deps.zoho = () =>
    Promise.resolve({
      orgId: "ORG1",
      dc: "ae",
      get: () => Promise.reject(new ZohoTimeoutError()),
      post: () => {
        m.posts.push({ path: "x", body: {} });
        return Promise.resolve({});
      },
    });
  const r = ref(await handle("document_create", hub, m.deps));
  assertEquals([r.state, m.posts.length, m.db.zoho_documents[0].state], ["failed", 0, "failed"]);
});

Deno.test("a retry on gone creates again and never adopts the deleted one", async () => {
  const m = makeDeps();
  m.db.zoho_documents.push({
    id: "r1", source_table: "hub_documents", source_id: "h1", kind: "estimate", reference: "Q-1",
    state: "gone", zoho_id: "7001", zoho_number: "EST-0001", created_at: "2026-11-01T00:00:00.000Z",
  });
  m.replies["/estimates"] = {
    estimates: [{ estimate_id: "7001", estimate_number: "EST-0001", reference_number: "Q-1", customer_id: "11", total: 105, status: "draft" }],
  };
  m.state.postImpl = () => Promise.resolve({ estimate: { estimate_id: "7002", estimate_number: "EST-0002", total: 105, status: "draft" } });
  const r = ref(await handle("document_create", hub, m.deps));
  assertEquals([r.state, r.zoho_id, m.posts.length, m.db.zoho_documents.length], ["created", "7002", 1, 1]);
});

Deno.test("a total difference returns total_warning and keeps created", async () => {
  const m = makeDeps();
  m.state.postImpl = () => Promise.resolve(estimateReply(110));
  const r = ref(await handle("document_create", hub, m.deps));
  assertEquals([r.state, r.total_warning], ["created", true]);
  assertEquals([m.db.zoho_documents[0].crm_total, m.db.zoho_documents[0].total], [105, 110]);
  // One cent of rounding is not a warning.
  const n = makeDeps();
  n.state.postImpl = () => Promise.resolve(estimateReply(105.01));
  assertEquals(ref(await handle("document_create", hub, n.deps)).total_warning, false);
});

Deno.test("a revised quote reports the earlier draft's number", async () => {
  const m = makeDeps();
  m.db.hub_documents.push(
    { ...m.db.hub_documents[0], id: "h0", document_number: "Q-0", revises_id: null },
    { ...m.db.hub_documents[0], id: "hm", document_number: "Q-0b", revises_id: "h0" },
  );
  m.db.hub_documents[0].revises_id = "hm";
  m.db.zoho_documents.push(
    { id: "z0", source_table: "hub_documents", source_id: "h0", kind: "estimate", state: "created", zoho_number: "EST-0000" },
    { id: "z0i", source_table: "hub_documents", source_id: "h0", kind: "invoice", state: "created", zoho_number: "INV-0000" },
  );
  assertEquals(ref(await handle("document_create", hub, m.deps)).earlier_draft, "EST-0000");
  // A gone ancestor draft has nothing in Zoho to point to.
  m.db.zoho_documents[0].state = "gone";
  m.db.zoho_documents.splice(2, 1);
  assertEquals(ref(await handle("document_create", { ...hub, source_id: "hm" }, m.deps)).earlier_draft, null);
});

Deno.test("a revised Banking quote follows supersedes_id", async () => {
  const m = makeDeps();
  m.db.banking_quotations.push({ ...m.db.banking_quotations[0], id: "b0", quotation_number: "BQ-0" });
  m.db.banking_quotations[0].supersedes_id = "b0";
  m.db.zoho_documents.push({ id: "z0", source_table: "banking_quotations", source_id: "b0", kind: "estimate", state: "created", zoho_number: "EST-0100" });
  assertEquals(ref(await handle("document_create", bank, m.deps)).earlier_draft, "EST-0100");
});

Deno.test("an ancestor loop does not hang", async () => {
  const m = makeDeps();
  m.db.hub_documents[0].revises_id = "h1";
  assertEquals(ref(await handle("document_create", hub, m.deps)).earlier_draft, null);
});

const doc = (id: string, over: Row = {}) => ({
  estimate_id: id, estimate_number: `EST-${id}`, reference_number: "Q-1", customer_id: "11", total: 105, status: "draft", ...over,
});
const quiet = async (fn: () => Promise<void>) => {
  const was = console.error;
  console.error = () => {};
  try {
    await fn();
  } finally {
    console.error = was;
  }
};

Deno.test("a secret inside a failure never reaches the response", async () => {
  const m = makeDeps();
  m.deps.zoho = () =>
    Promise.resolve({ orgId: "ORG1", dc: "ae", get: () => Promise.reject(new TypeError("bad host fake-secret-value")), post: () => Promise.resolve({}) });
  await quiet(async () => {
    const r = await handle("document_create", hub, m.deps);
    assertEquals(JSON.stringify(r).includes("fake-secret-value"), false);
    assertEquals(String(m.db.zoho_documents[0].error).includes("fake-secret-value"), false);
  });
});

Deno.test("the search sends the reference number", async () => {
  const m = makeDeps();
  let seen: Record<string, string> | undefined;
  m.replies["/estimates"] = (q: Record<string, string>) => {
    seen = q;
    return { estimates: [] };
  };
  await handle("document_create", hub, m.deps);
  assertEquals(seen, { reference_number: "Q-1" });
});

Deno.test("a revised Banking quote with the same number is not mistaken for the first one", async () => {
  const m = makeDeps();
  m.db.banking_quotations.push({ ...m.db.banking_quotations[0], id: "b1v2", version: 2, supersedes_id: "b1" });
  await handle("document_create", bank, m.deps);
  assertEquals(m.posts[0].body.reference_number, "BQ-1");
  m.replies["/estimates"] = (q: Record<string, string>) => ({
    estimates: q.reference_number === "BQ-1" ? [doc("7001", { reference_number: "BQ-1" })] : [],
  });
  m.state.postImpl = () => Promise.resolve({ estimate: { estimate_id: "7002", estimate_number: "EST-0002", total: 205, status: "draft" } });
  const r = ref(await handle("document_create", { ...bank, source_id: "b1v2" }, m.deps));
  assertEquals(m.posts[1].body.reference_number, "BQ-1 v2");
  assertEquals([r.zoho_id, r.zoho_number, r.earlier_draft], ["7002", "EST-0002", "EST-0001"]);
});

Deno.test("a Zoho draft another CRM row already holds is not adopted", async () => {
  const m = makeDeps();
  m.db.zoho_documents.push({ id: "other", source_table: "banking_quotations", source_id: "x", kind: "estimate", state: "created", zoho_id: "7001" });
  m.replies["/estimates"] = { estimates: [doc("7001")] };
  m.state.postImpl = () => Promise.resolve({ estimate: { estimate_id: "7002", estimate_number: "EST-0002", total: 105, status: "draft" } });
  const r = ref(await handle("document_create", hub, m.deps));
  assertEquals([r.zoho_id, m.posts.length], ["7002", 1]);
});

Deno.test("a voided, declined or expired match is not adopted", async () => {
  for (const status of ["void", "VOID", "declined", "Expired"]) {
    const m = makeDeps();
    m.replies["/estimates"] = { estimates: [doc("7001", { status })] };
    const r = ref(await handle("document_create", hub, m.deps));
    assertEquals([m.posts.length, r.adopted_count], [1, undefined]);
  }
});

Deno.test("an immediate retry after a POST timeout waits and calls nothing", async () => {
  const m = makeDeps();
  m.state.postImpl = () => Promise.reject(new ZohoTimeoutError());
  await quiet(async () => {
    await handle("document_create", hub, m.deps);
    const gets = m.calls.length;
    m.state.now = new Date("2026-11-03T00:01:00Z");
    await assertRejects(() => handle("document_create", hub, m.deps), UserError, "Check again in 2 minutes.");
    assertEquals([m.calls.length, m.posts.length], [gets, 1]);
    m.state.now = new Date("2026-11-03T00:02:30Z");
    await handle("document_create", hub, m.deps);
    assertEquals(m.calls.length, gets + 1);
  });
});

Deno.test("the wait counts from the timeout, not from the start of the attempt", async () => {
  const m = makeDeps();
  m.state.postImpl = () => {
    m.state.now = new Date("2026-11-03T00:00:40Z");
    return Promise.reject(new ZohoTimeoutError());
  };
  await quiet(async () => {
    await handle("document_create", hub, m.deps);
    m.state.now = new Date("2026-11-03T00:02:30Z");
    await assertRejects(() => handle("document_create", hub, m.deps), UserError, "2 minutes");
  });
});

Deno.test("a failed search on a row that was unknown keeps it unknown and keeps its wait", async () => {
  const m = makeDeps();
  m.db.zoho_documents.push({
    id: "r1", source_table: "hub_documents", source_id: "h1", kind: "estimate", reference: "Q-1",
    state: "unknown", created_at: "2026-11-02T23:50:00.000Z",
  });
  m.deps.zoho = () => Promise.resolve({ orgId: "ORG1", dc: "ae", get: () => Promise.reject(new ZohoTimeoutError()), post: () => Promise.resolve({}) });
  await quiet(async () => {
    const r = ref(await handle("document_create", hub, m.deps));
    assertEquals(r.state, "unknown");
  });
  assertEquals([m.db.zoho_documents[0].state, m.db.zoho_documents[0].created_at], ["unknown", "2026-11-02T23:50:00.000Z"]);
});

Deno.test("a POST 5xx sets unknown, but a 4xx sets failed", async () => {
  const m = makeDeps();
  m.state.postImpl = () => Promise.reject(new ZohoHttpError(502, "Bad gateway"));
  await quiet(async () => {
    const r = ref(await handle("document_create", hub, m.deps));
    assertEquals([r.state, m.db.zoho_documents[0].state], ["unknown", "unknown"]);
    assertEquals(r.error.includes("2 minutes"), true);
  });
});

Deno.test("gone, then a failed retry, then another retry still skips the deleted draft", async () => {
  const m = makeDeps();
  m.db.zoho_documents.push({
    id: "r1", source_table: "hub_documents", source_id: "h1", kind: "estimate", reference: "Q-1",
    state: "gone", zoho_id: "7001", zoho_number: "EST-0001", created_at: "2026-11-01T00:00:00.000Z",
  });
  m.replies["/estimates"] = { estimates: [doc("7001")] };
  m.state.postImpl = () => Promise.reject(new ZohoHttpError(400, "Customer is inactive."));
  await quiet(async () => {
    const r = ref(await handle("document_create", hub, m.deps));
    assertEquals([r.state, r.zoho_id, r.zoho_number, r.url], ["failed", null, null, null]);
  });
  assertEquals(m.db.zoho_documents[0].zoho_id, "7001");
  m.state.postImpl = () => Promise.resolve({ estimate: { estimate_id: "7002", estimate_number: "EST-0002", total: 105, status: "draft" } });
  const r2 = ref(await handle("document_create", hub, m.deps));
  assertEquals([r2.zoho_id, m.posts.length], ["7002", 2]);
});

Deno.test("more than one page of matches, or a row without reference or customer, stops with nothing sent", async () => {
  const cases: unknown[] = [
    { estimates: [], page_context: { has_more_page: true } },
    { estimates: [{ estimate_id: "1", customer_id: "11" }] },
    { estimates: [{ estimate_id: "1", reference_number: "Q-1" }] },
  ];
  for (const reply of cases) {
    const m = makeDeps();
    m.replies["/estimates"] = reply;
    await quiet(async () => {
      const r = ref(await handle("document_create", hub, m.deps));
      assertEquals([r.state, r.error, m.posts.length], [
        "failed",
        "Zoho returned too many possible matches, so no draft was created. Check Zoho, then try again.",
        0,
      ]);
    });
  }
});

Deno.test("a reply with no document id sets unknown", async () => {
  const m = makeDeps();
  m.state.postImpl = () => Promise.resolve({ code: 0 });
  await quiet(async () => {
    const r = ref(await handle("document_create", hub, m.deps));
    assertEquals([r.state, m.db.zoho_documents[0].state], ["unknown", "unknown"]);
  });
});

Deno.test("a save failure after the POST is reported, and a later press adopts the draft", async () => {
  const m = makeDeps();
  m.errors["zoho_documents.update"] = { code: "XX000", message: "db down" };
  await quiet(async () => {
    await assertRejects(() => handle("document_create", hub, m.deps), UserError, "could not save it");
  });
  delete m.errors["zoho_documents.update"];
  m.replies["/estimates"] = { estimates: [doc("7001")] };
  await assertRejects(() => handle("document_create", hub, m.deps), UserError, "already being created");
  m.state.now = new Date("2026-11-03T00:03:00Z");
  const r = ref(await handle("document_create", hub, m.deps));
  assertEquals([r.state, r.zoho_id, m.posts.length], ["created", "7001", 1]);
});

Deno.test("a takeover that matches no row sends nothing", async () => {
  const m = makeDeps();
  m.db.zoho_documents.push({
    id: "r1", source_table: "hub_documents", source_id: "h1", kind: "estimate", reference: "Q-1",
    state: "failed", created_at: "2026-11-02T23:00:00.000Z",
  });
  m.errors["zoho_documents.update.nomatch"] = true;
  await assertRejects(() => handle("document_create", hub, m.deps), UserError, "already being created");
  assertEquals([m.calls.length, m.posts.length], [0, 0]);
});

Deno.test("a worker that lost its row to a takeover does not report success", async () => {
  const m = makeDeps();
  m.state.postImpl = () => {
    m.db.zoho_documents[0].created_at = "2026-11-03T00:05:00.000Z";
    return Promise.resolve(estimateReply());
  };
  await quiet(async () => {
    await assertRejects(() => handle("document_create", hub, m.deps), UserError, "already being created");
  });
  assertEquals(m.db.zoho_documents[0].state, "creating");
});

Deno.test("a takeover clears the old read time and keeps the first presser", async () => {
  const m = makeDeps();
  m.db.zoho_documents.push({
    id: "r1", source_table: "hub_documents", source_id: "h1", kind: "estimate", reference: "Q-1",
    state: "failed", created_by: "first-user", last_read_at: "2026-11-01T00:00:00.000Z", created_at: "2026-11-02T00:00:00.000Z",
  });
  await handle("document_create", hub, m.deps);
  assertEquals([m.db.zoho_documents[0].created_by, m.db.zoho_documents[0].last_read_at], ["first-user", null]);
});


// ---- Read back, Client Login and View PDF ----

const STATE = { source_table: "hub_documents", source_id: "h1" };
const BANK = { source_table: "banking_quotations", source_id: "b1" };

function seed(db: Record<string, Row[]>, over: Row = {}) {
  const row: Row = {
    id: "d1",
    department: "Business Setup",
    source_table: "hub_documents",
    source_id: "h1",
    kind: "invoice",
    reference: "Q-1",
    state: "created",
    crm_total: 105,
    zoho_id: "9001",
    zoho_number: "INV-0001",
    zoho_status: "draft",
    total: 105,
    balance: null,
    last_read_at: null,
    created_at: "2026-11-02T00:00:00.000Z",
    ...over,
  };
  db.zoho_documents.push(row);
  return row;
}

const invoiceReply = (status: string, extra: Row = {}) => ({
  invoice: { invoice_id: "9001", invoice_number: "INV-0001", total: 105, balance: 105, status, date: "2026-11-03", ...extra },
});
const notFound = () => {
  throw new ZohoHttpError(404, "Invoice does not exist");
};

Deno.test("no second Zoho call within 15 minutes unless forced", async () => {
  const { deps, db, calls, replies, state } = makeDeps();
  seed(db);
  replies["/invoices/9001"] = invoiceReply("sent");
  await handle("document_state", STATE, deps);
  assertEquals(calls.filter((c) => c.path === "/invoices/9001").length, 1);
  state.now = new Date("2026-11-03T00:14:00Z");
  await handle("document_state", STATE, deps);
  assertEquals(calls.filter((c) => c.path === "/invoices/9001").length, 1);
  await handle("document_state", { ...STATE, force: true }, deps);
  assertEquals(calls.filter((c) => c.path === "/invoices/9001").length, 2);
  state.now = new Date("2026-11-03T00:16:00Z");
  await handle("document_state", STATE, deps);
  assertEquals(calls.filter((c) => c.path === "/invoices/9001").length, 2);
  state.now = new Date("2026-11-03T00:30:00Z");
  await handle("document_state", STATE, deps);
  assertEquals(calls.filter((c) => c.path === "/invoices/9001").length, 3);
});

Deno.test("force needs the same view permission and a refusal makes no Zoho call", async () => {
  const { deps, db, calls } = makeDeps({ can: () => Promise.resolve(false) });
  seed(db);
  await assertRejects(() => handle("document_state", { ...STATE, force: true }, deps), UserError, "permission");
  assertEquals(calls.length, 0);
});

Deno.test("document_state asks for setup.access or cases.view, chosen by the table", async () => {
  const a = makeDeps();
  await handle("document_state", STATE, a.deps);
  assertEquals(a.asked, ["setup.access"]);
  const b = makeDeps();
  await handle("document_state", { ...BANK, department: "business_setup" }, b.deps);
  assertEquals(b.asked, ["cases.view"]);
});

Deno.test("a draft adds no business_setup_invoices row", async () => {
  const { deps, db, replies } = makeDeps();
  seed(db);
  replies["/invoices/9001"] = invoiceReply("draft");
  const res = await handle("document_state", STATE, deps) as Row;
  assertEquals(db.business_setup_invoices ?? [], []);
  assertEquals(res.rows[0].state, "created");
  assertEquals(db.zoho_documents[0].zoho_status, "draft");
});

Deno.test("a sent invoice adds one row with number, date and total, source zoho", async () => {
  const { deps, db, replies } = makeDeps();
  seed(db);
  replies["/invoices/9001"] = invoiceReply("sent");
  await handle("document_state", STATE, deps);
  assertEquals(db.business_setup_invoices.length, 1);
  const r = db.business_setup_invoices[0];
  assertEquals(r.client_id, "CL000001");
  assertEquals(r.quote_id, "h1");
  assertEquals(r.invoice_number, "INV-0001");
  assertEquals(r.issued_on, "2026-11-03");
  assertEquals(r.amount, 105);
  assertEquals(r.source, "zoho");
  assertEquals(r.zoho_id, "9001");
  assertEquals("file_path" in r, false);
  assertEquals(db.zoho_documents[0].zoho_status, "sent");
  assertEquals(db.zoho_documents[0].balance, 105);
  assertEquals(db.zoho_documents[0].last_read_at, "2026-11-03T00:00:00.000Z");
});

Deno.test("every client-visible status adds a row, and an unknown one does not", async () => {
  const cases: [string, boolean][] = [["overdue", true], ["paid", true], ["partially_paid", true], ["unpaid", true], ["pending_approval", false], ["", false]];
  for (const [status, shown] of cases) {
    const { deps, db, replies } = makeDeps();
    seed(db);
    replies["/invoices/9001"] = invoiceReply(status);
    await handle("document_state", STATE, deps);
    assertEquals((db.business_setup_invoices ?? []).length, shown ? 1 : 0, status);
  }
});

Deno.test("reading twice leaves one row and updates it", async () => {
  const { deps, db, replies } = makeDeps();
  seed(db);
  replies["/invoices/9001"] = invoiceReply("sent");
  await handle("document_state", STATE, deps);
  replies["/invoices/9001"] = invoiceReply("paid", { total: 110 });
  await handle("document_state", { ...STATE, force: true }, deps);
  assertEquals(db.business_setup_invoices.length, 1);
  assertEquals(db.business_setup_invoices[0].amount, 110);
});

Deno.test("a second caller that adds the row first does not make a duplicate", async () => {
  const { deps, db, replies, errors } = makeDeps();
  seed(db);
  db.business_setup_invoices = [{ id: "i0", zoho_id: "9001", client_id: "CL000001", amount: 1 }];
  errors["business_setup_invoices.hide"] = true;
  replies["/invoices/9001"] = invoiceReply("sent");
  await handle("document_state", STATE, deps);
  assertEquals(db.business_setup_invoices.length, 1);
  assertEquals(db.business_setup_invoices[0].amount, 105);
});

Deno.test("a void invoice removes the row", async () => {
  const { deps, db, replies } = makeDeps();
  seed(db);
  db.business_setup_invoices = [{ id: "i0", zoho_id: "9001", client_id: "CL000001" }, { id: "i1", zoho_id: "other", client_id: "CL000001" }];
  replies["/invoices/9001"] = invoiceReply("void");
  await handle("document_state", STATE, deps);
  assertEquals(db.business_setup_invoices.map((r) => r.zoho_id), ["other"]);
});

Deno.test("an estimate never adds a row", async () => {
  const { deps, db, replies } = makeDeps();
  seed(db, { kind: "estimate", zoho_id: "7001", zoho_number: "EST-1" });
  replies["/estimates/7001"] = { estimate: { estimate_id: "7001", status: "sent", total: 105, date: "2026-11-03" } };
  const res = await handle("document_state", STATE, deps) as Row;
  assertEquals(db.business_setup_invoices ?? [], []);
  assertEquals(res.rows[0].kind, "estimate");
  assertEquals(db.zoho_documents[0].zoho_status, "sent");
});

Deno.test("a Banking invoice adds a row with quote_id null", async () => {
  const { deps, db, replies } = makeDeps();
  seed(db, { department: "Banking", source_table: "banking_quotations", source_id: "b1", reference: "BQ-1" });
  replies["/invoices/9001"] = invoiceReply("sent");
  await handle("document_state", BANK, deps);
  assertEquals(db.business_setup_invoices.length, 1);
  assertEquals(db.business_setup_invoices[0].quote_id, null);
  assertEquals(db.business_setup_invoices[0].client_id, "CL000002");
});

Deno.test("404 from Zoho sets gone and removes any row", async () => {
  const { deps, db, replies } = makeDeps();
  seed(db);
  db.business_setup_invoices = [{ id: "i0", zoho_id: "9001", client_id: "CL000001" }];
  replies["/invoices/9001"] = notFound;
  const res = await handle("document_state", STATE, deps) as Row;
  assertEquals(db.zoho_documents[0].state, "gone");
  assertEquals(db.zoho_documents[0].zoho_id, "9001");
  assertEquals(db.business_setup_invoices, []);
  assertEquals(res.rows[0].state, "gone");
  assertEquals(res.read_error, null);
});

Deno.test("a Zoho failure leaves the last status and reports it", async () => {
  const { deps, db, replies } = makeDeps();
  seed(db, { zoho_status: "sent", balance: 50 });
  db.business_setup_invoices = [{ id: "i0", zoho_id: "9001", client_id: "CL000001" }];
  replies["/invoices/9001"] = () => {
    throw new ZohoHttpError(429, "slow down");
  };
  const res = await handle("document_state", STATE, deps) as Row;
  assertEquals(res.read_error, "Zoho is busy, try again shortly.");
  assertEquals(res.connected, true);
  assertEquals(res.rows[0].zoho_status, "sent");
  assertEquals(res.rows[0].balance, 50);
  assertEquals(db.zoho_documents[0].last_read_at, null);
  assertEquals(db.business_setup_invoices.length, 1);
});

Deno.test("missing credentials still return the saved rows", async () => {
  const { deps, db, calls } = makeDeps({
    zoho: () => Promise.reject(new MissingSecretError("ZOHO_CLIENT_ID")),
  });
  seed(db, { zoho_status: "sent" });
  const res = await handle("document_state", STATE, deps) as Row;
  assertEquals(res.connected, false);
  assertEquals(res.read_error, "Zoho credentials are missing.");
  assertEquals(res.rows.length, 1);
  assertEquals(res.rows[0].zoho_status, "sent");
  assertEquals(res.rows[0].url, null);
  assertEquals(calls.length, 0);
});

Deno.test("only created rows are read, and rows carry the warning and earlier draft", async () => {
  const { deps, db, calls, replies } = makeDeps();
  seed(db, { id: "d2", kind: "estimate", state: "failed", zoho_id: null, zoho_number: null });
  seed(db, { total: 99 });
  replies["/invoices/9001"] = invoiceReply("draft", { total: 99 });
  const res = await handle("document_state", STATE, deps) as Row;
  assertEquals(calls.map((c) => c.path), ["/invoices/9001"]);
  const inv = res.rows.find((r: Row) => r.kind === "invoice");
  assertEquals(inv.total_warning, true);
  assertEquals("earlier_draft" in inv, true);
  assertEquals(inv.url, "https://books.zoho.ae/app/ORG1#/invoices/9001");
});

Deno.test("a Client Login write failure is reported and the read time is held back", async () => {
  const { deps, db, replies, errors } = makeDeps();
  seed(db);
  errors["business_setup_invoices.insert"] = { code: "XX000", message: "boom" };
  replies["/invoices/9001"] = invoiceReply("sent");
  const res = await handle("document_state", STATE, deps) as Row;
  assertEquals(res.read_error, "The Zoho status was read, but Client Login could not be updated. Press Refresh to try again.");
  assertEquals(db.zoho_documents[0].last_read_at, null);
  assertEquals(db.zoho_documents[0].zoho_status, "sent");
});

Deno.test("document_pdf needs setup.access or cases.view and makes no Zoho call when refused", async () => {
  const refused = makeDeps({ can: () => Promise.resolve(false) });
  seed(refused.db);
  await assertRejects(() => handle("document_pdf", { ...STATE, kind: "invoice" }, refused.deps), UserError, "permission");
  assertEquals(refused.pdfCalls.length + refused.calls.length, 0);
  const a = makeDeps();
  seed(a.db);
  await handle("document_pdf", { ...STATE, kind: "invoice" }, a.deps);
  assertEquals(a.asked, ["setup.access"]);
  const b = makeDeps();
  seed(b.db, { department: "Banking", source_table: "banking_quotations", source_id: "b1" });
  await handle("document_pdf", { ...BANK, kind: "invoice" }, b.deps);
  assertEquals(b.asked, ["cases.view"]);
});

Deno.test("document_pdf takes the Zoho ID from zoho_documents and ignores any ID from the browser", async () => {
  const { deps, db, pdfCalls } = makeDeps();
  seed(db);
  const res = await handle("document_pdf", { ...STATE, kind: "invoice", zoho_id: "666", id: "666", path: "/users" }, deps) as Row;
  assertEquals(pdfCalls, ["/invoices/9001"]);
  assertEquals(res.filename, "INV-0001.pdf");
  assertEquals(new TextDecoder().decode(res.pdf).startsWith("%PDF"), true);
});

Deno.test("document_pdf with no created row says so and calls nothing", async () => {
  const cases: (Row | null)[] = [null, { state: "creating" }, { state: "failed" }, { state: "gone" }, { state: "unknown" }, { zoho_id: null }];
  for (const over of cases) {
    const { deps, db, pdfCalls, calls } = makeDeps();
    if (over) seed(db, over);
    await assertRejects(() => handle("document_pdf", { ...STATE, kind: "invoice" }, deps), UserError, "This draft isn't available yet.");
    assertEquals(pdfCalls.length + calls.length, 0);
  }
});

Deno.test("document_pdf on a 404 sets gone", async () => {
  const { deps, db, state } = makeDeps();
  seed(db);
  db.business_setup_invoices = [{ id: "i0", zoho_id: "9001", client_id: "CL000001" }];
  state.pdfImpl = () => Promise.reject(new ZohoHttpError(404, "missing"));
  await assertRejects(() => handle("document_pdf", { ...STATE, kind: "invoice" }, deps), UserError, "no longer has");
  assertEquals(db.zoho_documents[0].state, "gone");
  assertEquals(db.business_setup_invoices, []);
});

Deno.test("document_pdf stores nothing", async () => {
  const { deps, db, saved } = makeDeps();
  seed(db);
  const before = JSON.stringify(db);
  await handle("document_pdf", { ...STATE, kind: "invoice" }, deps);
  assertEquals(JSON.stringify(db), before);
  assertEquals(saved, []);
});

Deno.test("document_pdf rejects an unknown kind or table", async () => {
  const { deps } = makeDeps();
  await assertRejects(() => handle("document_pdf", { ...STATE, kind: "bill" }, deps), UserError, "Choose estimate or invoice");
  await assertRejects(() => handle("document_pdf", { source_table: "x", source_id: "1", kind: "invoice" }, deps), UserError, "Unknown quote type");
});

Deno.test("the PDF file name has no quotes or path characters", () => {
  assertEquals(pdfFileName("INV-0001"), "INV-0001.pdf");
  assertEquals(pdfFileName('..\\..\\evil"; x=y/INV 1'), "evil xyINV 1.pdf");
  assertEquals(pdfFileName(null), "document.pdf");
  assertEquals(pdfFileName('"/\\'), "document.pdf");
});
