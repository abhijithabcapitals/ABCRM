// Pages of the module, with the permission that shows each one. A page lists more than one permission when any will do.
export const NAV = [
  ["dashboard", "Dashboard", "setup.access"],
  ["leads", "Leads", "setup.access"],
  ["review", "Review", "setup.kyc.manage"],
  ["documentation", "Documentation", "setup.access"],
  ["cases", "Cases", "setup.access"],
  ["clients", "Clients", "setup.access"],
  ["services", "Services & Fees", "setup.access"],
  ["tasks", "Tasks", "setup.access"],
  ["settings", "⚙ Settings", "setup.access"],
];

export const visibleNav = (can) => NAV.filter(([, , perm]) => [].concat(perm).some((p) => can(p)));
