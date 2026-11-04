import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { signState, pkceFrom } from "./auth.ts";
import { browserMessage, callback, graphFor, handle, UserError } from "./handlers.ts";
import { MissingSecretError } from "./secrets.ts";

const NOW = 1_800_000_000_000;
const ADMIN = "00000000-0000-0000-0000-00000000000a";
const MEMBER = "00000000-0000-0000-0000-00000000000b";
const OTHER = "00000000-0000-0000-0000-00000000000c";
const TENANT = "11111111-2222-3333-4444-555555555555";
const APP = "https://crm.example/ABCRM/";
const REDIRECT = "https://proj.supabase.co/functions/v1/ms365";

const SECRETS: Record<string, string> = {
  MICROSOFT_TENANT_ID: TENANT,
  MICROSOFT_CLIENT_ID: "client-id",
  MICROSOFT_CLIENT_SECRET: "client-secret-value",
  MICROSOFT_STATE_SECRET: "state-key",
  MESSENGER_APP_URL: APP,
};

type Row = Record<string, unknown>;

// A small in-memory stand-in for the service-role client: only what handlers.ts calls.
function fakeDb(tables: Record<string, Row[]>, fail: Record<string, { code: string; message: string }>) {
  const rpcs: { name: string; args: Row }[] = [];
  const vault = new Map<string, string>();
  const from = (table: string) => {
    const rows = () => (tables[table] ??= []);
    const filters: [string, unknown][] = [];
    const matches = (r: Row) => filters.every(([k, v]) => r[k] === v);
    const failure = (op: string) => fail[`${table}.${op}`] ?? null;
    let pending: "update" | "select" = "select";
    let patch: Row = {};
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => {
        filters.push([k, v]);
        return q;
      },
      order: () => q,
      maybeSingle: () => {
        const error = failure("select");
        if (error) return Promise.resolve({ data: null, error });
        return Promise.resolve({ data: rows().find(matches) ?? null, error: null });
      },
      update: (p: Row) => {
        pending = "update";
        patch = p;
        return q;
      },
      insert: (row: Row) => {
        const error = failure("insert");
        if (!error) rows().push({ ...row });
        return Promise.resolve({ error });
      },
      upsert: (row: Row, opts: { onConflict: string }) => {
        const error = failure("upsert");
        if (error) return Promise.resolve({ error });
        const key = opts.onConflict;
        const oid = row.microsoft_user_id;
        if (oid !== undefined && rows().some((r) => r.microsoft_user_id === oid && r[key] !== row[key])) {
          return Promise.resolve({ error: { code: "23505", message: "duplicate" } });
        }
        const found = rows().find((r) => r[key] === row[key]);
        if (found) Object.assign(found, row);
        else rows().push({ ...row });
        return Promise.resolve({ error: null });
      },
      // deno-lint-ignore no-explicit-any
      then: (resolve: any) => {
        if (pending === "update") {
          const error = failure("update");
          if (error) return resolve({ data: null, error });
          const hit = rows().filter(matches);
          hit.forEach((r) => Object.assign(r, patch));
          return resolve({ data: hit.map((r) => ({ ...r })), error: null });
        }
        const error = failure("select");
        return resolve({ data: error ? null : rows().filter(matches).map((r) => ({ ...r })), error });
      },
    };
    return q;
  };
  const rpc = (name: string, args: Row) => {
    rpcs.push({ name, args });
    const error = fail[`rpc.${name}`] ?? null;
    if (error) return Promise.resolve({ data: null, error });
    const p = args.p_profile as string;
    if (name === "ms_token_set") vault.set(p, args.p_token as string);
    if (name === "ms_token_delete") vault.delete(p);
    return Promise.resolve({ data: name === "ms_token_get" ? vault.get(p) ?? null : null, error: null });
  };
  return { db: { from, rpc }, rpcs, vault };
}

function idToken(claims: Row): string {
  const b64u = (t: string) => btoa(t).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64u('{"alg":"RS256"}')}.${b64u(JSON.stringify(claims))}.sig`;
}

type Over = {
  userId?: string;
  connection?: Row | null;
  links?: Row[];
  secrets?: Record<string, string>;
  fail?: Record<string, { code: string; message: string }>;
  reply?: () => Response | Promise<Response>;
};

function setup(over: Over = {}) {
  const tables: Record<string, Row[]> = {
    microsoft_connection: over.connection === null || over.connection === undefined ? [] : [{ id: true, ...over.connection }],
    microsoft_user_links: over.links ?? [],
    microsoft_sync_log: [],
    profiles: [
      { id: ADMIN, role: "admin", email: "admin@abc.ae" },
      { id: MEMBER, role: "staff", email: "member@abc.ae" },
      { id: OTHER, role: "staff", email: "other@abc.ae" },
    ],
  };
  const { db, rpcs, vault } = fakeDb(tables, over.fail ?? {});
  const fetches: { url: string; init: RequestInit }[] = [];
  const notes: string[] = [];
  const secrets = over.secrets ?? SECRETS;
  const userId = over.userId ?? MEMBER;
  const deps = {
    db,
    userId,
    isAdmin: () => Promise.resolve(userId === ADMIN),
    secret: (name: string) => {
      const v = secrets[name];
      return v ? Promise.resolve(v) : Promise.reject(new MissingSecretError(name));
    },
    fetch: (url: string, init: RequestInit) => {
      fetches.push({ url, init });
      return Promise.resolve(over.reply ? over.reply() : tokenReply(MEMBER_ID));
    },
    sleep: () => Promise.resolve(),
    now: () => NOW,
    redirectUri: REDIRECT,
    note: (m: string) => notes.push(m),
  };
  // deno-lint-ignore no-explicit-any
  return { deps: deps as any, tables, rpcs, vault, fetches, notes };
}

const MEMBER_ID = { tid: TENANT, oid: "oid-member", preferred_username: "member@abc.ae" };
const ADMIN_ID = { tid: TENANT, oid: "oid-admin", preferred_username: "Admin@ABC.ae" };

function tokenReply(claims: Row, extra: Row = {}): Response {
  return new Response(
    JSON.stringify({ refresh_token: "rt-new", access_token: "at-new", id_token: idToken(claims), scope: "openid profile User.Read", ...extra }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function errorReply(error: string, status = 400): Response {
  return new Response(JSON.stringify({ error, error_description: "AADSTS: leaked-description code-xyz" }), { status });
}

async function params(profile: string, extra: Record<string, string> = {}): Promise<URLSearchParams> {
  return new URLSearchParams({ code: "code-xyz", state: await signState("state-key", profile, NOW), ...extra });
}

function outcome(redirect: string) {
  const u = new URL(redirect);
  assertEquals(u.origin + u.pathname, APP);
  assertEquals(u.searchParams.get("view"), "messenger");
  return { ms: u.searchParams.get("ms"), reason: u.searchParams.get("reason") };
}

const tokenSets = (rpcs: { name: string }[]) => rpcs.filter((r) => r.name === "ms_token_set");
const active = { status: "active", tenant_id: TENANT };

function linkFor(tables: Record<string, Row[]>, profile: string) {
  return tables.microsoft_user_links.find((l) => l.profile_id === profile);
}

// ---------------------------------------------------------------- connect_start

Deno.test("connect_start returns a URL for the caller's own profile and ignores profile_id in the body", async () => {
  const { deps } = setup({ connection: active });
  const out = await handle("connect_start", { profile_id: OTHER }, deps) as { url: string };
  const u = new URL(out.url);
  assertEquals(u.pathname, `/${TENANT}/oauth2/v2.0/authorize`);
  assertEquals(u.searchParams.get("redirect_uri"), REDIRECT);
  const payload = JSON.parse(atob(u.searchParams.get("state")!.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
  assertEquals(payload.p, MEMBER);
});

Deno.test("connect_start by a member refuses while the connection is not active", async () => {
  for (const connection of [null, { status: "not_connected" }, { status: "revoked" }]) {
    const { deps } = setup({ connection });
    await assertRejects(() => handle("connect_start", {}, deps), UserError, "An admin must connect Microsoft first");
  }
});

Deno.test("connect_start by an admin works before the connection is active", async () => {
  const { deps } = setup({ userId: ADMIN });
  const out = await handle("connect_start", {}, deps) as { url: string };
  assert(out.url.startsWith("https://login.microsoftonline.com/"));
});

Deno.test("connect_start names a missing setting, and refuses a shared tenant", async () => {
  const none = setup({ userId: ADMIN, secrets: { ...SECRETS, MICROSOFT_STATE_SECRET: "" } });
  await assertRejects(() => handle("connect_start", {}, none.deps), UserError, "MICROSOFT_STATE_SECRET is not set");
  const shared = setup({ userId: ADMIN, secrets: { ...SECRETS, MICROSOFT_TENANT_ID: "common" } });
  await assertRejects(() => handle("connect_start", {}, shared.deps), UserError, "MICROSOFT_TENANT_ID");
});

// ---------------------------------------------------------------- callback: success

Deno.test("first admin connect stores the token, sets the link active and the connection active", async () => {
  const t = setup({ userId: ADMIN, reply: () => tokenReply(ADMIN_ID) });
  const { redirect } = await callback(await params(ADMIN), t.deps);
  assertEquals(outcome(redirect), { ms: "connected", reason: null });
  assertEquals(t.vault.get(ADMIN), "rt-new");
  assertEquals(linkFor(t.tables, ADMIN)?.status, "active");
  assertEquals(linkFor(t.tables, ADMIN)?.microsoft_user_id, "oid-admin");
  assertEquals(linkFor(t.tables, ADMIN)?.scopes, ["openid", "profile", "User.Read"]);
  const c = t.tables.microsoft_connection[0];
  assertEquals([c.status, c.tenant_id, c.connected_by], ["active", TENANT, ADMIN]);
  assertEquals(typeof c.consented_at, "string");
});

Deno.test("the token exchange posts the verifier from the state, to the tenant authority", async () => {
  const t = setup({ connection: active });
  const p = await params(MEMBER);
  await callback(p, t.deps);
  assertEquals(t.fetches.length, 1);
  assertEquals(t.fetches[0].url, `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`);
  assertEquals(t.fetches[0].init.method, "POST");
  const form = new URLSearchParams(t.fetches[0].init.body as string);
  const nonce = JSON.parse(atob(p.get("state")!.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"))).n;
  assertEquals(form.get("grant_type"), "authorization_code");
  assertEquals(form.get("code"), "code-xyz");
  assertEquals(form.get("redirect_uri"), REDIRECT);
  assertEquals(form.get("client_id"), "client-id");
  assertEquals(form.get("client_secret"), "client-secret-value");
  assertEquals(form.get("code_verifier"), (await pkceFrom("state-key", nonce)).verifier);
  assertEquals(form.get("scope"), "openid profile offline_access User.Read");
});

Deno.test("the redirect uses the configured address, keeps its path, and ignores request parameters", async () => {
  const t = setup({ connection: active });
  const { redirect } = await callback(await params(MEMBER, { redirect_uri: "https://evil.example", next: "https://evil.example" }), t.deps);
  assert(redirect.startsWith(`${APP}?`));
  assert(!redirect.includes("evil"));
});

Deno.test("a missing MESSENGER_APP_URL throws, as no address is safe to redirect to", async () => {
  const t = setup({ connection: active, secrets: { ...SECRETS, MESSENGER_APP_URL: "" } });
  const p = await params(MEMBER);
  await assertRejects(() => callback(p, t.deps), MissingSecretError);
  assertEquals(t.fetches.length, 0);
});

Deno.test("a MESSENGER_APP_URL that is not a web address throws", async () => {
  for (const address of ["javascript:alert(1)", "not a url"]) {
    const t = setup({ connection: active, secrets: { ...SECRETS, MESSENGER_APP_URL: address } });
    const p = await params(MEMBER);
    await assertRejects(() => callback(p, t.deps));
    assertEquals(t.fetches.length, 0);
  }
});

// ---------------------------------------------------------------- callback: tenant

Deno.test("a member with another tid redirects wrong_tenant and stores nothing", async () => {
  const t = setup({ connection: active, reply: () => tokenReply({ ...MEMBER_ID, tid: "other-tenant" }) });
  assertEquals(outcome((await callback(await params(MEMBER), t.deps)).redirect), { ms: "error", reason: "wrong_tenant" });
  assertEquals(tokenSets(t.rpcs), []);
  assertEquals(linkFor(t.tables, MEMBER), undefined);
});

Deno.test("the first admin connect also compares tid with MICROSOFT_TENANT_ID", async () => {
  const t = setup({ userId: ADMIN, reply: () => tokenReply({ ...ADMIN_ID, tid: "other-tenant" }) });
  assertEquals(outcome((await callback(await params(ADMIN), t.deps)).redirect).reason, "wrong_tenant");
  assertEquals(tokenSets(t.rpcs), []);
  assertEquals(t.tables.microsoft_connection, []);
});

Deno.test("a tid equal to the setting but not to the stored connection is wrong_tenant", async () => {
  const t = setup({ connection: { status: "active", tenant_id: "old-tenant" } });
  assertEquals(outcome((await callback(await params(MEMBER), t.deps)).redirect).reason, "wrong_tenant");
  assertEquals(tokenSets(t.rpcs), []);
});

Deno.test("tid comparison ignores case", async () => {
  const t = setup({ connection: active, reply: () => tokenReply({ ...MEMBER_ID, tid: TENANT.toUpperCase() }) });
  assertEquals(outcome((await callback(await params(MEMBER), t.deps)).redirect).ms, "connected");
});

Deno.test("a shared tenant setting in the callback is not_configured and makes no exchange", async () => {
  const t = setup({ connection: active, secrets: { ...SECRETS, MICROSOFT_TENANT_ID: "organizations" } });
  assertEquals(outcome((await callback(await params(MEMBER), t.deps)).redirect).reason, "not_configured");
  assertEquals(t.fetches.length, 0);
});

// ---------------------------------------------------------------- callback: Ruling G

Deno.test("an email mismatch stores no token, sets the link to review with the UPN, and redirects review", async () => {
  const t = setup({ connection: active, reply: () => tokenReply({ ...MEMBER_ID, preferred_username: "personal@abc.ae" }) });
  assertEquals(outcome((await callback(await params(MEMBER), t.deps)).redirect), { ms: "review", reason: null });
  assertEquals(tokenSets(t.rpcs), []);
  assertEquals(t.vault.size, 0);
  const l = linkFor(t.tables, MEMBER)!;
  assertEquals([l.status, l.upn, l.microsoft_user_id], ["review", "personal@abc.ae", "oid-member"]);
  const entry = t.tables.microsoft_sync_log.find((e) => e.status === "review")!;
  assertEquals(entry.actor, MEMBER);
});

Deno.test("a first admin connect with an email mismatch does not activate the connection", async () => {
  const t = setup({ userId: ADMIN, reply: () => tokenReply({ ...ADMIN_ID, preferred_username: "x@abc.ae" }) });
  assertEquals(outcome((await callback(await params(ADMIN), t.deps)).redirect).ms, "review");
  assertEquals(t.tables.microsoft_connection, []);
  assertEquals(t.vault.size, 0);
});

Deno.test("after acceptance the same person's sign-in stores the token and is active", async () => {
  const t = setup({ connection: active, reply: () => tokenReply({ ...MEMBER_ID, preferred_username: "personal@abc.ae" }) });
  await callback(await params(MEMBER), t.deps);

  const admin = { ...t.deps, userId: ADMIN, isAdmin: () => Promise.resolve(true) };
  await handle("user_links_review", { profile_id: MEMBER, decision: "accept", upn: "personal@abc.ae" }, admin);
  assertEquals(linkFor(t.tables, MEMBER)?.status, "active");
  assertEquals(t.vault.size, 0);

  assertEquals(outcome((await callback(await params(MEMBER), t.deps)).redirect).ms, "connected");
  assertEquals(t.vault.get(MEMBER), "rt-new");
  assertEquals(linkFor(t.tables, MEMBER)?.status, "active");
});

Deno.test("after acceptance a different UPN or a different Microsoft account is review again, with no token", async () => {
  for (const claims of [{ ...MEMBER_ID, preferred_username: "third@abc.ae" }, { ...MEMBER_ID, oid: "oid-x", preferred_username: "personal@abc.ae" }]) {
    const t = setup({
      connection: active,
      links: [{ profile_id: MEMBER, microsoft_user_id: "oid-member", upn: "personal@abc.ae", status: "active" }],
      reply: () => tokenReply(claims),
    });
    assertEquals(outcome((await callback(await params(MEMBER), t.deps)).redirect).ms, "review");
    assertEquals(tokenSets(t.rpcs), []);
    assertEquals(linkFor(t.tables, MEMBER)?.status, "review");
  }
});

Deno.test("a sign-in with a mismatch removes the token held under the earlier account", async () => {
  const t = setup({
    connection: active,
    links: [{ profile_id: MEMBER, microsoft_user_id: "oid-member", upn: "member@abc.ae", status: "active" }],
    reply: () => tokenReply({ ...MEMBER_ID, oid: "oid-x", preferred_username: "x@abc.ae" }),
  });
  t.vault.set(MEMBER, "rt-old");
  await callback(await params(MEMBER), t.deps);
  assertEquals(t.vault.size, 0);
});

Deno.test("a review or revoked link never yields a token to Graph", async () => {
  for (const status of ["review", "revoked"]) {
    const t = setup({ links: [{ profile_id: MEMBER, status }] });
    t.vault.set(MEMBER, "rt-old");
    t.rpcs.length = 0;
    const graph = await graphFor(t.deps, MEMBER);
    await assertRejects(() => graph.request("GET", "/me"), Error, "not connected");
    assertEquals(t.fetches.length, 0);
    assertEquals(t.rpcs.filter((r) => r.name === "ms_token_get"), []);
  }
});

// ---------------------------------------------------------------- callback: refusals

Deno.test("bad or expired state redirects expired, makes no exchange, and leaves the token unchanged", async () => {
  const expired = await signState("state-key", MEMBER, NOW - 11 * 60_000);
  const forged = await signState("other-key", MEMBER, NOW);
  for (const state of [expired, forged, "junk", "a.b"]) {
    const t = setup({ connection: active });
    t.vault.set(MEMBER, "rt-old");
    const { redirect } = await callback(new URLSearchParams({ code: "code-xyz", state }), t.deps);
    assertEquals(outcome(redirect), { ms: "error", reason: "expired" });
    assertEquals(t.fetches.length, 0);
    assertEquals(t.vault.get(MEMBER), "rt-old");
    assertEquals(t.tables.microsoft_sync_log, []);
  }
});

Deno.test("a missing state secret is not_configured and logged, not expired", async () => {
  const t = setup({ connection: active, secrets: { ...SECRETS, MICROSOFT_STATE_SECRET: "" } });
  const { redirect } = await callback(new URLSearchParams({ code: "code-xyz", state: "a.b" }), t.deps);
  assertEquals(outcome(redirect), { ms: "error", reason: "not_configured" });
  assertEquals(t.fetches.length, 0);
  assertEquals(t.tables.microsoft_sync_log.length, 1);
  assertEquals(t.tables.microsoft_sync_log[0].error_code, "not_configured");
});

Deno.test("a missing client secret is not_configured and makes no exchange", async () => {
  const t = setup({ connection: active, secrets: { ...SECRETS, MICROSOFT_CLIENT_SECRET: "" } });
  assertEquals(outcome((await callback(await params(MEMBER), t.deps)).redirect).reason, "not_configured");
  assertEquals(t.fetches.length, 0);
});

Deno.test("a reused code redirects code_used and leaves the token unchanged", async () => {
  const t = setup({ connection: active, reply: () => errorReply("invalid_grant") });
  t.vault.set(MEMBER, "rt-old");
  assertEquals(outcome((await callback(await params(MEMBER), t.deps)).redirect), { ms: "error", reason: "code_used" });
  assertEquals(t.vault.get(MEMBER), "rt-old");
  assertEquals(tokenSets(t.rpcs), []);
});

Deno.test("Microsoft's access_denied redirects denied; other errors redirect microsoft_error", async () => {
  const a = setup({ connection: active });
  assertEquals(outcome((await callback(new URLSearchParams({ error: "access_denied" }), a.deps)).redirect), { ms: "error", reason: "denied" });
  assertEquals(a.fetches.length, 0);
  assertEquals(a.tables.microsoft_sync_log, []);
  const b = setup({ connection: active });
  const p = await params(MEMBER, { error: "server_error", error_description: "leak-me" });
  assertEquals(outcome((await callback(p, b.deps)).redirect).reason, "microsoft_error");
  assertEquals(b.fetches.length, 0);
  assertEquals(b.tables.microsoft_sync_log[0].actor, MEMBER);
  assert(!JSON.stringify(b.tables.microsoft_sync_log).includes("leak-me"));
});

Deno.test("a Microsoft account linked to someone else redirects already_linked, whatever the email", async () => {
  const t = setup({
    connection: active,
    links: [{ profile_id: OTHER, microsoft_user_id: "oid-member", upn: "renamed@abc.ae", status: "active" }],
  });
  t.vault.set(OTHER, "rt-other");
  assertEquals(outcome((await callback(await params(MEMBER), t.deps)).redirect), { ms: "error", reason: "already_linked" });
  assertEquals(tokenSets(t.rpcs), []);
  assertEquals(t.vault.get(OTHER), "rt-other");
  assertEquals(linkFor(t.tables, MEMBER), undefined);
});

Deno.test("the same account with another email is not already_linked when it belongs to the caller", async () => {
  const t = setup({ connection: active, links: [{ profile_id: MEMBER, microsoft_user_id: "oid-member", upn: "member@abc.ae", status: "revoked" }] });
  assertEquals(outcome((await callback(await params(MEMBER), t.deps)).redirect).ms, "connected");
  assertEquals(linkFor(t.tables, MEMBER)?.status, "active");
});

Deno.test("a unique clash while saving the link redirects already_linked and stores nothing", async () => {
  const t = setup({ connection: active });
  const realFrom = t.deps.db.from;
  let reads = 0;
  // The holder's row appears only after the check has passed, as in a race.
  t.deps.db.from = (table: string) => {
    if (table === "microsoft_user_links" && ++reads === 3) {
      t.tables.microsoft_user_links.push({ profile_id: OTHER, microsoft_user_id: "oid-member", status: "active" });
    }
    return realFrom(table);
  };
  assertEquals(outcome((await callback(await params(MEMBER), t.deps)).redirect).reason, "already_linked");
  assertEquals(tokenSets(t.rpcs), []);
});

Deno.test("a member callback while the connection is not active stores nothing and makes no exchange", async () => {
  const t = setup({ connection: { status: "revoked", tenant_id: TENANT } });
  assertEquals(outcome((await callback(await params(MEMBER), t.deps)).redirect).reason, "admin_first");
  assertEquals(t.fetches.length, 0);
  assertEquals(t.vault.size, 0);
});

Deno.test("a state for a profile that no longer exists fails without an exchange", async () => {
  const t = setup({ connection: active });
  assertEquals(outcome((await callback(await params("00000000-0000-0000-0000-0000000000ff"), t.deps)).redirect).reason, "failed");
  assertEquals(t.fetches.length, 0);
});

Deno.test("a missing code fails without an exchange", async () => {
  const t = setup({ connection: active });
  const p = await params(MEMBER);
  p.delete("code");
  assertEquals(outcome((await callback(p, t.deps)).redirect).reason, "failed");
  assertEquals(t.fetches.length, 0);
});

Deno.test("the profile comes only from the state, never from other parameters", async () => {
  const t = setup({ connection: active, userId: OTHER });
  await callback(await params(MEMBER, { profile_id: OTHER, p: OTHER }), t.deps);
  assertEquals(t.vault.has(MEMBER), true);
  assertEquals(t.vault.has(OTHER), false);
});

Deno.test("a Vault failure on save keeps the link from going active", async () => {
  const t = setup({ connection: active, fail: { "rpc.ms_token_set": { code: "XX000", message: "vault down" } } });
  assertEquals(outcome((await callback(await params(MEMBER), t.deps)).redirect).reason, "failed");
  assert(linkFor(t.tables, MEMBER)?.status !== "active");
});

Deno.test("a Vault failure on reconnect leaves an existing active link and its token alone", async () => {
  const t = setup({
    connection: active,
    links: [{ profile_id: MEMBER, microsoft_user_id: "oid-member", upn: "member@abc.ae", status: "active" }],
    fail: { "rpc.ms_token_set": { code: "XX000", message: "vault down" } },
  });
  t.vault.set(MEMBER, "rt-old");
  await callback(await params(MEMBER), t.deps);
  assertEquals(linkFor(t.tables, MEMBER)?.status, "active");
  assertEquals(t.vault.get(MEMBER), "rt-old");
});

Deno.test("a database failure on reading the connection redirects failed and exchanges nothing", async () => {
  const t = setup({ connection: active, fail: { "microsoft_connection.select": { code: "XX000", message: "down" } } });
  assertEquals(outcome((await callback(await params(MEMBER), t.deps)).redirect).reason, "failed");
  assertEquals(t.fetches.length, 0);
});

Deno.test("failures do not leak the code, secret, tokens or Microsoft's reply into logs or redirects", async () => {
  const replies: (() => Response | Promise<Response>)[] = [
    () => errorReply("invalid_client", 401),
    () => errorReply("weird code-xyz client-secret-value", 400),
    () => new Response("<html>code-xyz client-secret-value</html>", { status: 502 }),
    () => new Response(JSON.stringify({ refresh_token: "rt-new" }), { status: 200 }),
    () => new Response(JSON.stringify({ refresh_token: "rt-new", id_token: "not.a.token-rt" }), { status: 200 }),
    () => Promise.reject(new Error("failed https://x?code=code-xyz client-secret-value")),
  ];
  for (const reply of replies) {
    const t = setup({ connection: active, reply });
    const { redirect } = await callback(await params(MEMBER), t.deps);
    assertEquals(outcome(redirect).reason, "failed");
    assertEquals(tokenSets(t.rpcs), []);
    const all = [redirect, JSON.stringify(t.tables.microsoft_sync_log), t.notes.join(" ")].join(" ");
    for (const secret of ["code-xyz", "client-secret-value", "rt-new", "leaked-description", "<html>"]) {
      assert(!all.includes(secret), `${secret} leaked: ${all}`);
    }
    assert(t.tables.microsoft_sync_log.length > 0);
  }
});

Deno.test("an unexpected failure with secret text in its message logs only the error name", async () => {
  const t = setup({ connection: active });
  const realFrom = t.deps.db.from;
  t.deps.db.from = (table: string) => {
    if (table === "profiles") throw new Error("boom code-xyz client-secret-value");
    return realFrom(table);
  };
  assertEquals(outcome((await callback(await params(MEMBER), t.deps)).redirect).reason, "failed");
  assert(!t.notes.join().includes("code-xyz"));
  assert(!JSON.stringify(t.tables.microsoft_sync_log).includes("code-xyz"));
});

Deno.test("a successful sign-in writes no token or code to the log", async () => {
  const t = setup({ connection: active });
  await callback(await params(MEMBER), t.deps);
  const logged = JSON.stringify(t.tables.microsoft_sync_log);
  assertEquals(t.tables.microsoft_sync_log[0].status, "ok");
  for (const secret of ["code-xyz", "rt-new", "at-new", "eyJ"]) assert(!logged.includes(secret));
});

// ---------------------------------------------------------------- disconnect

Deno.test("disconnect deletes the caller's token, sets revoked and logs, ignoring profile_id", async () => {
  const t = setup({ links: [{ profile_id: MEMBER, status: "active" }, { profile_id: OTHER, status: "active" }] });
  t.vault.set(MEMBER, "rt");
  t.vault.set(OTHER, "rt-other");
  assertEquals(await handle("disconnect", { profile_id: OTHER }, t.deps), { ok: true });
  assertEquals(t.vault.has(MEMBER), false);
  assertEquals(t.vault.get(OTHER), "rt-other");
  assertEquals(linkFor(t.tables, MEMBER)?.status, "revoked");
  assertEquals(linkFor(t.tables, OTHER)?.status, "active");
  const e = t.tables.microsoft_sync_log[0];
  assertEquals([e.action, e.status, e.actor], ["disconnect", "ok", MEMBER]);
});

Deno.test("a Vault failure on disconnect shows an error and keeps the status", async () => {
  const t = setup({ links: [{ profile_id: MEMBER, status: "active" }], fail: { "rpc.ms_token_delete": { code: "XX000", message: "down" } } });
  await assertRejects(() => handle("disconnect", {}, t.deps), UserError, "Could not disconnect");
  assertEquals(linkFor(t.tables, MEMBER)?.status, "active");
  assertEquals(t.tables.microsoft_sync_log[0].status, "error");
});

// ---------------------------------------------------------------- admin actions

Deno.test("admin actions refuse a member and change nothing", async () => {
  const t = setup({ links: [{ profile_id: OTHER, upn: "x@abc.ae", status: "review" }] });
  const review = { profile_id: OTHER, decision: "accept", upn: "x@abc.ae" };
  await assertRejects(() => handle("admin_test", {}, t.deps), UserError, "Only a CRM admin");
  await assertRejects(() => handle("user_links_review", review, t.deps), UserError, "Only a CRM admin");
  await assertRejects(() => handle("secret_expiry_set", { date: "2027-01-01" }, t.deps), UserError, "Only a CRM admin");
  assertEquals(linkFor(t.tables, OTHER)?.status, "review");
  assertEquals(t.tables.microsoft_connection, []);
  assertEquals(t.fetches.length, 0);
});

Deno.test("accepting a review row sets active, clears any leftover token, and logs the admin as actor", async () => {
  const t = setup({ userId: ADMIN, links: [{ profile_id: OTHER, microsoft_user_id: "o", upn: "x@abc.ae", status: "review" }] });
  t.vault.set(OTHER, "stale");
  assertEquals(await handle("user_links_review", { profile_id: OTHER, decision: "accept", upn: "x@abc.ae" }, t.deps), { ok: true, status: "active" });
  assertEquals(linkFor(t.tables, OTHER)?.status, "active");
  assertEquals(t.vault.has(OTHER), false);
  const e = t.tables.microsoft_sync_log[0];
  assertEquals([e.action, e.status, e.actor], ["user_links_review", "accept", ADMIN]);
  assertEquals((e.detail as Row).profile_id, OTHER);
});

Deno.test("accepting needs the UPN the admin saw, so a later sign-in is not accepted by mistake", async () => {
  const t = setup({ userId: ADMIN, links: [{ profile_id: OTHER, upn: "new@abc.ae", status: "review" }] });
  await assertRejects(() => handle("user_links_review", { profile_id: OTHER, decision: "accept", upn: "seen@abc.ae" }, t.deps), UserError, "not waiting");
  await assertRejects(() => handle("user_links_review", { profile_id: OTHER, decision: "accept" }, t.deps), UserError, "not waiting");
  assertEquals(linkFor(t.tables, OTHER)?.status, "review");
});

Deno.test("a failed token removal keeps the row in review", async () => {
  const t = setup({ userId: ADMIN, links: [{ profile_id: OTHER, upn: "x@abc.ae", status: "review" }], fail: { "rpc.ms_token_delete": { code: "XX", message: "down" } } });
  await assertRejects(() => handle("user_links_review", { profile_id: OTHER, decision: "accept", upn: "x@abc.ae" }, t.deps), UserError);
  assertEquals(linkFor(t.tables, OTHER)?.status, "review");
});

Deno.test("rejecting a review row sets revoked and logs it", async () => {
  const t = setup({ userId: ADMIN, links: [{ profile_id: OTHER, upn: "x@abc.ae", status: "review" }] });
  assertEquals(await handle("user_links_review", { profile_id: OTHER, decision: "reject" }, t.deps), { ok: true, status: "revoked" });
  assertEquals(linkFor(t.tables, OTHER)?.status, "revoked");
  assertEquals(t.tables.microsoft_sync_log[0].status, "reject");
});

Deno.test("user_links_review refuses bad input and rows that are not in review", async () => {
  const t = setup({ userId: ADMIN, links: [{ profile_id: OTHER, upn: "x@abc.ae", status: "active" }] });
  await assertRejects(() => handle("user_links_review", { profile_id: OTHER, decision: "maybe" }, t.deps), UserError, "accept or reject");
  await assertRejects(() => handle("user_links_review", { decision: "accept" }, t.deps), UserError, "Choose a person");
  await assertRejects(() => handle("user_links_review", { profile_id: OTHER, decision: "reject" }, t.deps), UserError, "not waiting");
});

Deno.test("secret_expiry_set stores a valid date or null, for admins, and refuses anything else", async () => {
  const t = setup({ userId: ADMIN, connection: active });
  await handle("secret_expiry_set", { date: "2027-02-28" }, t.deps);
  assertEquals(t.tables.microsoft_connection[0].client_secret_expires_on, "2027-02-28");
  assertEquals(t.tables.microsoft_connection[0].status, "active");
  await handle("secret_expiry_set", { date: null }, t.deps);
  assertEquals(t.tables.microsoft_connection[0].client_secret_expires_on, null);
  for (const date of ["2027-02-30", "2027-13-01", "tomorrow", "", 20270101, undefined]) {
    await assertRejects(() => handle("secret_expiry_set", { date }, t.deps), UserError, "valid date");
  }
  assertEquals(t.tables.microsoft_connection[0].client_secret_expires_on, null);
});

Deno.test("admin_test reads /me through the caller's stored token", async () => {
  const replies = [
    new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }), { status: 200 }),
    new Response(JSON.stringify({ displayName: "Admin", userPrincipalName: "admin@abc.ae", mail: "hidden" }), { status: 200 }),
  ];
  const t = setup({ userId: ADMIN, connection: active, links: [{ profile_id: ADMIN, status: "active" }], reply: () => replies.shift()! });
  t.vault.set(ADMIN, "rt");
  assertEquals(await handle("admin_test", {}, t.deps), { connected: true, display_name: "Admin", upn: "admin@abc.ae" });
  assert(t.fetches[0].url.endsWith(`/${TENANT}/oauth2/v2.0/token`));
  assert(t.fetches[1].url.startsWith("https://graph.microsoft.com/v1.0/me"));
});

Deno.test("admin_test says so when the admin is not connected or Graph refuses", async () => {
  const none = setup({ userId: ADMIN, connection: active });
  const out = await handle("admin_test", {}, none.deps) as { connected: boolean; message: string };
  assertEquals(out.connected, false);
  assertEquals(none.fetches.length, 0);

  const replies = [
    new Response(JSON.stringify({ access_token: "at" }), { status: 200 }),
    new Response(JSON.stringify({ error: { code: "Forbidden", message: "secret detail" } }), { status: 403 }),
  ];
  const t = setup({ userId: ADMIN, connection: active, links: [{ profile_id: ADMIN, status: "active" }], reply: () => replies.shift()! });
  t.vault.set(ADMIN, "rt");
  const refused = await handle("admin_test", {}, t.deps);
  assertEquals((refused as { connected: boolean }).connected, false);
  assert(!JSON.stringify(refused).includes("secret detail"));
});

Deno.test("a revoked refresh token deletes the token and sets the link to revoked", async () => {
  const t = setup({ links: [{ profile_id: MEMBER, status: "active" }], reply: () => errorReply("invalid_grant") });
  t.vault.set(MEMBER, "rt");
  const graph = await graphFor(t.deps, MEMBER);
  await assertRejects(() => graph.request("GET", "/me"));
  assertEquals(t.vault.has(MEMBER), false);
  assertEquals(linkFor(t.tables, MEMBER)?.status, "revoked");
});

Deno.test("Graph rotation saves the new refresh token", async () => {
  const replies = [
    new Response(JSON.stringify({ access_token: "at", refresh_token: "rt-2" }), { status: 200 }),
    new Response(JSON.stringify({}), { status: 200 }),
  ];
  const t = setup({ links: [{ profile_id: MEMBER, status: "active" }], reply: () => replies.shift()! });
  t.vault.set(MEMBER, "rt");
  await (await graphFor(t.deps, MEMBER)).request("GET", "/me");
  assertEquals(t.vault.get(MEMBER), "rt-2");
});

// ---------------------------------------------------------------- connection_status

function keys(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(keys);
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]);
  return [];
}

const fullConnection = {
  status: "active", tenant_id: TENANT, connected_by: ADMIN, consented_at: "2026-11-01T00:00:00Z", client_secret_expires_on: "2027-01-01",
};

Deno.test("connection_status has no field named like token or secret, for member or admin", async () => {
  const links = [{ profile_id: ADMIN, upn: "admin@abc.ae", status: "active" }, { profile_id: MEMBER, upn: "member@abc.ae", status: "active" }];
  for (const userId of [ADMIN, MEMBER]) {
    const t = setup({ userId, connection: fullConnection, links });
    t.vault.set(userId, "rt-value");
    const out = await handle("connection_status", {}, t.deps);
    for (const k of keys(out)) assert(!/token|secret/i.test(k), `field ${k}`);
    assert(!JSON.stringify(out).includes("rt-value"));
  }
});

Deno.test("connection_status gives a member only their own link and the overall status", async () => {
  const t = setup({ connection: fullConnection, links: [{ profile_id: MEMBER, upn: "member@abc.ae", status: "active" }, { profile_id: OTHER, upn: "o@abc.ae", status: "active" }] });
  t.vault.set(MEMBER, "rt");
  assertEquals(await handle("connection_status", {}, t.deps), {
    status: "active",
    link: { status: "active", upn: "member@abc.ae" },
    needs_connect: false,
  });
});

Deno.test("connection_status gives an admin the expiry date and the per-person list", async () => {
  const t = setup({ userId: ADMIN, connection: fullConnection, links: [{ profile_id: MEMBER, upn: "member@abc.ae", status: "review", updated_at: "u" }] });
  const out = await handle("connection_status", {}, t.deps) as { admin: Record<string, unknown>; needs_connect: boolean; link: unknown };
  assertEquals(out.admin.credential_expires_on, "2027-01-01");
  assertEquals(out.admin.tenant_id, TENANT);
  assertEquals(out.admin.links, [{ profile_id: MEMBER, upn: "member@abc.ae", status: "review", updated_at: "u" }]);
  assertEquals(out.link, null);
  assertEquals(out.needs_connect, true);
});

Deno.test("connection_status asks to connect again for an accepted link with no stored sign-in", async () => {
  const t = setup({ connection: active, links: [{ profile_id: MEMBER, upn: "x@abc.ae", status: "active" }] });
  const out = await handle("connection_status", {}, t.deps) as { needs_connect: boolean };
  assertEquals(out.needs_connect, true);
});

Deno.test("connection_status reads as not_connected before any row exists", async () => {
  const t = setup();
  assertEquals(await handle("connection_status", {}, t.deps), { status: "not_connected", link: null, needs_connect: true });
});

// ---------------------------------------------------------------- errors

Deno.test("an unknown action is refused", async () => {
  await assertRejects(() => handle("nope", {}, setup().deps), UserError, "Unknown action");
});

Deno.test("browserMessage gives a general message", () => {
  assertEquals(browserMessage(new Error("db password=abc")), "Something went wrong talking to Microsoft.");
});
