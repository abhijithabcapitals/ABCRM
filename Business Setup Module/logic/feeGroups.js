// Services & Fees (025): fee items in two levels, Category then Group. The ten categories follow the service list's
// sections A to J; any other category a fee item carries comes after them, in alphabetical order.
export const FEE_CATEGORIES = [
  "Company Formation", "Trade License & Approvals", "Visa & Immigration", "PRO & Government Services",
  "Corporate Amendments & Restructuring", "Corporate Compliance", "Office & Facility Services", "Business Banking",
  "Liquidation & Company Closure", "Additional Business Support Services",
];

// A fee item's category: its own, else its checklist's, else its group.
export const feeCategory = (fee, listsById = {}) =>
  (fee.category && fee.category.trim()) || listsById[fee.checkpoint_set_id]?.category || fee.grp || "Other";

const rank = (c) => { const i = FEE_CATEGORIES.indexOf(c); return i === -1 ? FEE_CATEGORIES.length : i; };
const byName = (a, b) => a.localeCompare(b, "en");
const order = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || byName(a.name || "", b.name || "");

// Matches a fee item, its group, category or checklist name against the search words. Every word must match.
export function feeMatches(fee, category, list, q) {
  const words = (q || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [fee.name, fee.grp, category, list?.name].filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => text.includes(w));
}

// [{ category, count, groups: [{ grp, items: [fee] }] }]: categories in the order above, groups by name, items by sort order then name.
// Each item gets `list`, its checklist, when it has one. Empty categories are left out.
export function groupFees(fees = [], lists = [], q = "") {
  const listsById = Object.fromEntries(lists.map((l) => [l.id, l]));
  const cats = new Map();
  for (const fee of fees) {
    const category = feeCategory(fee, listsById);
    const list = listsById[fee.checkpoint_set_id];
    if (!feeMatches(fee, category, list, q)) continue;
    if (!cats.has(category)) cats.set(category, new Map());
    const groups = cats.get(category);
    const grp = fee.grp || category;
    if (!groups.has(grp)) groups.set(grp, []);
    groups.get(grp).push({ ...fee, list });
  }
  return [...cats.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || byName(a, b))
    .map(([category, groups]) => {
      const gs = [...groups.entries()]
        .sort(([a], [b]) => (a === category ? -1 : b === category ? 1 : byName(a, b)))
        .map(([grp, items]) => ({ grp, items: items.sort(order) }));
      return { category, count: gs.reduce((n, g) => n + g.items.length, 0), groups: gs };
    });
}

// Each person's own order of the category sections, dragged on the screen and kept in this browser (as the CRM's
// tab bars are). A category not in the saved order keeps its place after the saved ones.
const orderKey = (user) => `bs-fee-cat-order:${user || "anon"}`;
export function readCategoryOrder(user) {
  try { const v = JSON.parse(localStorage.getItem(orderKey(user))); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function saveCategoryOrder(user, keys) {
  try { if (keys.length) localStorage.setItem(orderKey(user), JSON.stringify(keys)); else localStorage.removeItem(orderKey(user)); } catch { /* applies until reload */ }
}
export function applyCategoryOrder(cats, order = []) {
  const rank = (c) => (order.includes(c.category) ? order.indexOf(c.category) : order.length);
  return cats.map((c, i) => [c, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([c]) => c);
}
// Puts the dragged section where the target is; the sections between them shift by one.
export function moveCategory(keys, from, to) {
  const at = keys.indexOf(to);
  if (from === to || at < 0 || !keys.includes(from)) return keys;
  const rest = keys.filter((k) => k !== from);
  rest.splice(at, 0, from);
  return rest;
}

// Checklists no fee item points at: shown on their own so a list made with "+ Checklist" can still be found and edited.
export const unlinkedLists = (fees = [], lists = []) => {
  const used = new Set(fees.map((f) => f.checkpoint_set_id).filter(Boolean));
  return lists.filter((l) => !used.has(l.id));
};

// Category choices for the fee form: the ten, then any other in use, then the item's own.
export const categoryOptions = (fees = [], current) => {
  const extra = [...new Set([...fees.map((f) => f.category), current].filter((c) => c && !FEE_CATEGORIES.includes(c)))].sort(byName);
  return [...FEE_CATEGORIES, ...extra];
};
