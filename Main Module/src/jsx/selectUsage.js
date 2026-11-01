// Remembers, per user and per field in this browser, which dropdown choices are used, and ranks them.
const KEEP = 30;
let user = "anon";
let cache = null;

export const setUsageUser = (id) => { if ((id || "anon") !== user) { user = id || "anon"; cache = null; } };
const storageKey = () => `crm.selectUsage.${user}`;

function load() {
  if (cache) return cache;
  try { cache = JSON.parse(localStorage.getItem(storageKey())) || {}; } catch { cache = {}; }
  return cache;
}

export function recordUse(field, value, now = Date.now()) {
  if (!field || value === "" || value === null || value === undefined) return;
  const all = load();
  const f = (all[field] ||= {});
  const v = String(value);
  f[v] = [(f[v]?.[0] || 0) + 1, now];
  const old = Object.entries(f).sort((a, b) => b[1][1] - a[1][1]).slice(KEEP);
  for (const [k] of old) delete f[k];
  try { localStorage.setItem(storageKey(), JSON.stringify(all)); } catch { /* the order is only a convenience */ }
}

// The values to show first: the latest few, then the most used, among those still on offer.
export function topValues(usage, available, recent = 3, frequent = 3) {
  const seen = Object.entries(usage || {}).filter(([v]) => available.includes(v));
  const latest = [...seen].sort((a, b) => b[1][1] - a[1][1]).slice(0, recent).map(([v]) => v);
  const most = seen.filter(([v, u]) => u[0] > 1 && !latest.includes(v)).sort((a, b) => b[1][0] - a[1][0] || b[1][1] - a[1][1]).slice(0, frequent).map(([v]) => v);
  return [...latest, ...most];
}

export const usageFor = (field) => load()[field];
export const resetUsageCache = () => { cache = null; };
