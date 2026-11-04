// Rules for replies, reactions, mentions, files and presence. Pure functions only, no imports.

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "🙏"];

export const STATUSES = [
  { key: "available", label: "Available" },
  { key: "busy", label: "Busy" },
  { key: "dnd", label: "Do not disturb" },
  { key: "away", label: "Away" },
];
export const OFFLINE_AFTER_MS = 5 * 60 * 1000;

// The state to show for a person: their chosen status while their window is open, else offline.
export function presenceState(row, now = Date.now()) {
  if (!row || !row.last_seen_at) return "offline";
  return now - Date.parse(row.last_seen_at) > OFFLINE_AFTER_MS ? "offline" : row.status;
}
export function presenceLabel(state) {
  return STATUSES.find((s) => s.key === state)?.label || "Offline";
}

export function reactionList(reactions, me) {
  return Object.entries(reactions || {}).map(([emoji, who]) => ({ emoji, count: who.length, mine: who.includes(me) }));
}

// The text after an @ the caret is still typing in, or null. The @ must start a word.
export function mentionQuery(text, caret) {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0 || (at > 0 && !/\s/.test(before[at - 1]))) return null;
  const typed = before.slice(at + 1);
  return typed.includes("\n") || typed.length > 40 ? null : typed;
}

export function membersMatching(members, query, me, limit = 6) {
  const q = query.trim().toLowerCase();
  return members.filter((m) => m.profile_id !== me && m.full_name && m.full_name.toLowerCase().includes(q)).slice(0, limit);
}

// Replaces the @ being typed with the full name. Returns the new text and caret.
export function applyMention(text, caret, name) {
  const at = text.slice(0, caret).lastIndexOf("@");
  const inserted = `@${name} `;
  return { text: text.slice(0, at) + inserted + text.slice(caret), caret: at + inserted.length };
}

// Longest names first, so "@Sara Ali Khan" is not read as "@Sara Ali".
const byLength = (names) => [...names].sort((a, b) => b.length - a.length);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentionRule = (names) => new RegExp(`(^|\\s)@(${byLength(names).map(escape).join("|")})(?![\\w])`, "g");

export function mentionIdsIn(text, members) {
  const named = members.filter((m) => m.full_name);
  if (!named.length) return [];
  const found = new Set([...text.matchAll(mentionRule(named.map((m) => m.full_name)))].map((x) => x[2]));
  return named.filter((m) => found.has(m.full_name)).map((m) => m.profile_id);
}

// Splits a message into plain text and mentions, for showing. Every part stays a text node.
export function mentionParts(body, names) {
  const known = names.filter(Boolean);
  if (!known.length) return [{ text: body }];
  const parts = [];
  let from = 0;
  for (const x of body.matchAll(mentionRule(known))) {
    const start = x.index + x[1].length;
    if (start > from) parts.push({ text: body.slice(from, start) });
    parts.push({ text: `@${x[2]}`, mention: true });
    from = start + x[2].length + 1;
  }
  if (from < body.length) parts.push({ text: body.slice(from) });
  return parts;
}

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const BLOCKED_FILES = new Set(["exe", "bat", "cmd", "com", "msi", "scr", "ps1", "vbs", "js", "jar", "hta", "lnk", "dll"]);

export function fileProblem(file) {
  if (!file || !file.size) return "This file is empty.";
  if (file.size > MAX_FILE_BYTES) return "Files can be at most 25 MB.";
  if (file.name.length > 255) return "This file name is too long.";
  const ext = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "";
  if (BLOCKED_FILES.has(ext)) return `.${ext} files cannot be shared.`;
  return null;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function activitySentence(row) {
  const who = row.actor_name || "Former staff";
  if (row.kind === "mention") return `${who} mentioned you`;
  if (row.kind === "reply") return `${who} replied to you`;
  return `${who} reacted ${row.detail || ""} to your message`.replace("  ", " ");
}
