// Staff requests. Leave stays in hr_leave_requests and everything else in hr_requests; the Requests screen shows both as one list.
export const REQUEST_KINDS = {
  half_day: { label: "Half day", approver: "Your manager or HR", fields: ["work_date", "note"] },
  wfh: { label: "Work from home", approver: "Your manager or HR", fields: ["work_date", "note"] },
  late_concession: { label: "Late concession", approver: "Your manager or HR", fields: ["work_date", "note"] },
  overtime: { label: "Overtime payment", approver: "Your manager or HR. HR enters the amount", fields: ["work_date", "hours", "note"] },
  reimbursement: { label: "Expense reimbursement", approver: "A Finance Manager, then Accounts pays it", fields: ["work_date", "amount", "note"], needsFile: true },
  other: { label: "Other", approver: "HR", fields: ["note"] },
};

const FIELD = {
  work_date: { name: "work_date", label: "Date", type: "date", required: true },
  hours: { name: "hours", label: "Hours", type: "number", required: true },
  amount: { name: "amount", label: "Amount (AED)", type: "number", required: true },
  note: { name: "note", label: "Details", type: "textarea", full: true },
};

// The form for a choice: "leave:<type id>" or a key of REQUEST_KINDS.
export function requestFields(choice) {
  if (!choice) return [];
  if (choice.startsWith("leave:")) {
    return [{ name: "from_date", label: "From", type: "date", required: true }, { name: "to_date", label: "To", type: "date", required: true }, FIELD.note];
  }
  return REQUEST_KINDS[choice].fields.map((f) => (f === "note" && choice === "other" ? { ...FIELD.note, required: true } : FIELD[f]));
}

export function requestChoices(leaveTypes) {
  return [
    ...(leaveTypes || []).map((t) => ({ value: `leave:${t.id}`, label: `${t.name} leave` })),
    ...Object.entries(REQUEST_KINDS).map(([value, k]) => ({ value, label: k.label })),
  ];
}

const hhmmDate = (d) => (d ? String(d) : "");

// One line saying what was asked for.
export function requestSummary(r, money = String) {
  if (r.source === "leave") return r.from_date === r.to_date ? `${r.days} day` : `${r.from_date} to ${r.to_date}, ${r.days} days`;
  const parts = [hhmmDate(r.work_date)];
  if (r.kind === "overtime") parts.push(`${r.hours} hours`, r.amount === null || r.amount === undefined ? "amount not entered" : money(r.amount));
  if (r.kind === "reimbursement") parts.push(money(r.amount));
  return parts.filter(Boolean).join(", ");
}

// Rows from hr_requests_list and hr_leave_requests -> one list, newest first. canDecideLeave says who may decide a leave row.
export function mergeRequests(requests, leaves, canDecideLeave) {
  const others = (requests || []).map((r) => ({ ...r, source: "request", title: REQUEST_KINDS[r.kind]?.label || r.kind }));
  const leave = (leaves || []).map((l) => ({
    id: l.id, source: "leave", employee_id: l.employee_id, employee_code: l.hr_employees?.employee_code, full_name: l.hr_employees?.full_name,
    title: `${l.hr_leave_types?.name || ""} leave`, work_date: l.from_date, from_date: l.from_date, to_date: l.to_date, days: l.days, note: l.note, status: l.status,
    decision_note: l.decision_note, created_at: l.created_at, can_decide: l.status === "pending" && canDecideLeave(l),
  }));
  return [...others, ...leave].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

export const STATUS_TONE = { pending: "warn", approved: "good", rejected: "bad", cancelled: "plain" };

// Who the profile warns about: a leaver still holding something.
export const unreturnedAssets = (assets) => (assets || []).filter((a) => !a.returned_on);

// tenure months from a start date -> the last day of cover, for the form's default.
export function insuranceEnd(start, months) {
  if (!start || !(Number(months) > 0)) return "";
  const [y, m, d] = start.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + Number(months), d));
  // A month shorter than the start day rolls over; step back to its last day.
  if (last.getUTCDate() !== d) last.setUTCDate(0);
  last.setUTCDate(last.getUTCDate() - 1);
  return last.toISOString().slice(0, 10);
}
