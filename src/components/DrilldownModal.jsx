import { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { statusColor } from "../chartUtils";
import { fmtDate } from "../dateFormat";

// Lists the tasks behind a clicked KPI (via the dashboard_drilldown RPC). Each
// row opens its task in the right space/folder/list. Optionally scoped to one
// space (per-space Overview).
export default function DrilldownModal({ title, metric, spaceId, folderId, onOpenScope, onClose }) {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setErr("");
      const { data, error } = await supabase.rpc("dashboard_drilldown", { p_metric: metric, p_space: spaceId || null, p_folder: folderId || null });
      if (!alive) return;
      if (error) setErr(error.message);
      else setRows(data || []);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [metric, spaceId, folderId]);

  const open = (r) => { onOpenScope?.({ space_id: r.space_id, folder_id: r.folder_id, list_id: r.list_id }, r.id); onClose(); };

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 99998, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 12, width: "min(720px, 96vw)", maxHeight: "86vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>{title}</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>{loading ? "Loading…" : `${rows?.length || 0} task${(rows?.length || 0) === 1 ? "" : "s"}`}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#9ca3af" }}>×</button>
        </div>

        {err && <div style={{ background: "#fef2f2", color: "#b91c1c", fontSize: 12.5, padding: "8px 18px" }}>{err.includes("function") ? "Not available yet — run db/dashboard_drilldown.sql in Supabase." : err}</div>}

        <div style={{ overflowY: "auto", padding: "4px 8px", flex: 1 }}>
          {loading ? (
            <div style={{ color: "#9ca3af", fontSize: 13, padding: 12 }}>Loading…</div>
          ) : (rows || []).length === 0 ? (
            <div style={{ color: "#9ca3af", fontSize: 13, padding: 12 }}>No matching tasks.</div>
          ) : (
            rows.map((r) => (
              <div key={r.id + (r.sub || "")} onClick={() => open(r)}
                style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 10px", borderBottom: "1px solid #f2f2f2", fontSize: 12.5, cursor: "pointer", borderRadius: 6 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#f8fafc"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ color: "var(--accent)", fontWeight: 600, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title || "Untitled"}</span>
                  {r.sub && <span style={{ color: "#9ca3af", fontSize: 11 }}>{r.sub}</span>}
                </span>
                <span style={{ flexShrink: 0, display: "inline-flex", gap: 12, alignItems: "center" }}>
                  {r.status && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#6b7280" }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor(r.status), display: "inline-block" }} />
                      {r.status}
                    </span>
                  )}
                  {r.due && <span style={{ color: "#9ca3af" }}>{fmtDate(r.due)}</span>}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
