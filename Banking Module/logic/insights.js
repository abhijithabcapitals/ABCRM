// Turns dashboard figures into the sentence a reader needs first. Pure, so it is tested.
// A rate on few decided cases is not a finding, so it is never named best or worst.
export const MIN_DECIDED = 5;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (ym) => { const [y, m] = ym.split("-"); return `${MONTHS[+m - 1]} ${y.slice(2)}`; };

// Last n months, with empty months filled as zero so gaps read as gaps.
export function monthSeries(data, n = 12, now = new Date()) {
  const map = Object.fromEntries((data || []).map((d) => [d.label, Number(d.value) || 0]));
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const keys = Object.keys(map).sort();
  if (!keys.length) return [];
  const last = keys[keys.length - 1] > current ? keys[keys.length - 1] : current;
  const [ly, lm] = last.split("-").map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(ly, lm - 1 - i, 1));
    const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    out.push({ ym, label: monthLabel(ym), value: map[ym] || 0, partial: ym === current });
  }
  return out;
}

// Compares the latest complete month with the one before; the running month is only "so far".
export function trendSummary(series) {
  const done = series.filter((m) => !m.partial);
  const latest = done[done.length - 1];
  const prev = done[done.length - 2];
  const partial = series.find((m) => m.partial);
  if (!latest) return { latest: null, partial };
  const change = prev && prev.value > 0 ? Math.round((100 * (latest.value - prev.value)) / prev.value) : null;
  const window = done.slice(-4, -1);
  const average = window.length ? Math.round(window.reduce((s, m) => s + m.value, 0) / window.length) : null;
  return { latest, prev, change, average, partial };
}

export function bankInsight(banks) {
  const decided = (banks || []).filter((b) => b.rate != null && Number(b.approved) + Number(b.rejected) >= MIN_DECIDED);
  if (!decided.length) return "Too few decided applications to compare approval rates yet.";
  const sorted = [...decided].sort((a, b) => b.rate - a.rate);
  const best = sorted[0], worst = sorted[sorted.length - 1];
  return best === worst ? `${best.label} approves ${best.rate}% of decided applications.` : `${best.label} approves most (${best.rate}%). ${worst.label} approves least (${worst.rate}%).`;
}

export function shareInsight(rows, noun) {
  const total = (rows || []).reduce((s, r) => s + Number(r.value), 0);
  if (!total) return `No ${noun} in this period.`;
  const top = [...rows].sort((a, b) => b.value - a.value)[0];
  const share = Math.round((100 * top.value) / total);
  return share === 100 ? `All ${total} ${noun} are ${top.label}.` : `${top.label} accounts for ${share}% of ${total} ${noun}.`;
}
