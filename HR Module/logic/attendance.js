// Attendance month grid helpers. Dates are calendar dates (YYYY-MM-DD). The database decides what is allowed; canEditDay only
// hides buttons that it would refuse.
export const STATUSES = ["Present", "Absent", "Leave", "Holiday", "Weekend"];
const pad = (n) => String(n).padStart(2, "0");

export function monthDays(year, month) {
  const n = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`);
}

export function shiftMonth(year, month, by) {
  const i = year * 12 + (month - 1) + by;
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
}

// The Asia/Dubai calendar date, the same one the database uses for "today".
export const dubaiToday = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

// Rows from hr_attendance_month -> one entry per employee: { employee_id, employee_code, full_name, days: {date: row}, counts }.
export function groupMonth(rows) {
  const by = new Map();
  for (const r of rows || []) {
    if (!by.has(r.employee_id)) {
      by.set(r.employee_id, { employee_id: r.employee_id, employee_code: r.employee_code, full_name: r.full_name, employee_status: r.employee_status, exit_date: r.exit_date ?? null, days: {}, counts: Object.fromEntries(STATUSES.map((s) => [s, 0])) });
    }
    const e = by.get(r.employee_id);
    e.days[r.work_date] = r;
    if (r.status && e.counts[r.status] !== undefined) e.counts[r.status] += 1;
  }
  return [...by.values()].sort((a, b) => String(a.employee_code).localeCompare(String(b.employee_code)));
}

export function canEditDay({ role, myId, employeeId, date, today, employeeStatus, exitDate }) {
  if (date > today) return false;
  if (employeeStatus === "Left" && !exitDate) return false;
  if (exitDate && date > exitDate) return false;
  if (role === "hr") return true;
  if (role === "manager") return employeeId !== myId;
  return false;
}

// "9:05" or "09:05" or "09:05:00" -> "09:05"; blank -> null; anything else throws.
export function parseTime(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`"${s}" is not a time. Use HH:MM, for example 09:00`);
  return `${pad(Number(m[1]))}:${m[2]}`;
}

// One line for a hr-biometric-sync result.
export function syncSummary(stats) {
  const d = stats?.days || {};
  const parts = [`${stats?.new_punches ?? 0} new punch(es)`, `${(d.created || 0) + (d.updated || 0)} day(s) updated`];
  if (d.manual) parts.push(`${d.manual} day(s) kept as edited by hand`);
  if (d.unmatched) parts.push(`${d.unmatched} day(s) with no matching employee`);
  if (d.out_of_range) parts.push(`${d.out_of_range} day(s) outside employment dates`);
  if (stats?.unreadable) parts.push(`${stats.unreadable} unreadable record(s)`);
  return `${parts.join(", ")}.`;
}
