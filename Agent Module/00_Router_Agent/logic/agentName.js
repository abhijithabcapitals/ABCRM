// Name rules for the person's agent. The database applies the same limits.
export const DEFAULT_NAME = "Bruno";
const MAX_NAME = 30;

// The cleaned name, or null when it cannot be used. Counted in code points, so one emoji is one character.
export function cleanAgentName(raw) {
  const name = typeof raw === "string" ? raw.trim() : "";
  return name && [...name].length <= MAX_NAME ? name : null;
}
export const NAME_CHANGED = "router-agent-name-changed";
