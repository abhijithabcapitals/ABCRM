// Rules for calls. Pure functions only, no imports.

export const RING_LIMIT_MS = 45 * 1000;

export function formatDuration(from, to) {
  const total = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));
  if (!Number.isFinite(total)) return "";
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, "0");
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export const OPEN_STATUSES = new Set(["ringing", "active"]);

// What to call a line in the call history, from this person's side.
export function historyLine(row) {
  const kind = row.media === "video" ? "Video call" : "Call";
  if (OPEN_STATUSES.has(row.status)) return `${kind} in progress`;
  if (row.answered_at && row.my_state !== "missed" && row.my_state !== "declined") {
    return row.ended_at ? `${kind}, ${formatDuration(row.answered_at, row.ended_at)}` : kind;
  }
  if (row.started_by_me) return `${kind}, no answer`;
  return row.my_state === "declined" ? `${kind}, declined` : `Missed ${kind.toLowerCase()}`;
}
export const wasMissed = (row) => !row.started_by_me && row.my_state === "missed";

export const historyTitle = (row) => (row.conversation_kind === "direct" ? row.other_name || "Former staff" : row.conversation_title || "Group");

export function incomingTitle(call) {
  const who = call.caller_name || "Former staff";
  return call.conversation_kind === "direct" ? who : `${who}, in ${call.conversation_title || "a group"}`;
}

// The sentence when a call screen closes by itself.
export function endedNote(status, startedByMe) {
  if (status === "declined") return "The call was declined.";
  if (status === "missed") return startedByMe ? "No one answered." : "The call ended.";
  return "The call ended.";
}

// A browser's reason for refusing a device, in plain words.
export function mediaProblem(error, media) {
  const name = error?.name;
  const what = media === "screen" ? "Screen sharing" : media === "video" ? "Your camera" : "Your microphone";
  if (name === "NotAllowedError") return media === "screen" ? null : `${what} is blocked. Allow it for this app, then try again.`;
  if (name === "NotFoundError") return `${what} was not found.`;
  if (name === "NotReadableError") return `${what} is in use by another program.`;
  return `${what} could not start.`;
}

export const tileCols = (count) => (count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4);
