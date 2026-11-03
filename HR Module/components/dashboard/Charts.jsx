// Plain SVG with text labels, so the numbers read without hovering.
const COLOURS = { present: "#2f9e5b", absent: "#d9574e", late: "#e08a2e" };

export function DailyShare({ counts }) {
  // Late is a part of Present: on time and late fill the bar, and absent the rest.
  const present = counts.present || 0;
  const late = Math.min(counts.late || 0, present);
  const parts = [{ key: "present", value: present - late, label: "On time" }, { key: "late", value: late, label: "Late" }, { key: "absent", value: counts.absent || 0, label: "Absent" }];
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return <p className="bk-note hr-quiet">Nothing counted for this period.</p>;
  let x = 0;
  return (
    <div>
      <svg className="hr-share" viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(", ")}>
        {parts.map((p) => {
          const w = (p.value / total) * 100;
          const r = <rect key={p.key} x={x} y="0" width={w} height="8" fill={COLOURS[p.key]} />;
          x += w;
          return r;
        })}
      </svg>
      <div className="hr-chart-key">
        {parts.map((p) => <span key={p.key}><i style={{ background: COLOURS[p.key] }} />{p.label} {p.value} ({Math.round((p.value / total) * 100)}%)</span>)}
      </div>
    </div>
  );
}

// Present per day. Late is a part of Present, so it is not stacked on top.
export function PresentBars({ series }) {
  const rows = series || [];
  const max = Math.max(1, ...rows.map((r) => r.present));
  const w = 100 / Math.max(rows.length, 1);
  if (!rows.some((r) => r.present)) return <p className="bk-note hr-quiet">No one present in this period.</p>;
  return (
    <div>
      <svg className="hr-bars" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={`Present per day. Most in one day: ${max}`}>
        {rows.map((r, i) => <rect key={r.date} x={i * w + w * 0.1} y={40 - (r.present / max) * 40} width={w * 0.8} height={(r.present / max) * 40} fill={COLOURS.present}><title>{r.date}: {r.present} present, {r.absent} absent, {r.late} late</title></rect>)}
      </svg>
      <div className="hr-chart-axis"><span>{rows[0]?.date}</span><span>Most in one day: {max}</span><span>{rows.at(-1)?.date}</span></div>
    </div>
  );
}
