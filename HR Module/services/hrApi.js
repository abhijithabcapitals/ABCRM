import { supabase } from "@app/supabase";

const BUCKET = "hr-documents";
const MAX_FILE = 25 * 1024 * 1024;
const ALLOWED = /\.(pdf|png|jpe?g|webp|tiff?|docx?|xlsx?|csv|txt)$/i;
const CLIENT_MODULE_URL = (import.meta.env.VITE_CLIENT_MODULE_URL || "http://127.0.0.1:8792").replace(/\/$/, "");

export function check({ data, error }) {
  if (error) throw new Error(error.hint ? `${error.message} (${error.hint})` : error.message);
  return data;
}

export const rpc = async (name, args = {}) => check(await supabase.rpc(name, args));
export const table = (name) => supabase.from(name);
export const run = async (query) => check(await query);
export const insertRow = async (name, values) => check(await supabase.from(name).insert(values).select().single());
export const updateRow = async (name, id, values) => check(await supabase.from(name).update(values).eq("id", id).select().single());

// { role: 'hr' | 'manager' | 'employee' | 'none', employee_id }
export const myAccess = () => rpc("hr_my_access");
export const expiringDocuments = () => rpc("hr_documents_expiring");
export const employeeTasks = () => rpc("hr_employee_tasks");
export const dashboardNumbers = () => rpc("hr_dashboard");

// Linking a login to an employee: admin only, audited. A null profile unlinks.
export const loginProfiles = () => run(table("profiles").select("id, full_name").order("full_name"));
export const employeeLink = (employee, profile) => rpc("hr_employee_link", { p_employee: employee, p_profile: profile || null });

// Stores a file in the private bucket under the employee's folder and returns the path. Stored files are never replaced.
export async function uploadDocument(employeeId, file) {
  if (!employeeId) throw new Error("Choose the employee first");
  if (file.size > MAX_FILE) throw new Error("File is larger than 25 MB");
  if (!ALLOWED.test(file.name)) throw new Error("This file type is not allowed");
  const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-100);
  const path = `${employeeId}/${crypto.randomUUID()}-${safe}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) throw new Error(error.message);
  return path;
}

// A short-lived signed link to a stored file.
export async function documentUrl(path) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

// Opens a stored file through a short-lived signed link.
export async function openDocument(path) {
  window.open(await documentUrl(path), "_blank", "noopener");
}

// Everything named on the calendar in a date range.
export async function calendarMarks(from, to) {
  const [holidays, marks] = await Promise.all([
    run(table("hr_holidays").select("holiday_date, name").gte("holiday_date", from).lte("holiday_date", to)),
    run(table("hr_calendar_marks").select("mark_date, name, region").gte("mark_date", from).lte("mark_date", to)),
  ]);
  return { holidays, marks };
}
export const calendarMarkConfirm = (mark, date) => rpc("hr_calendar_mark_confirm", { p_mark: mark, p_date: date });

// Staff requests other than leave, and expense claims in Accounts. A payment is a record only.
export const requestsList = () => rpc("hr_requests_list");
export const requestCreate = (employee, kind, date, hours, amount, note, path) => rpc("hr_request_create", { p_employee: employee, p_kind: kind, p_date: date ?? null, p_hours: hours ?? null, p_amount: amount ?? null, p_note: note || null, p_path: path || null });
export const requestDecide = (request, approve, note, amount) => rpc("hr_request_decide", { p_request: request, p_approve: approve, p_note: note || null, p_amount: amount ?? null });
export const requestOvertimeAmount = (request, amount) => rpc("hr_request_overtime_amount", { p_request: request, p_amount: amount });
export const requestCancel = (request) => rpc("hr_request_cancel", { p_request: request });
export const expensesList = () => rpc("hr_expenses_list");
export const expensePay = (request, paidOn, reference) => rpc("hr_expense_pay", { p_request: request, p_paid_on: paidOn, p_reference: reference || null });
export const expenseUnpay = (request) => rpc("hr_expense_unpay", { p_request: request });

// Salary Payable and Paid. HR, admin and the Accounts team. A payment is a record only: nothing here moves money.
export const salariesOverview = (year) => rpc("hr_salaries_overview", { p_year: year });
export const salariesMonth = (run) => rpc("hr_salaries_month", { p_run: run });
export const salaryPay = (line, amount, paidOn, reference) => rpc("hr_salary_pay", { p_line: line, p_amount: amount, p_paid_on: paidOn, p_reference: reference || null });
export const salaryPayAll = (run, paidOn, reference) => rpc("hr_salary_pay_all", { p_run: run, p_paid_on: paidOn, p_reference: reference || null });
export const salaryPaymentRemove = (payment) => rpc("hr_salary_payment_remove", { p_payment: payment });

// Reads one file through the local Document Module (the Client Module on this PC), then clears it from its staging area.
// Throws when the service is not running: callers treat that as "fill the form by hand".
export async function readDocument(file) {
  const call = async (path, init) => {
    const res = await fetch(`${CLIENT_MODULE_URL}${path}`, { ...init, signal: AbortSignal.timeout(60000) });
    if (!res.ok && res.status !== 409 && res.status !== 400) throw new Error(`Document Module: ${res.status}`);
    return res.json();
  };
  const batch = await call("/api/batches", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const form = new FormData();
  form.append("file", file);
  const r = await call(`/api/batches/${batch.batch}/files`, { method: "POST", body: form });
  if (r.id) await fetch(`${CLIENT_MODULE_URL}/api/batches/${batch.batch}/files/${r.id}`, { method: "DELETE" }).catch(() => {});
  return r.id ? r : null;
}

// Leave. hr_leave_request returns { ids: uuid[], warning: text | null }; a range over a year end becomes one row per year.
// hr_leave_decide and hr_leave_cancel return { warning: text | null }: a locked month, or approval beyond a paid balance.
export const leaveRequest = (employee, type, from, to, note) => rpc("hr_leave_request", { p_employee: employee, p_type: type, p_from: from, p_to: to, p_note: note || null });
export const leaveDecide = (request, approve, note) => rpc("hr_leave_decide", { p_request: request, p_approve: approve, p_note: note || null });
export const leaveCancel = (request) => rpc("hr_leave_cancel", { p_request: request });
export const leaveBalance = (employee, year) => rpc("hr_leave_balance", { p_employee: employee, p_year: year });
export const saveLeaveBalance = async (employee, type, year, entitlement, adjustment) => { check(await table("hr_leave_balances").upsert({ employee_id: employee, leave_type_id: type, year, entitlement, adjustment: adjustment ?? 0 }, { onConflict: "employee_id,leave_type_id,year" })); };

// Attendance. hr_attendance_range returns one row per in-scope employee per day, with the worked-out status, late and overtime minutes.
// hr_attendance_set is admin only. Others call hr_attendance_request, and an admin decides. Set and decide return { warning: text | null }: a locked month.
// A year for everyone is more rows than one response carries, so this reads page by page.
export async function attendanceRange(from, to) {
  const PAGE = 1000;
  const all = [];
  for (let at = 0; ; at += PAGE) {
    const rows = check(await supabase.rpc("hr_attendance_range", { p_from: from, p_to: to }).range(at, at + PAGE - 1));
    all.push(...rows);
    if (rows.length < PAGE) return all;
  }
}
export const attendanceSet = (employee, date, status, timeIn, timeOut, note) => rpc("hr_attendance_set", { p_employee: employee, p_date: date, p_status: status, p_in: timeIn || null, p_out: timeOut || null, p_note: note || null });
export const attendanceRequest = (employee, date, status, timeIn, timeOut, note, reason, useAnnual) => rpc("hr_attendance_request", { p_use_annual: !!useAnnual, p_employee: employee, p_date: date, p_status: status, p_in: timeIn || null, p_out: timeOut || null, p_note: note || null, p_reason: reason || null });
export const attendanceHistory = () => rpc("hr_attendance_history");
export const attendanceDecide = (edit, approve, note) => rpc("hr_attendance_decide", { p_edit: edit, p_approve: approve, p_note: note || null });
export const attendanceEdits = (state) => run(table("hr_attendance_edits").select("*, hr_employees(employee_code, full_name)").eq("state", state).order("requested_at", { ascending: false }).limit(50));
export const attendanceEditsPending = () => rpc("hr_attendance_edits_pending");
export const dashboardPeriod = (period, date) => rpc("hr_dashboard_period", { p_period: period, p_date: date });
export const wfhRules = () => run(table("hr_wfh_saturday_rules").select("*").order("effective_from", { nullsFirst: true }));
export const saveWfhRule = async (id, values) => { check(id ? await table("hr_wfh_saturday_rules").update(values).eq("id", id) : await table("hr_wfh_saturday_rules").insert(values)); };

// Biometric (e-timeoffice). The sync itself runs in the hr-biometric-sync Edge Function; range is { from, to } as YYYY-MM-DD, or nothing for recent days.
export const biometricStatus = () => rpc("hr_biometric_status");
export const biometricLink = (employee, code) => rpc("hr_biometric_link", { p_employee: employee, p_code: code || null });
export const biometricSync = async (range) => {
  const { data, error } = await supabase.functions.invoke("hr-biometric-sync", { body: range || {} });
  if (!error) return data;
  const detail = await error.context?.json?.().catch(() => null);
  throw new Error(detail?.error || error.message);
};

// Payroll. Figures come only from the database. Run writes go through functions; hr_pay_details is HR-only by RLS.
export const payruns = () => run(table("hr_pay_runs").select("*").order("period_month", { ascending: false }));
export const payrunLines = (runId) => run(table("hr_pay_lines").select("*").eq("run_id", runId));
export const myPayLines = async () => {
  const rows = await run(table("hr_pay_lines").select("id, net, earnings, deductions, adjustments, notes, blockers, iban, hr_pay_runs(period_month, status)"));
  return rows.sort((a, b) => b.hr_pay_runs.period_month.localeCompare(a.hr_pay_runs.period_month));
};
export const myEmployee = (id) => run(table("hr_employees").select("id, employee_code, full_name").eq("id", id).single());
export const payrollEmployees = () => run(table("hr_employees").select("id, employee_code, full_name, exit_date").order("full_name"));
export const payrollSettings = () => run(table("hr_settings").select("*").eq("id", 1).single());
export const payrunCreate = (month) => rpc("hr_payrun_create", { p_month: month });
export const payrunRecalc = (id) => rpc("hr_payrun_recalc", { p_run: id });
export const payrunAdjust = (line, label, amount) => rpc("hr_payrun_adjust", { p_line: line, p_label: label, p_amount: amount });
export const payrunAckPayChange = (line, note) => rpc("hr_payrun_ack_pay_change", { p_line: line, p_note: note });
export const payrunChangesAfter = (id) => rpc("hr_payrun_changes_after", { p_run: id });
export const payrunApprove = (id, ackSamePerson) => rpc("hr_payrun_approve", { p_run: id, p_ack_same_person: !!ackSamePerson });
export const payrunDelete = (id) => rpc("hr_payrun_delete", { p_run: id });
export const gratuity = (employee, exitDate) => rpc("hr_gratuity", { p_employee: employee, p_exit: exitDate });
// Lists get a masked IBAN. The full IBAN is read only for the HR edit form.
export const payDetailsList = () => rpc("hr_pay_details_list");
export const payDetailFull = (id) => run(table("hr_pay_details").select("*").eq("id", id).single());
export const savePayDetail = async (id, values) => { check(id ? await table("hr_pay_details").update(values).eq("id", id) : await table("hr_pay_details").insert(values)); };
