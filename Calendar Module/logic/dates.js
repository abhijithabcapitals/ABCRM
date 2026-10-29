// Date helpers for the Calendar Module. Day keys are "YYYY-MM-DD" strings in
// a given IANA time zone, so a calendar shows days as the viewer's office sees
// them (default Asia/Dubai) regardless of the browser's own zone.

export const DEFAULT_TZ = "Asia/Dubai";
const DAY = 864e5;

export function dayKeyIn(timezone, value) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(value));
}

export function todayKey(timezone) {
  return dayKeyIn(timezone, Date.now());
}

// Add whole days to a day key.
export function addDays(key, n) {
  return new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

export function monthOf(key) {
  return { y: +key.slice(0, 4), m: +key.slice(5, 7) };
}

export function addMonths({ y, m }, delta) {
  const n = m - 1 + delta;
  return { y: y + Math.floor(n / 12), m: ((n % 12) + 12) % 12 + 1 };
}

// 6 x 7 grid of day keys for a month, weeks starting on `weekStart` (0 = Sunday, 1 = Monday).
export function monthGrid({ y, m }, weekStart = 1) {
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() - weekStart + 7) % 7;
  const start = first.getTime() - lead * DAY;
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start + i * DAY);
    return { key: d.toISOString().slice(0, 10), day: d.getUTCDate(), inMonth: d.getUTCMonth() === m - 1 };
  });
}

// ISO range that safely covers every day key in [firstKey, lastKey] in any zone.
export function rangeFor(firstKey, lastKey) {
  return {
    from: new Date(Date.parse(`${firstKey}T00:00:00Z`) - DAY).toISOString(),
    to: new Date(Date.parse(`${lastKey}T00:00:00Z`) + 2 * DAY).toISOString(),
  };
}

export function monthLabel({ y, m }) {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export function weekdayLabels(weekStart = 1) {
  const base = Date.UTC(2026, 0, 4); // a Sunday
  return Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(base + ((i + weekStart) % 7) * DAY)).slice(0, 2));
}

// "Today", "Tomorrow" or "Fri 31/10".
export function dayHeading(key, timezone) {
  const today = todayKey(timezone);
  if (key === today) return "Today";
  if (key === addDays(today, 1)) return "Tomorrow";
  const d = new Date(`${key}T00:00:00Z`);
  const wd = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(d);
  return `${wd} ${key.slice(8, 10)}/${key.slice(5, 7)}${key.slice(0, 4) === today.slice(0, 4) ? "" : `/${key.slice(0, 4)}`}`;
}

export function timeIn(timezone, value) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

// Group events by day key, each day sorted by start.
export function groupByDay(events, timezone) {
  const out = {};
  for (const e of events) (out[dayKeyIn(timezone, e.start)] ||= []).push(e);
  for (const list of Object.values(out)) list.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  return out;
}
