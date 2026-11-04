import { chatTitle } from "./chat.js";

// The sections of the full Messenger page, in app bar order. A section with a phase is not built yet.
export const SECTIONS = [
  { key: "activity", label: "Activity", phase: 1, note: "Mentions, replies and reactions meant for you will collect here." },
  { key: "chats", label: "Chats" },
  { key: "teams", label: "Teams", phase: 2, note: "Teams and their channels will live here, with threaded posts." },
  { key: "calendar", label: "Calendar", phase: 5, note: "Your meetings will show here by day and week." },
  { key: "calls", label: "Calls", phase: 4, note: "Audio and video calls and your call history will live here." },
  { key: "files", label: "Files", phase: 1, note: "Files shared in your chats will be listed here." },
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

// Matches the chat's name only. Searching message text comes with phase 1.
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
