import { moveTab } from "../../Main Module/src/tabs.js";

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
export function readLayout(userId, cards) {
  try {
    return mergeLayout(JSON.parse(localStorage.getItem(layoutKey(userId))), cards);
  } catch {
    return mergeLayout(null, cards);
  }
}
export function saveLayout(userId, layout) {
  try {
    localStorage.setItem(layoutKey(userId), JSON.stringify(layout));
  } catch {
    // The layout still applies until the page reloads.
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
