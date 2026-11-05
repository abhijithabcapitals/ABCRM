// Staff requests. Leave stays in hr_leave_requests and everything else in hr_requests; the Requests screen shows both as one list.
import { parseTime, statusLabel } from "./attendance.js";
export const REQUEST_KINDS = {
  half_day: { label: "Half day", approver: "HR", fields: ["work_date", "note"] },
  wfh: { label: "Work from home", approver: "HR", fields: ["work_date", "note"] },
  late_concession: { label: "Late concession", approver: "HR", fields: ["work_date", "note"] },
  overtime: { label: "Overtime payment", approver: "HR, who also enters the amount", fields: ["work_date", "hours", "note"] },
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
  if (r.source === "attendance") return `${r.work_date}: ${r.was} to ${r.change}`;
  const parts = [hhmmDate(r.work_date)];
  if (r.kind === "overtime") parts.push(`${r.hours} hours`, r.amount === null || r.amount === undefined ? "amount not entered" : money(r.amount));
  if (r.kind === "reimbursement") parts.push(money(r.amount));
  return parts.filter(Boolean).join(", ");
}

// Rows from hr_requests_list, hr_leave_requests and hr_attendance_edits -> one list, newest first. canDecideLeave and canDecideEdit say who may decide those rows.
export function mergeRequests(requests, leaves, canDecideLeave, edits, canDecideEdit) {
  const others = (requests || []).map((r) => ({ ...r, source: "request", title: REQUEST_KINDS[r.kind]?.label || r.kind }));
  const leave = (leaves || []).map((l) => ({
    id: l.id, source: "leave", employee_id: l.employee_id, employee_code: l.hr_employees?.employee_code, full_name: l.hr_employees?.full_name,
    title: `${l.hr_leave_types?.name || ""} leave`, work_date: l.from_date, from_date: l.from_date, to_date: l.to_date, days: l.days, note: l.note, status: l.status,
    decision_note: l.decision_note, created_at: l.created_at, can_decide: l.status === "pending" && canDecideLeave(l),
  }));
  // An edit's own status field is the proposed day status; its decision state is state.
  const attendance = (edits || []).map((e) => ({
    id: e.id, source: "attendance", employee_id: e.employee_id, employee_code: e.hr_employees?.employee_code, full_name: e.hr_employees?.full_name,
    title: "Attendance change", work_date: e.work_date, was: dayValue(e.old_values), change: dayValue(e), note: e.reason, status: e.state,
    requested_by: e.requested_by, decided_by: e.decided_by, decided_at: e.decided_at, decision_note: e.decision_note, created_at: e.requested_at,
    can_decide: e.state === "pending" && canDecideEdit(e),
  }));
  return [...others, ...leave, ...attendance].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
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

// An employee's correction of their own day.
export const CORRECTIONS = [
  { value: "annual", label: "Use Annual leave" },
  { value: "wfh", label: "Work from home" },
  { value: "timing", label: "Change timing" },
];

export function correctionValues(v) {
  if (v.choice === "annual") return { status: "Leave", timeIn: null, timeOut: null, useAnnual: true };
  if (v.choice === "wfh") return { status: "WFH", timeIn: null, timeOut: null, useAnnual: false };
  if (v.choice !== "timing") throw new Error("Choose what to do with this day");
  const timeIn = parseTime(v.time_in);
  const timeOut = parseTime(v.time_out);
  if (!timeIn || !timeOut) throw new Error("Give both the login and logoff times");
  return { status: "Present", timeIn, timeOut, useAnnual: false };
}

const dayValue = (v) => {
  if (!v?.status) return "Nothing recorded";
  if (v.use_annual) return "Annual leave";
  const times = v.time_in || v.time_out ? ` ${String(v.time_in || "?").slice(0, 5)}-${String(v.time_out || "?").slice(0, 5)}` : "";
  return `${statusLabel(v)}${times}`;
};
const HISTORY_VERB = { "attendance.edit_requested": "Asked", "attendance.edit_approved": "Validated", "attendance.edit_rejected": "Rejected", "attendance.created": "Changed", "attendance.updated": "Changed" };

// One row of hr_attendance_history in words.
export const historyLine = (e) => `${HISTORY_VERB[e.action] || e.action}: ${dayValue(e.old_values)} to ${dayValue(e.new_values)}`;
