// Palette + status color mapping shared by the chart components and their
// consumers. Kept separate from charts.jsx so that file only exports React
// components (Fast Refresh requirement).

export const PALETTE = [
  "#0d7d82", "#f59e0b", "#6366f1", "#22c55e", "#ef4444", "#14b8a6",
  "#a855f7", "#ec4899", "#84cc16", "#f97316", "#3b82f6", "#64748b",
];

export function statusColor(status) {
  const s = (status || "").toLowerCase();
  if (/done|complete/.test(s)) return "#22c55e";
  if (/progress/.test(s)) return "#3b82f6";
  if (/cancel|closed|reject/.test(s)) return "#ef4444";
  if (/to ?do|open|new|pending/.test(s)) return "#94a3b8";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
