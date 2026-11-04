export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

const time = (value) => {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
};

// Turns a stored reading into what the tab shows. A reading goes out of date because updates stop when the laptop or
// the Claude app is off; a limit whose reset time has passed no longer has that percentage.
export function describeUsage(reading, now = Date.now()) {
  if (!reading) return null;
  const reportedAt = time(reading.reported_at);
  return {
    plan: reading.plan || null,
    reportedAt: reading.reported_at,
    stale: reportedAt === null || now - reportedAt > STALE_AFTER_MS,
    windows: (reading.windows || []).map((w) => {
      const resetsAt = time(w.resets_at);
      return {
        label: w.label,
        percent: Math.min(100, Math.max(0, Number(w.percent) || 0)),
        resetsAt: w.resets_at || null,
        hasReset: resetsAt !== null && resetsAt <= now,
      };
    }),
  };
}
