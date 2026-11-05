import { FILTERS } from "../logic/alertLogic";

export const box = { background: "#fff", border: "1px solid #e8e8e8", borderRadius: 8, padding: 14, marginBottom: 14 };
export const btn = { padding: "6px 12px", fontSize: 12, borderRadius: 6, border: "1px solid #d4d4d4", background: "#fff", cursor: "pointer" };
export const btnDark = { ...btn, background: "#111827", color: "#fff", borderColor: "#111827" };

export function Note({ children, tone }) {
  const bad = tone === "bad";
  return (
    <div style={{ background: bad ? "#fee2e2" : "#f8fafc", color: bad ? "#b91c1c" : "#475569", border: `1px solid ${bad ? "#fecaca" : "#e2e8f0"}`, padding: "10px 12px", borderRadius: 8, fontSize: 13, marginBottom: 14 }}>
      {children}
    </div>
  );
}

export function FilterBar({ value, onChange, filters = FILTERS }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
      {filters.map((f) => (
        <button key={f} type="button" onClick={() => onChange(f)} style={{ ...btn, background: value === f ? "#111827" : "#fff", color: value === f ? "#fff" : "#333" }}>{f}</button>
      ))}
    </div>
  );
}
