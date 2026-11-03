import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { browserMessage, handle, permissionCheck, UserError } from "./handlers.ts";
import { ZohoAccessError, ZohoHttpError } from "./zohoClient.ts";
import { MissingSecretError } from "./secrets.ts";

type Call = { path: string; query?: Record<string, string> };

function makeDeps(over: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const saved: unknown[] = [];
  const asked: string[] = [];
  const tables: string[] = [];
  const conflicts: unknown[] = [];
  const replies: Record<string, unknown> = {
    "/organizations": { organizations: [{ organization_id: "ORG1", name: "Acme Trading LLC" }] },
    "/settings/taxes": { taxes: [{ tax_id: "1", tax_name: "VAT", tax_percentage: 5 }] },
    "/contacts": { contacts: [{ contact_id: "11", contact_name: "Acme", tax_reg_no: "100", currency_code: "AED", extra: "x" }] },
    "/contacts/11": { contact: { contact_id: "11", contact_name: "Acme LLC", currency_code: "AED" } },
    "/contacts/22": { contact: { contact_id: "22", contact_name: "Dollar Co", currency_code: "USD" } },
  };
  const deps = {
    isAdmin: () => Promise.resolve(true),
    can: (_d: string, p: string) => {
      asked.push(p);
      return Promise.resolve(true);
    },
    db: {
      from: (t: string) => {
        tables.push(t);
        return {
          upsert: (row: unknown, opts?: unknown) => {
            saved.push(row);
            conflicts.push(opts);
            return Promise.resolve({ error: over.dbError ?? null });
          },
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: over.link ?? null, error: over.dbError ?? null }),
            }),
          }),
        };
      },
    },
    zoho: () =>
      Promise.resolve({
        orgId: "ORG1",
        get: (path: string, query?: Record<string, string>) => {
          calls.push({ path, query });
          return Promise.resolve(replies[path]);
        },
        post: () => Promise.reject(new Error("no post expected")),
      }),
    userId: "user-1",
    now: () => new Date("2026-11-03T00:00:00Z"),
    ...over,
  };
  // deno-lint-ignore no-explicit-any
  return { deps: deps as any, calls, saved, asked, tables, conflicts, replies };
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
  assertEquals(tables, ["zoho_contact_links"]);
  assertEquals(conflicts, [{ onConflict: "client_id" }]);
});

Deno.test("contact_link maps a missing client to a plain message", async () => {
  const fk = { code: "23503", message: 'insert violates foreign key constraint "zoho_contact_links_client_id_fkey"' };
  const { deps } = makeDeps({ dbError: fk });
  await assertRejects(
    () => handle("contact_link", { client_id: "CL000001", zoho_contact_id: "11", department: "banking" }, deps),
    UserError,
    "That client was not found.",
  );
});

Deno.test("other database errors reach the caller as plain text only", async () => {
  const pg = { code: "XX000", message: 'relation "zoho_contact_links" constraint "secret_name" broke' };
  const { deps } = makeDeps({ dbError: pg });
  const quiet = console.error;
  console.error = () => {};
  try {
    for (
      const [fn, args, msg] of [
        ["contact_link", { client_id: "c1", zoho_contact_id: "11", department: "banking" }, "Could not save the Zoho link."],
        ["contact_get", { client_id: "c1", department: "banking" }, "Could not read the Zoho link."],
      ] as const
    ) {
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
