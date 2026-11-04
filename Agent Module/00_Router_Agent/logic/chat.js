// Rules for the chat panel. Kept apart from the screen so they can be tested on their own.
import { MAX_MESSAGE } from "../supabase/router-agent/logic.js";

// The only message the panel writes itself. Everything else comes from an agent or router-agent.
export const CONNECTION_ERROR = "Could not connect. Check your connection and try again.";

export function canSend(text, busy) {
  const message = (text || "").trim();
  return !busy && !!message && message.length <= MAX_MESSAGE;
}

// What stays in the box after a send: the question when it failed, so it is not lost.
export const inputAfterSend = (text, failed) => (failed ? text : "");
