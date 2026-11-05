// Pages of the module, with the permission that shows each one. A page lists more than one permission when any will do.
export const NAV = [
  ["dashboard", "Dashboard", "setup.access"],
  ["leads", "All Leads", "setup.access"],
  ["onboarding", "Client Onboarding", "setup.access"],
  ["pipeline", "Pipeline", "setup.access"],
  ["completion", "Completion", "setup.access"],
  ["clients", "Clients", "setup.access"],
  ["services", "Services & Fees", "setup.access"],
  ["tasks", "Tasks", "setup.access"],
  ["settings", "⚙ Settings", "setup.access"],
];

export const visibleNav = (can) => NAV.filter(([, , perm]) => [].concat(perm).some((p) => can(p)));

// The tab that lists a case at each stage (spec section 3). A closed case that was lost shows in All Leads, a finished one under Clients.
const STAGE_TAB = { Lead: "leads", Review: "leads", Lost: "leads", Onboarding: "onboarding", Pipeline: "pipeline", Completion: "completion", "With Accounts": "completion", Completed: "clients", Cancelled: "clients" };
export const stageTab = (stage) => STAGE_TAB[stage] || "leads";

// Older links pass the page keys the module used before the client flow. They land on the tab that took over.
const LEGACY = { review: "leads", documentation: "onboarding", cases: "pipeline" };
export const pageKey = (key) => LEGACY[key] || key;
