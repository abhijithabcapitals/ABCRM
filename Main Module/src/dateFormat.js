// Shared date display helpers so every view formats dates the same way.
// Display format is dd-mm-yyyy. Uses UTC parts so a date-only ISO string
// like "2026-10-08" doesn't shift a day across timezones.

export function fmtDMY(d) {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

export function fmtDate(str) {
  if (!str) return "—";
  const d = new Date(str);
  if (isNaN(d)) return str;
  return fmtDMY(d);
}
