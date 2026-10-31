// Lead stages: New (nobody has it), In Pipeline (an employee picked it up), Converted (closed), Lost.
// Tabs count leads after the other filters, so each number is what a click will show.
const LOST = ["Lost", "Not Interested", "Unreachable"];
export const STAGE_TABS = [["new", "New Leads"], ["pipeline", "In Pipeline"], ["converted", "Converted"], ["lost", "Lost"]];

export function stageOf(l) {
  if (l.status === "Converted") return "converted";
  if (LOST.includes(l.status)) return "lost";
  return l.picked_up_at ? "pipeline" : "new";
}

export const isFollowUpDue = (l, today) => !!l.follow_up_date && l.follow_up_date <= today && !["converted", "lost"].includes(stageOf(l));

export function matchesFilters(l, f, today) {
  if (f.status && l.status !== f.status) return false;
  if (f.source && l.lead_source !== f.source) return false;
  if (f.employee === "none" ? l.assigned_to : f.employee && l.assigned_to !== f.employee) return false;
  if (f.priority && l.priority !== f.priority) return false;
  if (f.from && l.lead_date < f.from) return false;
  if (f.to && l.lead_date > f.to) return false;
  if (f.due && !isFollowUpDue(l, today)) return false;
  return true;
}

export function leadTabs(leads, f, today) {
  const base = leads.filter((l) => matchesFilters(l, f, today));
  return STAGE_TABS.map(([key, label]) => ({ key, label, count: base.filter((l) => stageOf(l) === key).length }));
}

export const filterLeads = (leads, tab, f, today) => leads.filter((l) => matchesFilters(l, f, today) && stageOf(l) === tab);

// Opens where the work is: the first stage that has leads.
export const firstTab = (tabs) => tabs.find((t) => t.count > 0)?.key || "new";
