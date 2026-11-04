// Rules for the Windows app. Pure functions only, no imports.

const PREFS = "abm-prefs";
export const DEFAULT_PREFS = { notifications: true, preview: true };

export function readPrefs() {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS)) }; } catch { return DEFAULT_PREFS; }
}
export function savePrefs(prefs) {
  try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch { /* still applies until the app closes */ }
}

// Only a new message from someone else, while this person is not looking, and not one they asked to be spared.
export function shouldNotify({ message, change, me, muted, focused, status, prefs }) {
  if (change || !message || message.sender_id === me || message.deleted_at) return false;
  return !muted && !focused && status !== "dnd" && !!prefs.notifications;
}

// Text is cut short for the notification. With previews off, nothing from the message leaves the app.
export function notificationText({ message, title, prefs }) {
  const body = prefs.preview ? (message.body || "").replace(/\s+/g, " ").trim().slice(0, 160) : "New message";
  return { title: title || "New message", body: body || "New message" };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// abmessenger://chat/<id> or abmessenger://channel/<id>. Anything else is ignored, as any program or web page can send these links.
export function parseAppLink(link) {
  let url;
  try { url = new URL(link); } catch { return null; }
  if (url.protocol !== "abmessenger:") return null;
  const kind = url.hostname.toLowerCase();
  const id = url.pathname.replace(/^\/+/, "");
  if ((kind !== "chat" && kind !== "channel") || !UUID.test(id)) return null;
  return { conversation_id: id, conversation_kind: kind === "channel" ? "channel" : "chat", parent_id: null };
}
