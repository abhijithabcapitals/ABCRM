import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabase";
import { statusColor } from "../chartUtils";
import { fmtDate } from "../dateFormat";

// Drill-in for one assignee: lists their tasks and lets you reassign them to
// someone else (or unassign) — e.g. when a person leaves. Uses SECURITY DEFINER
// RPCs so it works regardless of the caller's RLS scope. Pass spaceId to scope
// the list to a single space (per-space Overview); omit it for CRM-wide.
export default function AssigneeTasksModal({ name, actor, people, spaceId, folderId, onOpenScope, onClose, onChanged }) {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(() => new Set());
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    const { data, error } = await supabase.rpc("assignee_tasks", { p_name: name, p_space: spaceId || null, p_folder: folderId || null });
    if (error) setErr(error.message);
    else { setRows(data || []); setSel(new Set((data || []).map((t) => t.id))); }
    setLoading(false);
  }, [name, spaceId, folderId]);
  useEffect(() => { load(); }, [load]);

  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allChecked = rows && rows.length > 0 && sel.size === rows.length;

  async function reassign() {
    if (sel.size === 0) return;
    if (target !== "__unassign__" && !target) { setErr("Pick who to reassign to (or choose Unassign)."); return; }
    const to = target === "__unassign__" ? "" : target;
    const label = to === "" ? "unassign" : `reassign to ${to}`;
    if (!window.confirm(`This will ${label} ${sel.size} task${sel.size > 1 ? "s" : ""} from ${name}. Continue?`)) return;
    setBusy(true); setErr("");
    const { error } = await supabase.rpc("reassign_assignee", {
      p_from: name, p_to: to, p_task_ids: [...sel], p_actor: actor || "Dashboard",
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onChanged?.();
    onClose();
  }

  const targets = (people || []).filter((p) => p !== name);

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 99998, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 12, width: "min(720px, 96vw)", maxHeight: "86vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>{name}</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>{loading ? "Loading…" : `${rows?.length || 0} task${(rows?.length || 0) === 1 ? "" : "s"} assigned${folderId ? " in this folder" : spaceId ? " in this space" : ""}`}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#9ca3af" }}>×</button>
        </div>

        {err && <div style={{ background: "#fef2f2", color: "#b91c1c", fontSize: 12.5, padding: "8px 18px" }}>{err.includes("function") ? "Not available yet — run db/assignee_tasks.sql in Supabase." : err}</div>}

        <div style={{ overflowY: "auto", padding: "6px 10px", flex: 1 }}>
          {loading ? (
            <div style={{ color: "#9ca3af", fontSize: 13, padding: 12 }}>Loading tasks…</div>
          ) : (rows || []).length === 0 ? (
            <div style={{ color: "#9ca3af", fontSize: 13, padding: 12 }}>No tasks assigned. 🎉</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ fontSize: 11, color: "#6b7280", textAlign: "left" }}>
                  <th style={{ padding: "6px 8px", width: 28 }}>
                    <input type="checkbox" checked={allChecked}
                      onChange={() => setSel(allChecked ? new Set() : new Set(rows.map((t) => t.id)))} />
                  </th>
                  <th style={{ padding: "6px 8px" }}>Task</th>
                  <th style={{ padding: "6px 8px" }}>Location</th>
                  <th style={{ padding: "6px 8px" }}>Status</th>
                  <th style={{ padding: "6px 8px" }}>Due</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const overdue = t.due_date && new Date(t.due_date) < new Date();
                  return (
                    <tr key={t.id} style={{ borderTop: "1px solid #f2f2f2", fontSize: 12.5 }}>
                      <td style={{ padding: "6px 8px" }}>
                        <input type="checkbox" checked={sel.has(t.id)} onChange={() => toggle(t.id)} />
                      </td>
                      <td style={{ padding: "6px 8px" }}>
                        <span onClick={() => { onOpenScope?.({ space_id: t.space_id, list_id: t.list_id }, t.id); onClose(); }}
                          style={{ color: "var(--accent)", cursor: "pointer" }}>{t.title || "Untitled"}</span>
                      </td>
                      <td style={{ padding: "6px 8px", color: "#6b7280" }}>{[t.space_name, t.list_name].filter(Boolean).join(" › ") || "—"}</td>
                      <td style={{ padding: "6px 8px" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: statusColor(t.status), display: "inline-block" }} />
                          {t.status}
                        </span>
                      </td>
                      <td style={{ padding: "6px 8px", color: overdue ? "#b91c1c" : "#6b7280", fontWeight: overdue ? 600 : 400 }}>{t.due_date ? fmtDate(t.due_date) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {(rows || []).length > 0 && (
          <div style={{ padding: "12px 18px", borderTop: "1px solid #eee", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, color: "#374151" }}>{sel.size} selected →</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)}
              style={{ fontSize: 13, padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6 }}>
              <option value="">Reassign to…</option>
              {targets.map((p) => <option key={p} value={p}>{p}</option>)}
              <option value="__unassign__">— Unassign —</option>
            </select>
            <button onClick={reassign} disabled={busy || sel.size === 0}
              className="btn btn-primary" style={{ fontSize: 13, padding: "6px 14px", opacity: busy || sel.size === 0 ? 0.6 : 1 }}>
              {busy ? "Working…" : "Apply"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
