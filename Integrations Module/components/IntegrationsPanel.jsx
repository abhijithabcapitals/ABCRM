import { useEffect, useState } from "react";
import registry from "../registry.json";

const STATUS = {
  in_use: { label: "In use", bg: "#dcfce7", color: "#15803d" },
  ready: { label: "Code ready", bg: "#e0f2fe", color: "#075985" },
  planned: { label: "Planned", bg: "#f3f4f6", color: "#4b5563" },
};

// Admin view of every integration and its Supabase secret names. Shows only
// whether a secret has a value (from the integrations-status function).
export default function IntegrationsPanel({ supabase }) {
  const [configured, setConfigured] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState("");

  async function load() {
    setError("");
    const { data, error: fnError } = await supabase.functions.invoke("integrations-status", { body: {} });
    if (fnError || data?.error) {
      let message = data?.error || fnError?.message;
      try { message = (await fnError?.context?.json())?.error || message; } catch { /* keep message */ }
      setError(message || "Could not check which secrets are set.");
      return;
    }
    setConfigured(data.configured || {});
  }

  useEffect(() => { load(); }, []);

  function copy(name) {
    navigator.clipboard?.writeText(name);
    setCopied(name);
    setTimeout(() => setCopied(""), 1200);
  }

  const q = query.trim().toLowerCase();
  const groups = registry.groups
    .map((g) => ({
      ...g,
      integrations: g.integrations.filter((i) =>
        !q || [i.name, i.usedBy, ...i.secrets.map((s) => s.name)].join(" ").toLowerCase().includes(q)),
    }))
    .filter((g) => g.integrations.length);

  const all = registry.groups.flatMap((g) => g.integrations.flatMap((i) => i.secrets));
  const setCount = configured ? all.filter((s) => configured[s.name]).length : null;

  return (
    <div>
      <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#374151", lineHeight: 1.5 }}>
        Add values in <b>Supabase → Edge Functions → Secrets</b> using the exact names below. Values are never
        shown here. A filled secret is picked up without redeploying. The list lives in
        <code style={{ margin: "0 4px" }}>Integrations Module/registry.json</code>.
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search integration or secret name…"
          style={{ flex: 1, minWidth: 220, padding: "8px 11px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }}
        />
        <span style={{ fontSize: 12, color: "#6b7280" }}>
          {setCount === null ? "Checking secrets…" : `${setCount} of ${all.length} secrets set`}
        </span>
        <button className="btn" onClick={load} type="button">Refresh</button>
      </div>

      {error && (
        <div style={{ background: "#fee2e2", color: "#b91c1c", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>
          {error} The names below are still correct.
        </div>
      )}

      {groups.map((g) => (
        <div key={g.id} style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
            {g.label}
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {g.integrations.map((i) => {
              const st = STATUS[i.status] || STATUS.planned;
              return (
                <div key={i.id} style={{ background: "#fff", border: "1px solid #e8e8e8", borderRadius: 8, padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{i.name}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: "1px 8px", borderRadius: 20, background: st.bg, color: st.color }}>{st.label}</span>
                  </div>
                  {(i.usedBy || i.notes) && (
                    <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>{i.usedBy || i.notes}</div>
                  )}
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                      <tbody>
                        {i.secrets.map((s) => {
                          const isSet = configured?.[s.name];
                          return (
                            <tr key={s.name} style={{ borderTop: "1px solid #f3f4f6" }}>
                              <td style={{ padding: "6px 8px 6px 0", whiteSpace: "nowrap", width: 1 }}>
                                <span
                                  title={configured ? (isSet ? "Set" : "Not set") : "Unknown"}
                                  style={{ display: "inline-block", width: 8, height: 8, borderRadius: 8, marginRight: 8,
                                    background: configured ? (isSet ? "#16a34a" : "#d1d5db") : "#e5e7eb" }}
                                />
                                <button
                                  type="button"
                                  onClick={() => copy(s.name)}
                                  title="Copy name"
                                  style={{ fontFamily: "Consolas, monospace", fontSize: 12, background: "#f3f4f6", border: "none", borderRadius: 4, padding: "2px 6px", cursor: "pointer" }}
                                >
                                  {copied === s.name ? "Copied" : s.name}
                                </button>
                              </td>
                              <td style={{ padding: "6px 8px", color: "#374151" }}>{s.use}</td>
                              <td style={{ padding: "6px 0 6px 8px", color: "#9ca3af" }}>{s.source}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
