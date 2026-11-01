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
  { key: "tax", label: "Tax Compliance" },
  { key: "spaces", label: "Spaces, Tasks and Documents" },
];
const KEYS = new Set(GRANTABLE_TABS.map((t) => t.key));
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
