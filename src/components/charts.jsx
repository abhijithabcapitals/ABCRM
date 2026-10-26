// Lightweight, dependency-free charts (SVG + CSS) styled to the app's palette.
// Used by the Dashboard and Space Overview. Palette/statusColor live in
// ../chartUtils so this file exports only components.

// Small circled "i" with a native hover tooltip explaining a metric.
export function InfoDot({ tip }) {
  return (
    <span title={tip} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 15, height: 15, borderRadius: "50%", border: "1px solid #cbd5e1", color: "#94a3b8", fontSize: 10, fontWeight: 700, cursor: "help", marginLeft: 6, flexShrink: 0, fontStyle: "italic" }}>i</span>
  );
}

export function Card({ title, action, children, style, tip }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #eef0f0", borderRadius: 14, padding: 18, boxShadow: "0 1px 2px rgba(16,24,40,0.04)", ...style }}>
      {(title || action) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "#111827", display: "flex", alignItems: "center" }}>{title}{tip && <InfoDot tip={tip} />}</div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function Kpi({ label, value, sub, tone, icon, tip, onClick }) {
  const color = tone === "danger" ? "#dc2626" : tone === "warn" ? "#b45309" : tone === "good" ? "#15803d" : "#111827";
  const accent = tone === "danger" ? "#ef4444" : tone === "warn" ? "#f59e0b" : tone === "good" ? "#22c55e" : "#cbd5e1";
  return (
    <div
      onClick={onClick}
      style={{ background: "#fff", border: "1px solid #eef0f0", borderLeft: `3px solid ${accent}`, borderRadius: 14, padding: "16px 18px", flex: 1, minWidth: 150, boxShadow: "0 1px 2px rgba(16,24,40,0.04)", cursor: onClick ? "pointer" : "default", transition: "box-shadow 0.12s, transform 0.12s" }}
      onMouseEnter={onClick ? (e) => { e.currentTarget.style.boxShadow = "0 4px 14px rgba(16,24,40,0.10)"; e.currentTarget.style.transform = "translateY(-1px)"; } : undefined}
      onMouseLeave={onClick ? (e) => { e.currentTarget.style.boxShadow = "0 1px 2px rgba(16,24,40,0.04)"; e.currentTarget.style.transform = "none"; } : undefined}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 12.5, color: "#6b7280", fontWeight: 600, display: "flex", alignItems: "center" }}>{label}{tip && <InfoDot tip={tip} />}</div>
        {icon}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color, marginTop: 8, letterSpacing: "-0.5px" }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: "#9ca3af", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// Donut with legend. data = [{ label, value, color }]
export function Donut({ data, size = 150, thickness = 22, centerLabel, centerSub, onSliceClick }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  // Precompute each segment's dash length and start offset (no mutation during render).
  const segs = [];
  data.reduce((offset, d) => {
    const dash = (d.value / total) * c;
    segs.push({ color: d.color, dash, offset, datum: d });
    return offset + dash;
  }, 0);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f2f2" strokeWidth={thickness} />
          {segs.map((s, i) => (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={s.color} strokeWidth={thickness}
              strokeDasharray={`${s.dash} ${c - s.dash}`} strokeDashoffset={-s.offset}
              style={onSliceClick ? { cursor: "pointer" } : undefined}
              onClick={onSliceClick ? () => onSliceClick(s.datum) : undefined} />
          ))}
        </g>
        {centerLabel != null && (
          <text x="50%" y="47%" textAnchor="middle" style={{ fontSize: 22, fontWeight: 800, fill: "#111827" }}>{centerLabel}</text>
        )}
        {centerSub && (
          <text x="50%" y="62%" textAnchor="middle" style={{ fontSize: 10, fill: "#9ca3af" }}>{centerSub}</text>
        )}
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: onSliceClick ? "pointer" : "default", borderRadius: 5, padding: "1px 3px" }}
            onClick={onSliceClick ? () => onSliceClick(d) : undefined}
            onMouseEnter={onSliceClick ? (e) => { e.currentTarget.style.background = "#f4f6f8"; } : undefined}
            onMouseLeave={onSliceClick ? (e) => { e.currentTarget.style.background = "transparent"; } : undefined}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: d.color, flexShrink: 0 }} />
            <span style={{ color: onSliceClick ? "var(--accent)" : "#374151", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 150 }}>{d.label}</span>
            <span style={{ color: "#9ca3af", marginLeft: "auto", fontWeight: 600 }}>{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Horizontal bars. data = [{ label, value, sub, color }]
export function HBars({ data, max, emptyText = "No data", onRowClick }) {
  if (!data || data.length === 0) return <div style={{ fontSize: 12.5, color: "#9ca3af" }}>{emptyText}</div>;
  const m = max || Math.max(...data.map((d) => d.value), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {data.map((d, i) => (
        <div key={i}
          onClick={onRowClick ? () => onRowClick(d) : undefined}
          style={onRowClick ? { cursor: "pointer" } : undefined}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
            <span style={{ color: onRowClick ? "var(--accent)" : "#374151", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "72%" }}>{d.label}</span>
            <span style={{ color: "#6b7280", fontWeight: 600 }}>{d.sub != null ? d.sub : d.value}</span>
          </div>
          <div style={{ height: 8, background: "#f1f2f2", borderRadius: 5, overflow: "hidden" }}>
            <div style={{ width: `${(d.value / m) * 100}%`, height: "100%", background: d.color || "var(--accent)", borderRadius: 5 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Grouped vertical bars for two series. data = [{ month, created, completed }]
export function TrendBars({ data }) {
  if (!data || data.length === 0) return <div style={{ fontSize: 12.5, color: "#9ca3af" }}>No data</div>;
  const max = Math.max(...data.flatMap((d) => [d.created, d.completed]), 1);
  const H = 130;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 14, height: H, padding: "0 4px" }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: H, width: "100%", justifyContent: "center" }}>
              <div title={`Created: ${d.created}`} style={{ width: 12, height: `${(d.created / max) * H}px`, background: "var(--accent)", borderRadius: "3px 3px 0 0", minHeight: d.created ? 2 : 0 }} />
              <div title={`Completed: ${d.completed}`} style={{ width: 12, height: `${(d.completed / max) * H}px`, background: "#22c55e", borderRadius: "3px 3px 0 0", minHeight: d.completed ? 2 : 0 }} />
            </div>
            <div style={{ fontSize: 10, color: "#9ca3af" }}>{(d.month || "").slice(5)}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 11.5, color: "#6b7280" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--accent)" }} /> Created</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: "#22c55e" }} /> Completed</span>
      </div>
    </div>
  );
}

// Delta vs a previous value. goodWhenUp flips the color meaning (e.g. "completed"
// up is good/green; "overdue" up is bad/red).
export function DeltaBadge({ curr, prev, goodWhenUp = true, suffix = "" }) {
  const d = (curr ?? 0) - (prev ?? 0);
  if (d === 0) return <span style={{ fontSize: 11, color: "#9ca3af" }}>no change vs prior 30d</span>;
  const up = d > 0;
  const good = up === goodWhenUp;
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: good ? "#15803d" : "#dc2626" }}>
      {up ? "▲" : "▼"} {Math.abs(d)}{suffix} vs prior 30d
    </span>
  );
}

// Segmented horizontal bar. segs = [{ label, value, color }]
export function SegmentBar({ segs }) {
  const total = segs.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div>
      <div style={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden", background: "#f1f2f2" }}>
        {segs.map((s, i) => s.value > 0 && (
          <div key={i} title={`${s.label}: ${s.value}`} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
        {segs.map((s, i) => (
          <span key={i} style={{ fontSize: 11.5, color: "#6b7280", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color }} /> {s.label} <strong style={{ color: "#374151" }}>{s.value}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

export function ProgressBar({ pct, color = "var(--accent)", height = 8 }) {
  const p = Math.max(0, Math.min(100, pct || 0));
  return (
    <div style={{ height, background: "#f1f2f2", borderRadius: 5, overflow: "hidden" }}>
      <div style={{ width: `${p}%`, height: "100%", background: color, borderRadius: 5 }} />
    </div>
  );
}
