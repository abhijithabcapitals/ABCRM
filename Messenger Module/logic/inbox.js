// Rules for the Inbox. Pure functions only, no imports.

// Email reads the CRM's own mail store. The others open the platform until their official connection is built.
export const CHANNELS = [
  { key: "email", label: "Email" },
  { key: "whatsapp", label: "WhatsApp", href: "https://web.whatsapp.com/", note: "Not connected yet. A connection needs a WhatsApp Business number and Meta's approval. Until then, WhatsApp opens in your browser." },
  { key: "telegram", label: "Telegram", href: "https://web.telegram.org/", note: "Not connected yet. A connection would be a company bot, which can answer people who message it but cannot read personal chats. Until then, Telegram opens in your browser." },
  { key: "instagram", label: "Instagram", href: "https://www.instagram.com/direct/inbox/", note: "Not connected yet. A connection needs an Instagram professional account. Until then, Instagram opens in your browser." },
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
