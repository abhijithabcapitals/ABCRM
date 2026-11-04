import { chatTitle } from "./chat.js";

// The sections of the full Messenger page, in app bar order. A section with a phase is not built yet.
export const SECTIONS = [
  { key: "activity", label: "Activity" },
  { key: "inbox", label: "Inbox" },
  { key: "chats", label: "Chats" },
  { key: "teams", label: "Teams" },
  { key: "calendar", label: "Calendar", phase: 5, note: "Your meetings will show here by day and week." },
  { key: "calls", label: "Calls" },
  { key: "files", label: "Files" },
  { key: "settings", label: "Settings", menuOnly: true }, // opened from the status menu, not the bar
];

const KEYS = new Set(SECTIONS.map((s) => s.key));
const SAVED = "abm-section";
export const DEFAULT_SECTION = "chats";

export const validSection = (key) => (KEYS.has(key) ? key : DEFAULT_SECTION);

export function readSection() {
  try { return validSection(localStorage.getItem(SAVED)); } catch { return DEFAULT_SECTION; }
}
export function saveSection(key) {
  try { localStorage.setItem(SAVED, key); } catch { /* still applies until the page reloads */ }
}

// Matches the chat's name. Message text is searched separately, in the database.
export function filterChats(rows, query) {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => chatTitle(r).toLowerCase().includes(q));
}

// A time for today's messages, else a short date.
export function rowTime(iso, now = new Date()) {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toDateString() === now.toDateString()
    ? at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : at.toLocaleDateString([], { day: "numeric", month: "short" });
}
