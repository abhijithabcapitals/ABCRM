// Lead list filters. Tabs count leads after the other filters, so each number is what a click will show.
export const OVERDUE = "Follow-up due";
const CLOSED = ["Converted", "Lost", "Not Interested"];

export const isFollowUpDue = (l, today) => !!l.follow_up_date && l.follow_up_date <= today && !CLOSED.includes(l.status);

export function matchesFilters(l, f) {
  if (f.source && l.lead_source !== f.source) return false;
  if (f.employee === "none" ? l.assigned_to : f.employee && l.assigned_to !== f.employee) return false;
  if (f.priority && l.priority !== f.priority) return false;
  if (f.from && l.lead_date < f.from) return false;
  if (f.to && l.lead_date > f.to) return false;
  return true;
}

export function leadTabs(leads, f, statuses, today) {
  const base = leads.filter((l) => matchesFilters(l, f));
  const tabs = [{ key: "", label: "All", count: base.length }];
  const due = base.filter((l) => isFollowUpDue(l, today)).length;
  if (due) tabs.push({ key: OVERDUE, label: OVERDUE, count: due });
  for (const s of statuses) {
    const count = base.filter((l) => l.status === s).length;
    if (count) tabs.push({ key: s, label: s, count });
  }
  return tabs;
}

export function filterLeads(leads, tab, f, today) {
  return leads.filter((l) => matchesFilters(l, f) && (!tab || (tab === OVERDUE ? isFollowUpDue(l, today) : l.status === tab)));
}
