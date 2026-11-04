// What each platform needs. Checked against the platforms' own documentation on 2026-11-04, but never yet run against a real account.
// A token may sit in a Telegram URL, so nothing here logs a URL or passes a platform's error text on.

export const META_VERSION = "v26.0";
export type Http = (url: string, init?: RequestInit) => Promise<Response>;
export type Creds = { token: string; externalId?: string };
export type Incoming = { threadId: string; contact: string | null; messageId: string; body: string; at: string | null };

const bearer = (token: string) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
const iso = (seconds: unknown) => {
  const n = Number(seconds);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
};
const placeholder = (kind: unknown) => `[${typeof kind === "string" && kind ? kind : "attachment"}: open the app to view]`;
async function json(res: Response): Promise<Record<string, unknown> | null> {
  try { return await res.json(); } catch { return null; }
}

// Confirms the token works, and says which account it belongs to. Null means the platform refused it.
export async function identify(channel: string, creds: Creds, http: Http): Promise<{ externalId: string; displayName: string | null } | null> {
  if (channel === "telegram") {
    const res = await http(`https://api.telegram.org/bot${creds.token}/getMe`);
    const data = await json(res);
    const bot = data?.result as { id?: number; username?: string } | undefined;
    return res.ok && bot?.id ? { externalId: String(bot.id), displayName: bot.username ? `@${bot.username}` : null } : null;
  }
  if (channel === "whatsapp") {
    if (!creds.externalId) return null;
    const res = await http(`https://graph.facebook.com/${META_VERSION}/${encodeURIComponent(creds.externalId)}?fields=display_phone_number,verified_name`, { headers: bearer(creds.token) });
    const data = await json(res);
    return res.ok && data ? { externalId: creds.externalId, displayName: (data.verified_name || data.display_phone_number || null) as string | null } : null;
  }
  if (channel === "instagram") {
    const res = await http(`https://graph.instagram.com/${META_VERSION}/me?fields=user_id,username`, { headers: bearer(creds.token) });
    const data = await json(res);
    return res.ok && data?.user_id ? { externalId: String(data.user_id), displayName: data.username ? `@${data.username}` : null } : null;
  }
  return null;
}

export async function telegramSetWebhook(token: string, url: string, secret: string, http: Http): Promise<boolean> {
  const res = await http(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, secret_token: secret, allowed_updates: ["message"] }),
  });
  return res.ok;
}
export async function telegramDeleteWebhook(token: string, http: Http): Promise<void> {
  await http(`https://api.telegram.org/bot${token}/deleteWebhook`, { method: "POST" });
}

// Sends one text message. Returns the platform's id, or null if it refused.
export async function sendText(channel: string, o: { token: string; accountId: string; threadId: string; body: string }, http: Http): Promise<string | null> {
  if (channel === "telegram") {
    const res = await http(`https://api.telegram.org/bot${o.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: o.threadId, text: o.body }),
    });
    const id = ((await json(res))?.result as { message_id?: number } | undefined)?.message_id;
    return res.ok && id ? `${o.threadId}:${id}` : null;
  }
  if (channel === "whatsapp") {
    const res = await http(`https://graph.facebook.com/${META_VERSION}/${encodeURIComponent(o.accountId)}/messages`, {
      method: "POST",
      headers: bearer(o.token),
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: o.threadId, type: "text", text: { preview_url: false, body: o.body } }),
    });
    const id = ((await json(res))?.messages as { id?: string }[] | undefined)?.[0]?.id;
    return res.ok && id ? id : null;
  }
  if (channel === "instagram") {
    const res = await http(`https://graph.instagram.com/${META_VERSION}/${encodeURIComponent(o.accountId)}/messages`, {
      method: "POST",
      headers: bearer(o.token),
      body: JSON.stringify({ recipient: { id: o.threadId }, message: { text: o.body } }),
    });
    const id = (await json(res))?.message_id as string | undefined;
    return res.ok && id ? id : null;
  }
  return null;
}

// Reads a webhook into plain messages. Anything else in it, such as delivery receipts, is ignored.
export function parseTelegram(update: Record<string, unknown>): Incoming[] {
  const m = update.message as Record<string, any> | undefined;
  if (!m?.chat?.id || !m.message_id || m.from?.is_bot) return [];
  const name = m.chat.title || [m.chat.first_name, m.chat.last_name].filter(Boolean).join(" ") || m.chat.username || null;
  const kind = ["photo", "document", "video", "voice", "audio", "sticker", "location", "contact"].find((k) => m[k]);
  return [{
    threadId: String(m.chat.id),
    contact: name,
    messageId: `${m.chat.id}:${m.message_id}`,
    body: m.text || m.caption || placeholder(kind),
    at: iso(m.date),
  }];
}

export function parseWhatsApp(payload: Record<string, unknown>, phoneNumberId: string): Incoming[] {
  const out: Incoming[] = [];
  for (const entry of (payload.entry as any[]) || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value;
      if (value?.metadata?.phone_number_id !== phoneNumberId) continue;
      const names = new Map((value.contacts || []).map((c: any) => [c.wa_id, c.profile?.name]));
      for (const m of value.messages || []) {
        if (!m?.id || !m.from) continue;
        out.push({
          threadId: String(m.from),
          contact: (names.get(m.from) as string) || null,
          messageId: m.id,
          body: m.text?.body || m[m.type]?.caption || placeholder(m.type),
          at: iso(m.timestamp),
        });
      }
    }
  }
  return out;
}

export function parseInstagram(payload: Record<string, unknown>, igId: string): Incoming[] {
  const out: Incoming[] = [];
  for (const entry of (payload.entry as any[]) || []) {
    if (String(entry?.id) !== igId) continue;
    for (const e of entry.messaging || []) {
      const m = e?.message;
      // An echo is the account's own message, seen back.
      if (!m?.mid || m.is_echo || !e.sender?.id) continue;
      const kind = m.attachments?.[0]?.type;
      out.push({
        threadId: String(e.sender.id),
        contact: null,
        messageId: m.mid,
        body: m.text || placeholder(kind),
        at: typeof e.timestamp === "number" ? new Date(e.timestamp).toISOString() : null,
      });
    }
  }
  return out;
}

const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

export function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Meta signs the exact bytes of each webhook with the app secret.
export async function metaSignatureOk(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return sameText(hex(await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody))), header.slice(7));
}
