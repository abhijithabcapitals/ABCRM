// A row of count tiles. items: [{ label, value, tone? }]
const TONES = { red: "#b91c1c", orange: "#c2410c", blue: "#1d4ed8", grey: "#111827" };

export default function Tiles({ items }) {
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
      {items.map((t) => (
        <div key={t.label} style={{ background: "#fff", border: "1px solid #e8e8e8", borderRadius: 8, padding: "10px 14px", minWidth: 120 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: TONES[t.tone] || TONES.grey }}>{t.value ?? "-"}</div>
          <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{t.label}</div>
        </div>
      ))}
    </div>
  );
}
