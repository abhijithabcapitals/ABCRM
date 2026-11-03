// Attendance month grid helpers. Dates are calendar dates (YYYY-MM-DD). The database decides what is allowed; canEditDay only
// hides buttons that it would refuse.
export const STATUSES = ["Present", "Absent", "WFH", "Leave", "Holiday", "Weekend"];
export const SHORT = { Present: "P", Absent: "A", WFH: "WH", Leave: "L", Holiday: "H", Weekend: "W" };
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => d.toISOString().slice(0, 10);
const utc = (date) => new Date(`${date}T00:00:00Z`);
const addDays = (date, by) => { const d = utc(date); d.setUTCDate(d.getUTCDate() + by); return iso(d); };

// Monday to Sunday around any date.
export function weekDays(date) {
  const monday = addDays(date, -((utc(date).getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function yearDays(year) {
  const n = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000;
  return Array.from({ length: n }, (_, i) => addDays(`${year}-01-01`, i));
}

export function periodRange(period, date) {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  if (period === "week") { const w = weekDays(date); return { from: w[0], to: w[6] }; }
  if (period === "month") { const days = monthDays(y, m); return { from: days[0], to: days.at(-1) }; }
  if (period === "year") return { from: `${y}-01-01`, to: `${y}-12-31` };
  return { from: date, to: date };
}

// Moves by whole periods. Month and year land on the 1st, so a short month is never skipped.
export function shiftPeriod(period, date, by) {
  if (period === "week") return addDays(date, by * 7);
  if (period === "month") { const s = shiftMonth(Number(date.slice(0, 4)), Number(date.slice(5, 7)), by); return `${s.year}-${pad(s.month)}-01`; }
  if (period === "year") return `${Number(date.slice(0, 4)) + by}-01-01`;
  return addDays(date, by);
}

export function statusLabel(row) {
  if (!row?.status) return "Nothing recorded";
  if (row.status === "Leave") return row.leave_kind ? `On Leave (${row.leave_kind})` : "On Leave";
  if (row.status === "Weekend") return "Weekly Off";
  if (row.status === "WFH") return "Work From Home";
  return row.status;
}

export const editFormNote = (isAdmin) => (isAdmin
  ? "Your change applies now and is logged. It makes this a manual day, which the biometric sync no longer changes."
  : "This goes to an administrator for approval. The day keeps its current value until then.");

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

// Rows from hr_holidays and hr_calendar_marks -> { date: [{ name, region, holiday }] }, real holidays first. Only a real holiday changes a day's status.
export function marksByDate(holidays, marks) {
  const by = {};
  const add = (date, item) => { (by[date] ??= []).push(item); };
  for (const h of holidays || []) add(h.holiday_date, { name: h.name, region: "UAE", holiday: true });
  for (const m of marks || []) add(m.mark_date, { name: m.name, region: m.region, holiday: false });
  return by;
}

export const markText = (list) => (list || []).map((m) => (m.holiday ? m.name : `${m.name} (estimated)`)).join(", ");

export const markClasses = (list) => ["UAE", "India"].filter((r) => (list || []).some((m) => m.region === r)).map((r) => `hr-cell-mark-${r.toLowerCase()}`).join(" ");

// A UAE mark HR should look at: its date is within 30 days or has passed, and until confirmed that day still counts as a working day.
export const confirmSoon = (mark, today) => mark.region === "UAE" && mark.mark_date <= addDays(today, 30);

// Months as YYYY-MM, for the endless grid.
export const monthKey = (date) => date.slice(0, 7);
export function addMonth(key, by) {
  const s = shiftMonth(Number(key.slice(0, 4)), Number(key.slice(5, 7)), by);
  return `${s.year}-${pad(s.month)}`;
}
export const monthsAround = (key) => [addMonth(key, -1), key, addMonth(key, 1)];

// The unbroken list, grown as far as the target month.
export function extendMonths(months, target) {
  const out = [...months];
  while (target < out[0]) out.unshift(addMonth(out[0], -1));
  while (target > out.at(-1)) out.push(addMonth(out.at(-1), 1));
  return out;
}

// Which day column sits in the middle of the part of the grid that scrolls.
export function visibleDayIndex({ scrollLeft, clientWidth, frozen, col, days }) {
  const i = Math.floor((scrollLeft + (clientWidth - frozen) / 2) / col);
  return Math.min(Math.max(i, 0), days - 1);
}

// A date as "Tue, 3 Nov 2026". Read as UTC, so the machine's zone cannot move it to another day.
export const todayLabel = (date) => {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" }).formatToParts(utc(date));
  const part = (type) => p.find((x) => x.type === type).value;
  return `${part("weekday")}, ${part("day")} ${part("month")} ${part("year")}`;
};

// Lateness left after the extra time worked that day. The Late card still counts the arrival; only the colour is set off.
export const netLateMinutes = (row) => Math.max((row?.late_minutes || 0) - (row?.overtime_minutes || 0), 0);

const LATE_FROM = [0xff, 0xe6, 0x80]; // yellow, just after 09:30
const LATE_TO = [0xf2, 0x8c, 0x28]; // orange, from 10:30
const LATE_FULL_MINUTES = 60;

// The cell colour for net late minutes, or null when none are left.
export function lateShade(minutes) {
  if (!(minutes > 0)) return null;
  const t = Math.min(minutes / LATE_FULL_MINUTES, 1);
  return `#${LATE_FROM.map((c, i) => Math.round(c + (LATE_TO[i] - c) * t).toString(16).padStart(2, "0")).join("")}`;
}

export function setOffNote(row) {
  if (!(row?.late_minutes > 0 && row?.overtime_minutes > 0)) return "";
  const net = netLateMinutes(row);
  return net > 0 ? `, ${net} min net late` : ", set off by overtime";
}

// One row per person from their hr_leave_balance rows, in the same order. A negative adjustment is days already used, which is how the opening sheet was loaded.
export function annualRows(people, balances) {
  return people.map((p, i) => {
    const b = (balances[i] || []).find((x) => x.leave_type === "Annual");
    if (!b) return { id: p.id, full_name: p.full_name, credit: null, used: null, pending: null, balance: null };
    const adjustment = Number(b.adjustment || 0);
    return {
      id: p.id,
      full_name: p.full_name,
      credit: Number(b.entitlement || 0) + Number(b.carried || 0) + Number(b.accrued || 0) + Math.max(adjustment, 0),
      used: Number(b.used || 0) + Math.max(-adjustment, 0),
      pending: Number(b.pending || 0),
      balance: b.remaining === null || b.remaining === undefined ? null : Number(b.remaining),
    };
  });
}

// The On Leave card: hr_dashboard_period's Annual and Unpaid together, each person marked with which.
export function leaveCard(data) {
  const annual = data?.counts?.leave_annual || 0;
  const unpaid = data?.counts?.leave_unpaid || 0;
  const mark = (list, kind) => (list || []).map((p) => ({ ...p, kind }));
  const people = [...mark(data?.people?.leave_annual, "Annual"), ...mark(data?.people?.leave_unpaid, "Unpaid")]
    .sort((a, b) => a.full_name.localeCompare(b.full_name) || a.kind.localeCompare(b.kind));
  return { count: annual + unpaid, annual, unpaid, people };
}

// Rows from hr_attendance_range -> one entry per employee: { employee_id, employee_code, full_name, days: {date: row}, counts }.
export function groupRange(rows) {
  const by = new Map();
  for (const r of rows || []) {
    if (!by.has(r.employee_id)) {
      by.set(r.employee_id, { employee_id: r.employee_id, employee_code: r.employee_code, full_name: r.full_name, employee_status: r.employee_status, exit_date: r.exit_date ?? null, days: {}, counts: { ...Object.fromEntries(STATUSES.map((s) => [s, 0])), Late: 0, Overtime: 0 } });
    }
    const e = by.get(r.employee_id);
    e.days[r.work_date] = r;
    if (r.status && e.counts[r.status] !== undefined) e.counts[r.status] += 1;
    if (r.late_minutes > 0) e.counts.Late += 1;
    if (r.overtime_minutes > 0) e.counts.Overtime += 1;
  }
  return [...by.values()].sort((a, b) => String(a.employee_code).localeCompare(String(b.employee_code)));
}

// A period with no rows yet, such as next month, still lists today's people, so its holidays can show. Nobody's days are copied across.
export function withEveryone(groups, today) {
  const have = new Set(groups.map((g) => g.employee_id));
  const blank = today.filter((g) => !have.has(g.employee_id)).map((g) => ({ ...g, days: {}, counts: Object.fromEntries(Object.keys(g.counts).map((k) => [k, 0])) }));
  return [...groups, ...blank].sort((a, b) => String(a.employee_code).localeCompare(String(b.employee_code)));
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
