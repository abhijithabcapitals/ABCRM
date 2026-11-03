import { supabase } from "./supabase";

const BATCH = 50;
const EVERY_MS = 10000;

// What a click was on. Only button-like text is read, never what is typed or a row's contents.
export function describeClick(target) {
  const el = target?.closest?.('button, a, [role="button"], [role="tab"], [role="menuitem"], .nav-item, label, summary, input, select, textarea, tr');
  if (!el) return { element: (target?.tagName || "page").toLowerCase() };
  const element = el.tagName.toLowerCase();
  if (element === "tr") return { element: "table row" };
  if (element === "input" || element === "select" || element === "textarea") {
    const type = el.getAttribute("type");
    return { element: type ? `input ${type}` : element, label: el.getAttribute("aria-label") || el.id || el.name || undefined };
  }
  const label = (el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 120);
  return { element, label: label || undefined };
}

// Holds events and sends them in batches. A failed batch goes back in the queue, up to a limit.
export function makeQueue(send, batch = BATCH) {
  let items = [];
  const flush = async () => {
    if (!items.length) return;
    const out = items.slice(0, 100);
    items = items.slice(100);
    try {
      await send(out);
    } catch {
      items = [...out, ...items].slice(0, 500);
    }
  };
  const add = (event) => {
    items.push({ ...event, at: new Date().toISOString() });
    if (items.length >= batch) flush();
  };
  return { add, flush, size: () => items.length };
}

const queue = makeQueue(async (events) => {
  const { error } = await supabase.rpc("audit_events", { p_events: events });
  if (error) throw error;
});
let page = "app";

export function recordPage(view) {
  page = view || "app";
  queue.add({ kind: "PAGE", page });
}

// Runs while someone is signed in. Returns the function that stops it.
export function startAuditEvents() {
  const onClick = (e) => queue.add({ kind: "CLICK", page, ...describeClick(e.target) });
  const onHide = () => { if (document.visibilityState === "hidden") queue.flush(); };
  document.addEventListener("click", onClick, true);
  document.addEventListener("visibilitychange", onHide);
  const timer = setInterval(queue.flush, EVERY_MS);
  return () => {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("visibilitychange", onHide);
    clearInterval(timer);
  };
}

export const flushAuditEvents = () => queue.flush();
