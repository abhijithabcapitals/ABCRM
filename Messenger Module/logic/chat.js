// Chat rules for the team chat bubble. Pure functions only, no imports.

export const MAX_BODY = 4000;

export function badgeText(total) {
  if (!(total > 0)) return "";
  return total > 99 ? "99+" : String(total);
}

export function totalUnread(rows) {
  return rows.reduce((sum, r) => sum + (r.unread || 0), 0);
}

export function checkBody(text) {
  if (!text || !text.trim()) return "Write a message first.";
  if (text.length > MAX_BODY) return `Messages can be at most ${MAX_BODY} characters.`;
  return null;
}

export function checkWebLink(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return "Enter a full web address starting with https://."; }
  if (parsed.protocol !== "https:") return "Only https:// links can be shared.";
  return null;
}

// Replaces a row with the same id (so a sent message and its Realtime copy stay one), keeps time order.
export function mergeMessage(list, message) {
  const out = list.filter((m) => m.id !== message.id);
  out.push(message);
  return out.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

export function tickState(message, myId, othersReadAt) {
  if (message.sender_id !== myId) return null;
  if (message.status === "sending") return "sending";
  if (message.status === "failed") return "failed";
  if (othersReadAt && Date.parse(othersReadAt) >= Date.parse(message.created_at)) return "read";
  return "sent";
}

const DUBAI_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" });

export function dayKey(iso) {
  return DUBAI_DAY.format(new Date(iso));
}

export function senderName(name) {
  return name || "Former staff";
}

export function chatTitle(row) {
  if (row.kind === "group") return row.title;
  return row.other_name || "Former staff";
}

export function previewText(row, myId) {
  const text = row.last_body || row.last_link_label || "";
  if (!text) return "";
  if (row.last_sender_id === myId) return `You: ${text}`;
  if (row.kind === "group") return `${senderName(row.last_sender_name)}: ${text}`;
  return text;
}

// Pop-ups opened by the panel render inside the panel element, so a click outside both means collapse.
export function shouldCollapse(target, panelEl, bubbleEl) {
  if (!panelEl) return false;
  if (panelEl.contains(target)) return false;
  if (bubbleEl && bubbleEl.contains(target)) return false;
  return true;
}

// Catch-up with the newest page (newest first from the service). When the page shares no message with
// the loaded ones, a gap lies between them, so the page replaces the loaded messages; sending and failed
// ones are kept because the database does not have them yet.
export function catchUp(current, page) {
  const ids = new Set(current.map((m) => m.id));
  const replaced = current.length > 0 && page.length > 0 && !page.some((m) => ids.has(m.id));
  const base = replaced ? current.filter((m) => m.status === "sending" || m.status === "failed") : current;
  const messages = [...page].reverse().reduce((acc, m) => mergeMessage(acc, m), base);
  return { messages, replaced };
}

// A direct chat whose other person was deleted: nobody is left to write to.
export function personLeft(row) {
  return row.kind === "direct" && !row.other_id;
}
