import { useSyncExternalStore } from "react";

// The open Bruno dock gives pages one spot above the chat (the BD module puts its mini calendar there).
// The panel registers that spot's node here; a page renders into it with <BrunoExtra>.
let node = null;
const listeners = new Set();

export function setDockSlot(next) {
  node = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDockSlot() {
  return useSyncExternalStore(subscribe, () => node, () => null);
}
