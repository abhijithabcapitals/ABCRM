// What the messenger-inbox function does, with its outside calls passed in so tests can run it.
// A refused request answers with a plain sentence, safe to show. Tokens never leave this function, in a reply or a log.
import { type Http, identify, metaSignatureOk, parseInstagram, parseTelegram, parseWhatsApp, sameText, sendText, telegramDeleteWebhook, telegramSetWebhook } from "./channels.ts";

export class Refused extends Error {}

const CHANNELS = new Set(["whatsapp", "telegram", "instagram"]);
const META = new Set(["whatsapp", "instagram"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_ACCEPTED = "The platform did not accept this. Check the details and try again.";

type Result = { data: unknown; error: { code?: string; message?: string } | null };
export type Account = { id: string; channel: string; external_id: string };
export type Deps = {
  userRpc: (fn: string, args?: Record<string, unknown>) => Promise<Result>;      // as the signed-in person: the database decides
  serviceRpc: (fn: string, args: Record<string, unknown>) => Promise<Result>;
  account: (id: string) => Promise<Account | null>;
  http: Http;
  randomSecret: () => string;
  webhookUrl: (accountId: string) => string;
  note: (message: string) => void;
};

const id = (value: unknown) => {
  if (typeof value !== "string" || !UUID.test(value)) throw new Refused("This request is not valid.");
  return value;
};
const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

async function requireAdmin(deps: Deps) {
  const { error } = await deps.userRpc("messenger_inbox_admin_list");
  if (error) throw new Refused("Only an admin can manage connected accounts.");
}
async function secret(deps: Deps, account: string, key: string): Promise<string | null> {
  const { data, error } = await deps.serviceRpc("messenger_inbox_secret_get", { p_account: account, p_key: key });
  return error || typeof data !== "string" ? null : data;
}
const setSecret = async (deps: Deps, account: string, key: string, value: string) => {
  const { error } = await deps.serviceRpc("messenger_inbox_secret_set", { p_account: account, p_key: key, p_value: value });
  if (error) throw new Error("Could not save a secret");
};
const webhookInfo = async (deps: Deps, account: Account) => ({
  webhook_url: META.has(account.channel) ? deps.webhookUrl(account.id) : null,
  verify_token: META.has(account.channel) ? await secret(deps, account.id, "verify") : null,
});

export async function handle(body: Record<string, unknown>, deps: Deps): Promise<Record<string, unknown>> {
  if (body.action === "connect") {
    const channel = text(body.channel, 20);
    const label = text(body.label, 80);
    const token = text(body.token, 2000);
    const externalId = text(body.external_id, 100);
    const appSecret = text(body.app_secret, 500);
    if (!CHANNELS.has(channel)) throw new Refused("This channel cannot be connected.");
    if (!label || !token) throw new Refused("Enter a name and a token.");
    if (channel === "whatsapp" && !externalId) throw new Refused("Enter the phone number ID.");
    if (META.has(channel) && !appSecret) throw new Refused("Enter the app secret.");
    await requireAdmin(deps);

    const found = await identify(channel, { token, externalId }, deps.http).catch(() => null);
    if (!found) throw new Refused(NOT_ACCEPTED);
    const { data, error } = await deps.userRpc("messenger_inbox_connect", { p_channel: channel, p_label: label, p_external_id: found.externalId, p_display_name: found.displayName });
    if (error) throw new Refused(error.message === "This account is already connected" ? error.message : "Could not connect this account. Please try again.");
    const account = data as string;

    try {
      const verify = deps.randomSecret();
      await setSecret(deps, account, "token", token);
      await setSecret(deps, account, "verify", verify);
      if (appSecret) await setSecret(deps, account, "app_secret", appSecret);
      if (channel === "telegram" && !(await telegramSetWebhook(token, deps.webhookUrl(account), verify, deps.http))) throw new Error("Webhook refused");
    } catch {
      // Half a connection is worse than none.
      await deps.userRpc("messenger_inbox_disconnect", { p_account: account });
      throw new Refused(NOT_ACCEPTED);
    }
    return { account_id: account, display_name: found.displayName, ...(await webhookInfo(deps, { id: account, channel, external_id: found.externalId })) };
  }

  if (body.action === "info" || body.action === "test" || body.action === "disconnect") {
    const accountId = id(body.account_id);
    await requireAdmin(deps);
    const account = await deps.account(accountId);
    if (!account) throw new Refused("This account is no longer connected.");
    if (body.action === "info") return await webhookInfo(deps, account);
    const token = await secret(deps, account.id, "token");
    if (body.action === "test") {
      const found = token ? await identify(account.channel, { token, externalId: account.external_id }, deps.http).catch(() => null) : null;
      return { ok: !!found, display_name: found?.displayName ?? null };
    }
    if (token && account.channel === "telegram") await telegramDeleteWebhook(token, deps.http).catch(() => deps.note("Telegram webhook not removed"));
    const { error } = await deps.userRpc("messenger_inbox_disconnect", { p_account: account.id });
    if (error) throw new Refused("Could not remove this account. Please try again.");
    return { ok: true, meta_webhook_left: META.has(account.channel) };
  }

  if (body.action === "send") {
    const thread = id(body.thread_id);
    const message = typeof body.body === "string" ? body.body : "";
    const { data, error } = await deps.userRpc("messenger_inbox_send_begin", { p_thread: thread, p_body: message });
    // Only sentences written for people pass through. A login failure's 42501 names database objects, so it does not.
    if (error) throw new Refused(error.code === "P0001" || error.message?.startsWith("You do not have access") ? error.message || "Your message was not sent." : "Your message was not sent. Please try again.");
    const row = (Array.isArray(data) ? data[0] : null) as { message_id: string; account_id: string; channel: string; account_external_id: string; thread_external_id: string } | null;
    if (!row) throw new Refused("Your message was not sent. Please try again.");
    const token = await secret(deps, row.account_id, "token");
    const sent = token
      ? await sendText(row.channel, { token, accountId: row.account_external_id, threadId: row.thread_external_id, body: message }, deps.http).catch(() => null)
      : null;
    await deps.serviceRpc("messenger_inbox_send_done", { p_message: row.message_id, p_external_id: sent, p_ok: !!sent });
    if (!sent) throw new Refused(NOT_ACCEPTED);
    return { ok: true, message_id: row.message_id };
  }

  throw new Refused("This request is not valid.");
}

// Meta's check when a webhook is first set up: it must echo the challenge, only for the right token.
export async function webhookVerify(accountId: string, params: URLSearchParams, deps: Deps): Promise<string | null> {
  if (!UUID.test(accountId) || params.get("hub.mode") !== "subscribe") return null;
  const account = await deps.account(accountId);
  if (!account || !META.has(account.channel)) return null;
  const expected = await secret(deps, account.id, "verify");
  const given = params.get("hub.verify_token") || "";
  return expected && sameText(given, expected) ? params.get("hub.challenge") : null;
}

// A webhook from a platform. Nothing is read or stored until its signature is proved. Returns the HTTP status.
export async function webhookReceive(accountId: string, rawBody: string, headers: Headers, deps: Deps): Promise<number> {
  if (!UUID.test(accountId)) return 404;
  const account = await deps.account(accountId);
  if (!account) return 404;
  if (account.channel === "telegram") {
    const expected = await secret(deps, account.id, "verify");
    if (!expected || !sameText(headers.get("x-telegram-bot-api-secret-token") || "", expected)) return 401;
  } else {
    const appSecret = await secret(deps, account.id, "app_secret");
    if (!appSecret || !(await metaSignatureOk(rawBody, headers.get("x-hub-signature-256"), appSecret))) return 401;
  }
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(rawBody); } catch { return 400; }
  const messages = account.channel === "telegram" ? parseTelegram(payload)
    : account.channel === "whatsapp" ? parseWhatsApp(payload, account.external_id)
      : parseInstagram(payload, account.external_id);
  for (const m of messages) {
    const { error } = await deps.serviceRpc("messenger_inbox_store", {
      p_account: account.id, p_thread_external: m.threadId, p_contact: m.contact, p_message_external: m.messageId, p_body: m.body, p_at: m.at,
    });
    if (error) {
      deps.note("A message could not be stored");
      return 500;   // the platform retries, and a repeat cannot store twice
    }
  }
  return 200;
}
