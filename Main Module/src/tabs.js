// The pages an admin can grant a member. Settings, CEO Agent and Email Agent stay admin-only.
export const GRANTABLE_TABS = [
  { key: "mytasks", label: "Hot Alerts" },
  { key: "dashboard", label: "Dashboard" },
  { key: "business-development", label: "Business Development" },
  { key: "business-setup", label: "Business Setup" },
  { key: "business-banking", label: "Business Banking" },
  { key: "accounts", label: "Accounting" },
  { key: "quotations", label: "Template Hub" },
  { key: "clients", label: "Clients" },
  { key: "hr", label: "HR" },
  { key: "tax", label: "Tax Compliance" },
  { key: "knowledge", label: "Knowledge" },
  { key: "spaces", label: "Spaces, Tasks and Documents" },
];
const KEYS = new Set(GRANTABLE_TABS.map((t) => t.key));

// The "All" tick: everything when any tab is still off, nothing when all are on.
export const toggleAllTabs = (value) => (GRANTABLE_TABS.every((t) => value.includes(t.key)) ? [] : GRANTABLE_TABS.map((t) => t.key));
const ADMIN_ONLY = new Set(["settings", "ceo", "email-agent"]);

// These pages show nothing until the member also has a data role.
export const NEEDS_DATA_ROLE = new Set(["business-banking", "accounts", "quotations", "clients", "tax"]);
export const DATA_ROLES = ["READ_ONLY", "SALES_EXECUTIVE", "DOCUMENT_EXECUTIVE", "BANKING_EXECUTIVE", "FINANCE", "ACCOUNTS", "MANAGER", "ADMIN"];

// Any other page (a list, folder, document or whiteboard) belongs to Spaces.
const tabOf = (view) => (KEYS.has(view) ? view : "spaces");

// The page a person actually sees. Admins go anywhere; members only where they were given access.
export function resolveView(view, isAdmin, tabs) {
  if (isAdmin || view === "profile") return view;
  if (!ADMIN_ONLY.has(view) && (tabs || []).includes(tabOf(view))) return view;
  return (tabs || []).find((t) => t !== "spaces") || "profile";
}

// Each person's own sidebar order, kept in this browser. Tabs not in the saved order go last.
const orderKey = (userId) => `crm-tab-order:${userId}`;
export function readTabOrder(userId) {
  try {
    const saved = JSON.parse(localStorage.getItem(orderKey(userId)));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}
export function saveTabOrder(userId, keys) {
  try {
    localStorage.setItem(orderKey(userId), JSON.stringify(keys));
  } catch {
    // The new order still applies until the page reloads.
  }
}
export function orderTabs(items, order) {
  const rank = (item) => (order.includes(item.key) ? order.indexOf(item.key) : order.length);
  return items.map((item, i) => [item, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([item]) => item);
}
// Puts the dragged tab where the target tab is; the tabs between them shift by one.
export function moveTab(keys, from, to) {
  const at = keys.indexOf(to);
  if (from === to || at < 0 || !keys.includes(from)) return keys;
  const rest = keys.filter((k) => k !== from);
  rest.splice(at, 0, from);
  return rest;
}
