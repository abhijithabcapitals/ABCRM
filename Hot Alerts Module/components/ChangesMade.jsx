import { useEffect, useState } from "react";
import { box, btn, Note } from "./ui";
import { changesMadeList, changesMadeMarkSeen } from "../services/alertsApi";
import { CHANGE_GROUPS, filterChanges, changeWhat, showValue } from "../logic/changesLogic";
import { isNotSwitchedOn } from "../logic/alertLogic";

const DAYS = [7, 30, 90, 365];
const when = (ts) => new Date(ts).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" });
const th = { textAlign: "left", padding: "7px 8px", fontSize: 11, fontWeight: 600, color: "#6b7280", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" };
const td = { padding: "7px 8px", fontSize: 12, borderBottom: "1px solid #f1f1f1", verticalAlign: "top" };

// CHANGES MADE: changes to client licence, registration, shareholder, Emirates ID and passport data.
// The card shows what changed since you last opened it; clicking it lists every change, who made it and when.
export default function ChangesMade({ supabase, refreshKey, onOpenClient }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(30);
  const [group, setGroup] = useState("All");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let live = true;
    changesMadeList(supabase, days, 500)
      .then((d) => { if (live) { setData(d); setError(""); } })
      .catch((e) => { if (live) { if (isNotSwitchedOn(e)) setData(null); else setError(e.message); } });
    return () => { live = false; };
  }, [supabase, days, refreshKey]);

  if (error) return <Note tone="bad">Changes Made: {error}</Note>;
  if (!data?.allowed) return null;

  async function toggle() {
    const next = !open;
    setOpen(next);
    // The list keeps its "New" marks while open; the card count clears.
    if (next && data.new_count > 0) {
      try { await changesMadeMarkSeen(supabase); setData((d) => ({ ...d, new_count: 0 })); } catch (e) { setError(e.message); }
    }
  }

  const rows = filterChanges(data.items, group, query);
  const fresh = data.new_count > 0;

  return (
    <div style={{ marginBottom: 14 }}>
      <button type="button" onClick={toggle} title="Show the list of changes"
        style={{ display: "inline-flex", alignItems: "center", gap: 14, background: fresh ? "#fff7ed" : "#fff", border: `1px solid ${fresh ? "#fdba74" : "#e8e8e8"}`,
          borderRadius: 8, padding: "10px 14px", cursor: "pointer", textAlign: "left", minWidth: 220 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: fresh ? "#c2410c" : "#111827" }}>{fresh ? data.new_count : data.total}</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", letterSpacing: 0.4 }}>CHANGES MADE</div>
          <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>
            {fresh ? `new since you last looked · ${data.total} in ${days} days` : `in the last ${days} days`}
          </div>
        </div>
        <span style={{ fontSize: 12, color: "#6b7280" }}>{open ? "Hide ▲" : "View ▼"}</span>
      </button>

      {open && (
        <div style={{ ...box, marginTop: 10 }}>
          <div style={{ fontSize: 12, color: "#888", marginBottom: 10 }}>
            Trade licence, registration numbers and dates, shareholders, Emirates ID and passport changes. Emirates ID and passport numbers show their last 4 characters only.
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {CHANGE_GROUPS.map((g) => (
              <button key={g.key} type="button" onClick={() => setGroup(g.key)}
                style={{ ...btn, background: group === g.key ? "#111827" : "#fff", color: group === g.key ? "#fff" : "#333" }}>{g.key}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search client, person, field or who" aria-label="Search changes"
              style={{ ...btn, cursor: "text", minWidth: 260 }} />
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period" style={btn}>
              {DAYS.map((d) => <option key={d} value={d}>Last {d} days</option>)}
            </select>
            <span style={{ fontSize: 12, color: "#888" }}>{rows.length} shown</span>
          </div>

          {rows.length === 0 ? (
            <div style={{ fontSize: 13, color: "#9ca3af", padding: "18px 4px" }}>No changes in this period.</div>
          ) : (
            <div style={{ overflowX: "auto", maxHeight: 480, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead style={{ position: "sticky", top: 0, background: "#fff" }}>
                  <tr><th style={th}>When</th><th style={th}>Client</th><th style={th}>What changed</th><th style={th}>From</th><th style={th}>To</th><th style={th}>Changed by</th><th style={th}>Source</th></tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} style={{ background: c.is_new ? "#fffbeb" : "transparent" }}>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        {when(c.changed_at)}
                        {c.is_new && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "#c2410c" }}>NEW</span>}
                      </td>
                      <td style={td}>
                        {onOpenClient
                          ? <button type="button" onClick={() => onOpenClient(c.client_id)} style={{ background: "none", border: "none", padding: 0, color: "var(--accent)", cursor: "pointer", fontSize: 12, textAlign: "left" }}>{c.client_name || c.client_id}</button>
                          : (c.client_name || c.client_id)}
                        <div style={{ fontSize: 10, color: "#9ca3af" }}>{c.client_id}</div>
                      </td>
                      <td style={{ ...td, fontWeight: 600 }}>{changeWhat(c)}</td>
                      <td style={{ ...td, color: "#6b7280", maxWidth: 260, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{showValue(c.old_value)}</td>
                      <td style={{ ...td, maxWidth: 260, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{showValue(c.new_value)}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{c.changed_by_name}</td>
                      <td style={{ ...td, whiteSpace: "nowrap", color: "#6b7280" }}>{c.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
