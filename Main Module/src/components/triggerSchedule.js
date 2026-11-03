// Schedule wording and form rules for the admin's triggers and scheduled jobs. Everything shown is Dubai time (UTC+4,
// no daylight saving). pg_cron schedules are UTC. The server repeats these checks; they are here for quick feedback.
export const WEEKDAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]];
export const INTERVALS = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440];
export const KINDS = [
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Certain days of the week" },
  { value: "monthly", label: "Once a month" },
  { value: "interval", label: "Repeatedly, every few minutes or hours" },
  { value: "once", label: "Once, on a particular date" },
];

export function timeLabel(t) {
  const [h, m] = String(t).split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
export function everyLabel(minutes) {
  if (minutes === 1) return "Every minute";
  if (minutes % 60) return `Every ${minutes} minutes`;
  const h = minutes / 60;
  return h === 1 ? "Every hour" : `Every ${h} hours`;
}
const pad = (n) => String(n).padStart(2, "0");
const dayList = (days) => {
  const d = [...days].map(Number).sort((a, b) => a - b).join();
  if (d === "1,2,3,4,5,6,7") return "every day";
  if (d === "1,2,3,4,5") return "Mon to Fri";
  return d.split(",").map((x) => WEEKDAYS[Number(x) - 1][1]).join(", ");
};
const dateLabel = (date) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

// Date and "HH:MM" in Dubai for an instant.
export function dubaiParts(value) {
  const shifted = new Date(new Date(value).getTime() + 4 * 3600000).toISOString();
  return { date: shifted.slice(0, 10), time: shifted.slice(11, 16) };
}
export const dubaiToIso = (date, time) => new Date(`${date}T${time}:00+04:00`).toISOString();

export function scheduleText(t) {
  switch (t.kind) {
    case "once": { const p = dubaiParts(t.run_at); return `Once on ${dateLabel(p.date)} at ${timeLabel(p.time)}`; }
    case "interval": return everyLabel(t.every_minutes);
    case "daily": return `Every day at ${timeLabel(t.at_time)}`;
    case "weekly": return `${dayList(t.weekdays)[0].toUpperCase()}${dayList(t.weekdays).slice(1)} at ${timeLabel(t.at_time)}`;
    case "monthly": return `Day ${t.month_day} of each month at ${timeLabel(t.at_time)}${t.month_day > 28 ? ", or the last day of a shorter month" : ""}`;
    default: return "–";
  }
}

// Wording for the common shapes of a UTC cron schedule. Anything else returns null, and the raw schedule stands alone.
export function cronText(cron) {
  const parts = String(cron || "").trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts;
  if (dom !== "*" || mon !== "*" || dow !== "*") return null;
  if (hour === "*") {
    if (min === "*") return "Every minute";
    const step = min.match(/^(?:\*|\d+-59)\/(\d+)$/);
    if (step) return everyLabel(Number(step[1]));
    if (/^\d+$/.test(min)) return `Every hour at ${pad(min)} minutes past`;
    return null;
  }
  if (/^\d+$/.test(min) && /^\d+$/.test(hour)) return `Every day at ${timeLabel(`${(Number(hour) + 4) % 24}:${min}`)}`;
  return null;
}

export const blankForm = (date) => ({ name: "", task_key: "", kind: "daily", date, time: "09:00", every_minutes: 60, weekdays: [1, 2, 3, 4, 5], month_day: 1 });

export function formFromTrigger(t, today) {
  const once = t.kind === "once" && t.run_at ? dubaiParts(t.run_at) : null;
  return {
    ...blankForm(today), name: t.name, task_key: t.task_key, kind: t.kind,
    ...(once || {}),
    ...(t.at_time ? { time: t.at_time.slice(0, 5) } : {}),
    ...(t.every_minutes ? { every_minutes: t.every_minutes } : {}),
    ...(t.weekdays ? { weekdays: t.weekdays } : {}),
    ...(t.month_day ? { month_day: t.month_day } : {}),
  };
}

// What the form asks for that is missing or wrong, as [field id, message] pairs.
export function formProblems(f, task, now = new Date()) {
  const bad = [];
  if (!f.name.trim()) bad.push(["tr-name", "a name"]);
  if (!task) bad.push(["tr-task", "a task"]);
  if (task?.at_most_daily && f.kind === "interval") bad.push(["tr-kind", `a schedule of at most once a day for ${task.label}`]);
  if (f.kind === "once") {
    if (!f.date || !f.time) bad.push(["tr-date", "a date and time"]);
    else if (new Date(dubaiToIso(f.date, f.time)) <= now) bad.push(["tr-date", "a date and time in the future"]);
  } else if (f.kind !== "interval" && !f.time) bad.push(["tr-time", "a time"]);
  if (f.kind === "weekly" && !f.weekdays.length) bad.push(["tr-days", "at least one day of the week"]);
  const day = Number(f.month_day);
  if (f.kind === "monthly" && !(Number.isInteger(day) && day >= 1 && day <= 31)) bad.push(["tr-day", "a day of the month from 1 to 31"]);
  return bad;
}

export function formToArgs(f, id = null) {
  return {
    p_id: id, p_name: f.name.trim(), p_task: f.task_key, p_kind: f.kind,
    p_run_at: f.kind === "once" ? dubaiToIso(f.date, f.time) : null,
    p_every: f.kind === "interval" ? Number(f.every_minutes) : null,
    p_time: ["daily", "weekly", "monthly"].includes(f.kind) ? f.time : null,
    p_weekdays: f.kind === "weekly" ? f.weekdays : null,
    p_month_day: f.kind === "monthly" ? Number(f.month_day) : null,
  };
}

// The form's values in the shape scheduleText reads, for the live preview.
export function formToTrigger(f) {
  const a = formToArgs(f);
  return { kind: f.kind, run_at: a.p_run_at, every_minutes: a.p_every, at_time: a.p_time, weekdays: a.p_weekdays, month_day: a.p_month_day };
}
