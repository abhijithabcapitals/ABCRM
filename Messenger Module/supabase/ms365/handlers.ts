// Actions for the ms365 Edge Function. Kept free of Deno and Supabase imports so tests can run offline.
// Refresh tokens stay in Vault. Nothing here returns or logs a token, code, ID token or client secret.

import { authorizeUrl, linkStatus, PHASE2_SCOPES, pkceFrom, readIdToken, signState, StateError, tenantAuthority, verifyState } from "./auth.ts";
import { createGraph, GraphError, NotConnectedError } from "./graph.ts";

export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

// A database or Vault failure. Holds the code only, as the message can quote values.
class DbFailure extends Error {
  constructor(what: string, code: unknown) {
    super(`${what} failed (${typeof code === "string" ? code : "unknown"}).`);
    this.name = "DbFailure";
  }
}

// deno-lint-ignore no-explicit-any
type Json = any;

export type BaseDeps = {
  // Service-role Supabase client.
  db: Json;
  // Reads a setting. Throws MissingSecretError when it is not set.
  secret(name: string): Promise<string>;
  fetch: typeof fetch;
  sleep(ms: number): Promise<void>;
  now(): number;
  // The function's own address, built from SUPABASE_URL.
  redirectUri: string;
  // Server log. Receives error names and codes only.
  note(message: string): void;
};

export type Deps = BaseDeps & {
  isAdmin(): Promise<boolean>;
  userId: string;
};

// The only error text the browser sees for an unexpected failure. Raw detail stays in the server log.
export function browserMessage(_e: unknown): string {
  return "Something went wrong talking to Microsoft.";
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const isoNow = (deps: BaseDeps) => new Date(deps.now()).toISOString();
const sameTenant = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

type LogEntry = { action: string; status: string; error_code?: string; actor?: string | null; detail?: Record<string, unknown> };

// Logging must never break the action it records.
async function logEvent(deps: BaseDeps, e: LogEntry): Promise<void> {
  try {
    const { error } = await deps.db.from("microsoft_sync_log").insert({
      action: e.action,
      status: e.status,
      error_code: e.error_code ?? null,
      actor: e.actor ?? null,
      detail: e.detail ?? null,
    });
    if (error) deps.note(`ms365: log write failed (${error.code})`);
  } catch (err) {
    deps.note(`ms365: log write failed (${(err as Error)?.name})`);
  }
}

async function readConnection(deps: BaseDeps): Promise<Json | null> {
  const { data, error } = await deps.db.from("microsoft_connection").select("*").eq("id", true).maybeSingle();
  if (error) throw new DbFailure("Reading the connection", error.code);
  return data;
}

async function readLink(deps: BaseDeps, profileId: string): Promise<Json | null> {
  const { data, error } = await deps.db
    .from("microsoft_user_links")
    .select("profile_id, microsoft_user_id, upn, status")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw new DbFailure("Reading the link", error.code);
  return data;
}

async function deleteToken(deps: BaseDeps, profileId: string): Promise<void> {
  const { error } = await deps.db.rpc("ms_token_delete", { p_profile: profileId });
  if (error) throw new DbFailure("Removing the sign-in", error.code);
}

async function setLinkStatus(deps: BaseDeps, profileId: string, status: string): Promise<void> {
  const { error } = await deps.db
    .from("microsoft_user_links")
    .update({ status, updated_at: isoNow(deps) })
    .eq("profile_id", profileId);
  if (error) throw new DbFailure("Saving the link", error.code);
}

// Every move to revoked goes through here. Clearing the Microsoft ID frees that account for its real owner,
// as a revoked row must not hold it under the unique rule. The caller logs the old values.
async function revokeLink(deps: BaseDeps, profileId: string): Promise<void> {
  const { error } = await deps.db
    .from("microsoft_user_links")
    .update({ status: "revoked", microsoft_user_id: null, updated_at: isoNow(deps) })
    .eq("profile_id", profileId);
  if (error) throw new DbFailure("Saving the link", error.code);
}

// What a revoked row no longer holds, for the log.
const linkAudit = (link: Json) => ({ upn: link?.upn ?? null, microsoft_user_id: link?.microsoft_user_id ?? null });

// A Graph client for one person. Only an active link ever yields a token.
export async function graphFor(deps: BaseDeps, profileId: string) {
  const [tenantId, clientId, clientSecret] = await Promise.all([
    deps.secret("MICROSOFT_TENANT_ID"),
    deps.secret("MICROSOFT_CLIENT_ID"),
    deps.secret("MICROSOFT_CLIENT_SECRET"),
  ]);
  return createGraph({
    tokenUrl: `${tenantAuthority(tenantId)}/token`,
    clientId,
    clientSecret,
    loadToken: async () => {
      if ((await readLink(deps, profileId))?.status !== "active") return null;
      const { data, error } = await deps.db.rpc("ms_token_get", { p_profile: profileId });
      if (error) throw new DbFailure("Reading the sign-in", error.code);
      return typeof data === "string" && data ? data : null;
    },
    saveToken: async (t) => {
      const { error } = await deps.db.rpc("ms_token_set", { p_profile: profileId, p_token: t });
      if (error) throw new DbFailure("Saving the sign-in", error.code);
    },
    // The status goes first, so a failed delete still leaves a link that yields no token.
    onRevoked: async () => {
      const link = await readLink(deps, profileId);
      await revokeLink(deps, profileId);
      await deleteToken(deps, profileId);
      await logEvent(deps, { action: "link_revoked", status: "ok", actor: profileId, detail: linkAudit(link) });
    },
    // Only failures are kept, so normal use does not fill the table.
    log: async (e) => {
      if (e.status !== "ok") await logEvent(deps, { ...e, actor: profileId });
    },
    fetch: deps.fetch,
    sleep: deps.sleep,
  });
}

// ---------------------------------------------------------------- browser actions

async function requireAdmin(deps: Deps) {
  if (!(await deps.isAdmin())) throw new UserError("Only a CRM admin can do this.");
}

function validDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export async function handle(action: string, body: Json, deps: Deps): Promise<object> {
  try {
    return await run(action, body ?? {}, deps);
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === "MissingSecretError" || name === "TenantError") throw new UserError((e as Error).message);
    throw e;
  }
}

async function run(action: string, body: Json, deps: Deps): Promise<object> {
  if (action === "connection_status") return await connectionStatus(deps);

  // The profile is always the caller. Anything in the body is ignored.
  if (action === "connect_start") {
    const connection = await readConnection(deps);
    if (connection?.status !== "active" && !(await deps.isAdmin())) {
      throw new UserError("An admin must connect Microsoft first.");
    }
    const [key, tenantId, clientId] = await Promise.all([
      deps.secret("MICROSOFT_STATE_SECRET"),
      deps.secret("MICROSOFT_TENANT_ID"),
      deps.secret("MICROSOFT_CLIENT_ID"),
    ]);
    const state = await signState(key, deps.userId, deps.now());
    const { nonce } = await verifyState(key, state, deps.now());
    const { challenge } = await pkceFrom(key, nonce);
    return { url: authorizeUrl({ tenantId, clientId, redirectUri: deps.redirectUri }, state, challenge, PHASE2_SCOPES) };
  }

  if (action === "disconnect") {
    let link: Json = null;
    try {
      link = await readLink(deps, deps.userId);
      await deleteToken(deps, deps.userId);
      await revokeLink(deps, deps.userId);
    } catch (e) {
      deps.note(`ms365: disconnect: ${(e as Error)?.message}`);
      await logEvent(deps, { action: "disconnect", status: "error", error_code: "db_error", actor: deps.userId });
      throw new UserError("Could not disconnect Microsoft. Try again.");
    }
    await logEvent(deps, { action: "disconnect", status: "ok", actor: deps.userId, detail: linkAudit(link) });
    return { ok: true };
  }

  if (action === "admin_test") {
    await requireAdmin(deps);
    const graph = await graphFor(deps, deps.userId);
    try {
      const me = await graph.request("GET", "/me?$select=displayName,userPrincipalName");
      return { connected: true, display_name: me?.displayName ?? null, upn: me?.userPrincipalName ?? null };
    } catch (e) {
      if (e instanceof NotConnectedError) return { connected: false, message: "Connect your own Microsoft account first." };
      if (e instanceof GraphError) return { connected: false, message: "Microsoft refused the test.", code: e.code };
      throw e;
    }
  }

  if (action === "user_links_review") {
    await requireAdmin(deps);
    return await reviewLink(body, deps);
  }

  if (action === "secret_expiry_set") {
    await requireAdmin(deps);
    const date = body.date;
    if (date !== null && !validDate(date)) throw new UserError("Enter a valid date, or clear it.");
    const { error } = await deps.db.from("microsoft_connection").upsert(
      { id: true, client_secret_expires_on: date, updated_at: isoNow(deps) },
      { onConflict: "id" },
    );
    if (error) throw new DbFailure("Saving the expiry date", error.code);
    await logEvent(deps, { action: "secret_expiry_set", status: "ok", actor: deps.userId, detail: { date } });
    return { ok: true, credential_expires_on: date };
  }

  throw new UserError("Unknown action.");
}

async function connectionStatus(deps: Deps): Promise<object> {
  const connection = await readConnection(deps);
  const link = await readLink(deps, deps.userId);

  // An accepted link has no sign-in until the person connects again. The value is only tested, never returned.
  let needsConnect = true;
  if (link?.status === "active") {
    const { data, error } = await deps.db.rpc("ms_token_get", { p_profile: deps.userId });
    if (error) throw new DbFailure("Reading the sign-in", error.code);
    needsConnect = !data;
  }

  const out: Record<string, unknown> = {
    status: connection?.status ?? "not_connected",
    link: link ? { status: link.status, upn: link.upn ?? null } : null,
    needs_connect: needsConnect,
  };
  if (await deps.isAdmin()) {
    const { data, error } = await deps.db
      .from("microsoft_user_links")
      .select("profile_id, upn, status, updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw new DbFailure("Reading the links", error.code);
    out.admin = {
      tenant_id: connection?.tenant_id ?? null,
      connected_by: connection?.connected_by ?? null,
      consented_at: connection?.consented_at ?? null,
      credential_expires_on: connection?.client_secret_expires_on ?? null,
      links: (data ?? []).map((l: Json) => ({ profile_id: l.profile_id, upn: l.upn ?? null, status: l.status, updated_at: l.updated_at })),
    };
  }
  return out;
}

// An accept carries the UPN the admin was shown, so a newer sign-in cannot be accepted unseen.
// It carries no sign-in forward either: the person connects again, and only then holds a token.
async function reviewLink(body: Json, deps: Deps): Promise<object> {
  const profileId = text(body.profile_id);
  const decision = body.decision;
  if (!profileId) throw new UserError("Choose a person first.");
  if (decision !== "accept" && decision !== "reject") throw new UserError("Choose accept or reject.");

  const row = await readLink(deps, profileId);
  const stale = !row || row.status !== "review" || (decision === "accept" && row.upn !== body.upn);
  if (stale) throw new UserError("That person is not waiting for review. Refresh the list.");

  try {
    await deleteToken(deps, profileId);
  } catch (e) {
    deps.note(`ms365: review: ${(e as Error)?.message}`);
    throw new UserError("Could not update that person. Try again.");
  }

  const status = decision === "accept" ? "active" : "revoked";
  let update = deps.db
    .from("microsoft_user_links")
    .update(decision === "accept" ? { status, updated_at: isoNow(deps) } : { status, microsoft_user_id: null, updated_at: isoNow(deps) })
    .eq("profile_id", profileId)
    .eq("status", "review");
  if (decision === "accept") update = update.eq("upn", row.upn);
  const { data, error } = await update.select("profile_id");
  if (error) throw new DbFailure("Saving the review", error.code);
  if (!data?.length) throw new UserError("That person is not waiting for review. Refresh the list.");

  await logEvent(deps, {
    action: "user_links_review",
    status: decision,
    actor: deps.userId,
    detail: { profile_id: profileId, ...linkAudit(row) },
  });
  return { ok: true, status };
}

// ---------------------------------------------------------------- Microsoft redirect

type Exchange =
  | { ok: true; refreshToken: string; idToken: string; scopes: string[] }
  | { ok: false; code: string };

// Failures come back as a code from a fixed shape: the reply, the URL and the request body are all dropped.
async function exchangeCode(
  deps: BaseDeps,
  cfg: { tenantId: string; clientId: string; clientSecret: string },
  code: string,
  verifier: string,
): Promise<Exchange> {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: deps.redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code_verifier: verifier,
    scope: PHASE2_SCOPES.join(" "),
  });
  let res: Response;
  try {
    res = await deps.fetch(`${tenantAuthority(cfg.tenantId)}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: form.toString(),
    });
  } catch (e) {
    if ((e as Error)?.name === "TenantError") throw e;
    return { ok: false, code: "network_error" };
  }
  let reply: Json = null;
  try {
    reply = await res.json();
  } catch {
    reply = null;
  }
  const err = typeof reply?.error === "string" ? reply.error : "";
  if (err) return { ok: false, code: /^[a-z_]{1,40}$/.test(err) ? err : "other" };
  if (!res.ok) return { ok: false, code: `http_${res.status}` };
  if (typeof reply?.refresh_token !== "string" || !reply.refresh_token || typeof reply?.id_token !== "string") {
    return { ok: false, code: "bad_response" };
  }
  const granted = typeof reply.scope === "string" ? reply.scope.split(/\s+/).filter(Boolean) : [];
  return { ok: true, refreshToken: reply.refresh_token, idToken: reply.id_token, scopes: granted.length ? granted : PHASE2_SCOPES };
}

function backAddress(app: string, query: Record<string, string>): string {
  const u = new URL(app);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new TypeError("MESSENGER_APP_URL is not a web address.");
  u.searchParams.set("view", "messenger");
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  return u.toString();
}

// Reached without a JWT, so nobody is trusted until the state verifies, and the state alone names the profile.
// Requests with a bad state write nothing to the database, so strangers cannot fill the log.
// Throws only when MESSENGER_APP_URL is unusable, as there is then nowhere safe to send the person.
export async function callback(params: URLSearchParams, deps: BaseDeps): Promise<{ redirect: string }> {
  const app = await deps.secret("MESSENGER_APP_URL");
  backAddress(app, {});
  const fail = (reason: string) => ({ redirect: backAddress(app, { ms: "error", reason }) });

  let profileId: string | null = null;
  const refuse = async (reason: string, code = reason) => {
    await logEvent(deps, { action: "connect_callback", status: "error", error_code: code, actor: profileId });
    return fail(reason);
  };

  try {
    const microsoftError = params.get("error");
    if (microsoftError !== null) {
      const reason = microsoftError === "access_denied" ? "denied" : "microsoft_error";
      profileId = await stateOwner(params, deps);
      return profileId ? await refuse(reason) : fail(reason);
    }

    const key = await deps.secret("MICROSOFT_STATE_SECRET");
    const { profileId: owner, nonce } = await verifyState(key, params.get("state") ?? "", deps.now());
    profileId = owner;

    const code = params.get("code");
    if (!code) return await refuse("failed", "no_code");

    const [tenantId, clientId, clientSecret] = await Promise.all([
      deps.secret("MICROSOFT_TENANT_ID"),
      deps.secret("MICROSOFT_CLIENT_ID"),
      deps.secret("MICROSOFT_CLIENT_SECRET"),
    ]);
    tenantAuthority(tenantId);

    const { data: profile, error: profileError } = await deps.db
      .from("profiles")
      .select("role, email")
      .eq("id", profileId)
      .maybeSingle();
    if (profileError) throw new DbFailure("Reading the profile", profileError.code);
    if (!profile) return await refuse("failed", "profile_missing");

    const connection = await readConnection(deps);
    const connectionActive = connection?.status === "active";
    if (!connectionActive && profile.role !== "admin") return await refuse("admin_first");

    const { verifier } = await pkceFrom(key, nonce);
    const exchange = await exchangeCode(deps, { tenantId, clientId, clientSecret }, code, verifier);
    if (!exchange.ok) {
      return exchange.code === "invalid_grant" ? await refuse("code_used") : await refuse("failed", exchange.code);
    }

    let id: { tid: string; oid: string; email: string };
    try {
      id = readIdToken(exchange.idToken);
    } catch {
      return await refuse("failed", "id_token_invalid");
    }

    // On every sign-in, the first admin connect included.
    if (!sameTenant(id.tid, tenantId)) return await refuse("wrong_tenant");
    if (connectionActive && connection.tenant_id && !sameTenant(id.tid, connection.tenant_id)) return await refuse("wrong_tenant");

    const { data: holder, error: holderError } = await deps.db
      .from("microsoft_user_links")
      .select("profile_id")
      .eq("microsoft_user_id", id.oid)
      .maybeSingle();
    if (holderError) throw new DbFailure("Reading the link", holderError.code);
    if (holder && holder.profile_id !== profileId) return await refuse("already_linked");

    const prior = await readLink(deps, profileId);
    // An accepted link matches only the same Microsoft account under the same UPN.
    const accepted = prior?.status === "active" && prior.microsoft_user_id === id.oid && linkStatus(id.email, prior.upn) === "active";
    const verdict = accepted ? "active" : linkStatus(id.email, profile.email);
    const row = { profile_id: profileId, microsoft_user_id: id.oid, upn: id.email, scopes: exchange.scopes, updated_at: isoNow(deps) };

    if (verdict === "review") {
      const { error } = await deps.db.from("microsoft_user_links").upsert({ ...row, status: "review" }, { onConflict: "profile_id" });
      if (error?.code === "23505") return await refuse("already_linked");
      if (error) throw new DbFailure("Saving the link", error.code);
      // Any earlier sign-in belongs to an identity that is no longer the one on this link.
      if (prior) await deleteToken(deps, profileId);
      await logEvent(deps, { action: "connect_callback", status: "review", actor: profileId, detail: { upn: id.email } });
      return { redirect: backAddress(app, { ms: "review" }) };
    }

    // The account is claimed first, so the unique rule settles a race before any token is stored.
    // Status stays as it was for the same account and is revoked for a new one, until the token is safely saved.
    const held = prior?.microsoft_user_id === id.oid ? prior.status : "revoked";
    const { error: claimError } = await deps.db.from("microsoft_user_links").upsert({ ...row, status: held }, { onConflict: "profile_id" });
    if (claimError?.code === "23505") return await refuse("already_linked");
    if (claimError) throw new DbFailure("Saving the link", claimError.code);

    try {
      const { error: tokenError } = await deps.db.rpc("ms_token_set", { p_profile: profileId, p_token: exchange.refreshToken });
      if (tokenError) throw new DbFailure("Saving the sign-in", tokenError.code);
      await setLinkStatus(deps, profileId, "active");
    } catch (e) {
      // A claim that did not complete must not keep the account.
      if (held === "revoked") await revokeLink(deps, profileId).catch(() => deps.note("ms365: could not release a link claim"));
      throw e;
    }

    if (!connectionActive) {
      const now = isoNow(deps);
      const { error } = await deps.db.from("microsoft_connection").upsert(
        { id: true, tenant_id: id.tid, status: "active", connected_by: profileId, consented_at: now, updated_at: now },
        { onConflict: "id" },
      );
      if (error) throw new DbFailure("Saving the connection", error.code);
    }

    await logEvent(deps, { action: "connect_callback", status: "ok", actor: profileId });
    return { redirect: backAddress(app, { ms: "connected" }) };
  } catch (e) {
    const name = (e as Error)?.name;
    if (e instanceof StateError) return fail("expired");
    if (name === "MissingSecretError" || name === "TenantError") {
      deps.note(`ms365: callback not configured: ${(e as Error).message}`);
      return await refuse("not_configured");
    }
    // A DbFailure message holds a code only. Others are reduced to their name.
    deps.note(`ms365: callback: ${e instanceof DbFailure ? e.message : name}`);
    return await refuse("failed", "unexpected");
  }
}

// Whose sign-in Microsoft is reporting on, if the state proves it. Never throws.
async function stateOwner(params: URLSearchParams, deps: BaseDeps): Promise<string | null> {
  const state = params.get("state");
  if (!state) return null;
  try {
    const key = await deps.secret("MICROSOFT_STATE_SECRET");
    return (await verifyState(key, state, deps.now())).profileId;
  } catch {
    return null;
  }
}
