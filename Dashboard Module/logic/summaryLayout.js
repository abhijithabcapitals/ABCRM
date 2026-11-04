import { moveTab } from "../../Main Module/src/tabs.js";

// Stays off until the accuracy check against Zoho passes. Edit this one line to try the cards locally.
export const ZOHO_CARDS_LIVE = false;

const card = (id, title, group, tab = null) => ({ id, title, group, tab, view: tab });
export const SUMMARY_CARDS = [
  card("bd", "Business Development", "departments", "business-development"),
  card("banking", "Business Banking", "departments", "business-banking"),
  card("setup", "Business Setup", "departments", "business-setup"),
  card("accounting", "Accounting", "departments", "accounts"),
  card("hr", "HR", "departments", "hr"),
  card("tax", "Tax Compliance", "departments", "tax"),
  card("notifications", "Notifications", "departments"),
  card("health", "Company Health", "zoho"),
  card("ar", "Accounts Receivable", "zoho"),
  card("ap", "Accounts Payable", "zoho"),
  card("ratios", "Financial Ratios", "zoho"),
  card("revenue", "Revenue", "zoho"),
  card("cost", "Cost", "zoho"),
  card("cash", "Cash", "zoho"),
];

const GROUPS = ["departments", "zoho"];

// Zoho cards are admin only. Cards with no tab show to everyone.
export function visibleCards(cards, { isAdmin, tabs }) {
  if (isAdmin) return cards;
  return cards.filter((c) => c.group !== "zoho" && (!c.tab || (Array.isArray(tabs) && tabs.includes(c.tab))));
}

// Saved order wins; ids no longer in cards drop, new cards go last in list order.
export function mergeLayout(saved, cards) {
  const s = saved && typeof saved === "object" ? saved : {};
  const savedOrder = s.order && typeof s.order === "object" ? s.order : {};
  const order = {};
  for (const g of GROUPS) {
    const ids = cards.filter((c) => c.group === g).map((c) => c.id);
    const first = Array.isArray(savedOrder[g]) ? savedOrder[g].filter((id, i, a) => ids.includes(id) && a.indexOf(id) === i) : [];
    order[g] = [...first, ...ids.filter((id) => !first.includes(id))];
  }
  const all = cards.map((c) => c.id);
  const collapsed = Array.isArray(s.collapsed) ? s.collapsed.filter((id) => all.includes(id)) : [];
  return { order, collapsed };
}

// Each person's own layout, kept in this browser.
const layoutKey = (userId) => `crm-dashboard-layout:${userId}`;

// A member's tabs load after the first paint, and until then only the cards with no tab show. An admin's tabs are never
// loaded and an admin sees every card, so an admin is always ready.
export const canSaveLayout = ({ isAdmin, tabs }) => isAdmin === true || Array.isArray(tabs);

// What to store: the shown cards in their new order, with each hidden card kept in the slot it had, so it is back where
// it was when it shows again. Hidden cards also keep their collapsed state.
export function layoutToStore(stored, layout, cards = SUMMARY_CARDS) {
  const all = mergeLayout(stored, cards);
  const order = {};
  const shown = new Set();
  for (const g of GROUPS) {
    const ids = Array.isArray(layout?.order?.[g]) ? layout.order[g] : [];
    ids.forEach((id) => shown.add(id));
    const queue = [...ids];
    const slots = all.order[g].map((id) => (ids.includes(id) ? queue.shift() : id));
    order[g] = [...slots, ...queue];
  }
  const collapsed = [...all.collapsed.filter((id) => !shown.has(id)), ...(layout?.collapsed ?? [])];
  return { order, collapsed };
}
export function readLayout(userId, cards) {
  try {
    return mergeLayout(JSON.parse(localStorage.getItem(layoutKey(userId))), cards);
  } catch {
    return mergeLayout(null, cards);
  }
}
export function saveLayout(userId, layout, cards = SUMMARY_CARDS) {
  try {
    let stored = null;
    try {
      stored = JSON.parse(localStorage.getItem(layoutKey(userId)));
    } catch {
      // Unreadable: start from the default order.
    }
    localStorage.setItem(layoutKey(userId), JSON.stringify(layoutToStore(stored, layout, cards)));
  } catch {
    // The layout still applies until the page reloads.
  }
}
// Reset forgets the whole layout, including where hidden cards were.
export function clearLayout(userId) {
  try {
    localStorage.removeItem(layoutKey(userId));
  } catch {
    // The reset still applies until the page reloads.
  }
}

const withGroup = (layout, group, ids) => (ids === layout.order[group] ? layout : { ...layout, order: { ...layout.order, [group]: ids } });

export function moveCard(layout, group, from, to) {
  const ids = layout.order[group];
  return ids ? withGroup(layout, group, moveTab(ids, from, to)) : layout;
}
export function stepCard(layout, group, id, delta) {
  const ids = layout.order[group];
  if (!ids) return layout;
  const to = ids[ids.indexOf(id) + delta];
  return ids.includes(id) && to ? moveCard(layout, group, id, to) : layout;
}

export function toggleCollapsed(layout, id) {
  const collapsed = layout.collapsed.includes(id) ? layout.collapsed.filter((c) => c !== id) : [...layout.collapsed, id];
  return { ...layout, collapsed };
}
export function setGroupCollapsed(layout, ids, collapsed) {
  const rest = layout.collapsed.filter((c) => !ids.includes(c));
  return { ...layout, collapsed: collapsed ? [...rest, ...ids] : rest };
}

// While dragging: which card to swap with now. The card just swapped with is ignored until the pointer
// leaves it, or a short card dragged over a tall one swaps back and forth under a still pointer.
export function nextDragMove(lastTarget, over, dragId) {
  if (!over || over === dragId) return { move: null, lastTarget: null };
  if (over === lastTarget) return { move: null, lastTarget };
  return { move: over, lastTarget: over };
}
