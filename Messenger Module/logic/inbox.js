// Rules for the Inbox. Pure functions only, no imports.

// Email reads the CRM's own mail store. The others open the platform until their official connection is built.
export const CHANNELS = [
  { key: "email", label: "Email" },
  { key: "whatsapp", label: "WhatsApp", href: "https://web.whatsapp.com/", note: "Not connected yet. An admin can connect a WhatsApp Business number in Settings. Until then, WhatsApp opens in your browser." },
  { key: "telegram", label: "Telegram", href: "https://web.telegram.org/", note: "Not connected yet. An admin can connect a company bot in Settings. It can answer people who message it, but cannot read personal chats. Until then, Telegram opens in your browser." },
  { key: "instagram", label: "Instagram", href: "https://www.instagram.com/direct/inbox/", note: "Not connected yet. An admin can connect a professional account in Settings. Until then, Instagram opens in your browser." },
  { key: "linkedin", label: "LinkedIn", href: "https://www.linkedin.com/messaging/", note: "LinkedIn only lets approved partners connect an inbox, so messages cannot appear here. LinkedIn opens in your browser." },
];

export const MAIL_WINDOW_DAYS = 15; // the CRM holds this much mail; older mail stays on the mail server

export const windowStart = (now = Date.now()) => new Date(now - MAIL_WINDOW_DAYS * 86400000).toISOString();

// Characters with a meaning in a database filter or a LIKE pattern are dropped, so a search stays a plain search.
export const cleanSearch = (text) => (text || "").replace(/[%_,()\\*"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);

// Who the conversation is with: its people, without the mailbox itself.
export function threadPeople(thread, mailboxAddress) {
  const me = (mailboxAddress || "").toLowerCase();
  const others = (thread.participants || []).filter((p) => p && !p.toLowerCase().includes(me || "\u0000"));
  return (others.length ? others : thread.participants || []).join(", ") || "Unknown";
}

export const senderLabel = (m) => m.from_name || m.from_address || "Unknown sender";

// Mail with no plain text is shown in a sandbox that runs no script, follows no form and loads nothing remote, so a tracking image cannot report that it was read.
export function sandboxDoc(html) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"><base target="_blank"></head><body>${html || ""}</body></html>`;
}

// What each channel asks for in Settings. Names only: values go straight to the function.
export const CONNECT_INFO = {
  whatsapp: {
    label: "WhatsApp",
    meta: true,
    steps: ["In your Meta app, add WhatsApp and a Business number. A personal WhatsApp account cannot connect.", "Copy the phone number ID, a permanent access token, and the app secret below.", "After connecting, paste the Callback URL and Verify token into the app's Webhooks, and subscribe to messages."],
    fields: [{ key: "label", label: "Name for this account" }, { key: "external_id", label: "Phone number ID", max: 100 }, { key: "token", label: "Access token", secret: true, max: 2000 }, { key: "app_secret", label: "App secret", secret: true, max: 500 }],
  },
  telegram: {
    label: "Telegram",
    steps: ["In Telegram, message @BotFather, send /newbot, and copy the token it gives you.", "Paste it below. The webhook is set for you.", "People reach you by messaging this bot. A bot cannot message someone first or read personal chats."],
    fields: [{ key: "label", label: "Name for this account" }, { key: "token", label: "Bot token", secret: true, max: 2000 }],
  },
  instagram: {
    label: "Instagram",
    meta: true,
    steps: ["Use an Instagram professional account you own, and a Meta app with Instagram messaging.", "Copy its access token and the app secret below.", "After connecting, paste the Callback URL and Verify token into the app's Instagram webhooks, and subscribe to messages."],
    fields: [{ key: "label", label: "Name for this account" }, { key: "token", label: "Access token", secret: true, max: 2000 }, { key: "app_secret", label: "App secret", secret: true, max: 500 }],
  },
};

export function connectProblem(channel, values) {
  for (const f of CONNECT_INFO[channel]?.fields || []) {
    if (!(values[f.key] || "").trim()) return `Enter the ${f.label.toLowerCase()}.`;
  }
  return null;
}

// WhatsApp and Instagram allow a free reply for 24 hours after the person's last message. Telegram has no such limit.
export function replyWindowOpen(thread, channel, now = Date.now()) {
  if (channel !== "whatsapp" && channel !== "instagram") return true;
  return !!thread.last_inbound_at && now - Date.parse(thread.last_inbound_at) < 24 * 3600 * 1000;
}

export const contactLabel = (thread) => thread.contact_name || thread.external_id || "Unknown";
