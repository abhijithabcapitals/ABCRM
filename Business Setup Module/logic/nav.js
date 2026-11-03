// Pages of the module, with the permission that shows each one. A page lists more than one permission when any will do.
export const NAV = [
  ["dashboard", "Dashboard", "setup.access"],
  ["onboarding", "Onboarding", "setup.kyc.manage"],
  ["clients", "Clients", "setup.access"],
  ["services", "Services & Fees", "setup.access"],
  ["documents", "Documents", "setup.access"],
  ["tasks", "Tasks", "setup.access"],
  ["import", "Import", "setup.import.manage"],
  ["settings", "⚙ Settings", "setup.access"],
];

export const visibleNav = (can) => NAV.filter(([, , perm]) => [].concat(perm).some((p) => can(p)));
