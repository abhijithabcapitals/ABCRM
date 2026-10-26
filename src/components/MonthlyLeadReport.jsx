import { useState, useEffect, useMemo } from "react";
import { supabase } from "../supabase";
import { Card } from "./charts";
import { statusColor } from "../chartUtils";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// One consolidated Monthly Lead Report: rows = lists (that have a created_time
// field), columns = task statuses, for a single month/year chosen with the
// dropdowns. Counts come from the lead_monthly_report RPC (one call per list).
export default function MonthlyLeadReportScope({ spaceId, folderId, onOpenScope }) {
  const [lists, setLists] = useState([]);        // [{id,name,folder_id,space_id}]
  const [byList, setByList] = useState({});      // listId -> [{ym,status,cnt}]
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(null);
  const [month, setMonth] = useState(null);      // 1..12

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      let lq = supabase.from("lists").select("id, name, folder_id, space_id").is("deleted_at", null);
      if (folderId) lq = lq.eq("folder_id", folderId);
      else if (spaceId) lq = lq.eq("space_id", spaceId);
      else { setLists([]); setLoading(false); return; }
      const { data: allLists } = await lq;
      const ids = (allLists || []).map((l) => l.id);
      if (!ids.length) { if (alive) { setLists([]); setLoading(false); } return; }
      const { data: fields } = await supabase
        .from("space_fields").select("list_id").ilike("field_name", "created_time").in("list_id", ids);
      const withCreated = new Set((fields || []).map((f) => f.list_id));
      const cand = (allLists || []).filter((l) => withCreated.has(l.id));
      const results = await Promise.all(
        cand.map((l) => supabase.rpc("lead_monthly_report", { p_list_id: l.id })
          .then(({ data }) => ({ id: l.id, rows: data || [] })))
      );
      if (!alive) return;
      const map = {};
      results.forEach((r) => { map[r.id] = r.rows; });
      setLists(cand);
      setByList(map);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [spaceId, folderId]);

  // Default the picker to the most recent month that has data.
  useEffect(() => {
    if (year != null || loading) return;
    let latest = null;
    Object.values(byList).forEach((rows) => rows.forEach((r) => {
      if (r.ym && r.ym !== "Undated" && (!latest || r.ym > latest)) latest = r.ym;
    }));
    if (latest) { setYear(latest.slice(0, 4)); setMonth(Number(latest.slice(5, 7))); }
    else { const d = new Date(); setYear(String(d.getFullYear())); setMonth(d.getMonth() + 1); }
  }, [byList, loading, year]);

  const years = useMemo(() => {
    const s = new Set();
    Object.values(byList).forEach((rows) => rows.forEach((r) => {
      if (r.ym && r.ym !== "Undated") s.add(r.ym.slice(0, 4));
    }));
    const arr = [...s].sort((a, b) => b.localeCompare(a));
    return arr.length ? arr : [String(new Date().getFullYear())];
  }, [byList]);

  // Column statuses = union across all lists, ordered by overall volume.
  const statuses = useMemo(() => {
    const tot = new Map();
    Object.values(byList).forEach((rows) => rows.forEach((r) => {
      tot.set(r.status, (tot.get(r.status) || 0) + Number(r.cnt));
    }));
    return [...tot.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  }, [byList]);

  const ymSel = year && month ? `${year}-${String(month).padStart(2, "0")}` : null;

  const rows = lists.map((l) => {
    const cells = {};
    let total = 0;
    (byList[l.id] || []).forEach((r) => {
      if (r.ym === ymSel) { cells[r.status] = (cells[r.status] || 0) + Number(r.cnt); total += Number(r.cnt); }
    });
    return { list: l, cells, total };
  });
  const colTotals = {};
  let grand = 0;
  rows.forEach((row) => { statuses.forEach((s) => { colTotals[s] = (colTotals[s] || 0) + (row.cells[s] || 0); }); grand += row.total; });

  const th = { textAlign: "right", padding: "9px 12px", fontSize: 11, fontWeight: 700, color: "#64748b", whiteSpace: "nowrap", letterSpacing: "0.02em", textTransform: "uppercase" };
  const td = { textAlign: "right", padding: "9px 12px", fontSize: 13, color: "#111827", whiteSpace: "nowrap" };

  // Segmented month/year picker with a prev/next month stepper, rendered inline
  // beside the card title.
  const stepMonth = (delta) => {
    if (!year || !month) return;
    let m = month + delta, y = Number(year);
    if (m < 1) { m = 12; y -= 1; } else if (m > 12) { m = 1; y += 1; }
    setMonth(m); setYear(String(y));
  };
  const navBtn = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 30, border: "none", background: "transparent", color: "#64748b", cursor: "pointer", fontSize: 14, lineHeight: 1 };
  const bareSelect = { appearance: "none", WebkitAppearance: "none", MozAppearance: "none", border: "none", background: "transparent", fontSize: 13, fontWeight: 600, color: "#111827", padding: "5px 8px", cursor: "pointer", outline: "none", textAlign: "center", textAlignLast: "center", boxSizing: "content-box" };
  const picker = (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 2, background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 9, padding: 2 }}>
      <button type="button" aria-label="Previous month" onClick={() => stepMonth(-1)} style={navBtn}>‹</button>
      <select value={month ?? ""} onChange={(e) => setMonth(Number(e.target.value))} style={{ ...bareSelect, minWidth: 40 }}>
        {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
      </select>
      <select value={year ?? ""} onChange={(e) => setYear(e.target.value)} style={{ ...bareSelect, minWidth: 48 }}>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      <button type="button" aria-label="Next month" onClick={() => stepMonth(1)} style={navBtn}>›</button>
    </div>
  );

  if (!loading && lists.length === 0) return null;

  return (
    <Card
      title="Monthly Lead Report"
      tip="Leads per list for the selected month, by task status. Counts each task once by the month of its created_time."
      action={picker}
      style={{ marginBottom: 16 }}
    >
      {loading ? (
        <div style={{ fontSize: 12.5, color: "#9ca3af", padding: "8px 0" }}>Loading report…</div>
      ) : grand === 0 ? (
        <div style={{ fontSize: 12.5, color: "#9ca3af", padding: "18px 0", textAlign: "center" }}>
          No leads in {MONTHS[(month || 1) - 1]} {year}.
        </div>
      ) : (
        <div style={{ overflowX: "auto", margin: "0 -18px", padding: "0 18px" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 480 }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                <th style={{ ...th, textAlign: "left", borderTopLeftRadius: 8, borderBottomLeftRadius: 8 }}>List</th>
                {statuses.map((s) => (
                  <th key={s} style={th}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor(s), display: "inline-block" }} />
                      {s}
                    </span>
                  </th>
                ))}
                <th style={{ ...th, color: "#111827", borderTopRightRadius: 8, borderBottomRightRadius: 8 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.list.id}
                  onClick={onOpenScope ? () => onOpenScope({ space_id: row.list.space_id, folder_id: row.list.folder_id, list_id: row.list.id }, null) : undefined}
                  style={{ borderTop: "1px solid #f1f5f9", cursor: onOpenScope ? "pointer" : "default", transition: "background 0.12s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "#f8fafc"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                  <td style={{ ...td, textAlign: "left", fontWeight: 600, color: onOpenScope ? "var(--accent)" : "#111827" }}>{row.list.name}</td>
                  {statuses.map((s) => (
                    <td key={s} style={{ ...td, color: row.cells[s] ? "#111827" : "#cbd5e1", fontVariantNumeric: "tabular-nums" }}>{row.cells[s] || 0}</td>
                  ))}
                  <td style={{ ...td, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{row.total}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid #e5e7eb" }}>
                <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>Total</td>
                {statuses.map((s) => (
                  <td key={s} style={{ ...td, fontWeight: 700, color: "#374151", fontVariantNumeric: "tabular-nums" }}>{colTotals[s] || 0}</td>
                ))}
                <td style={{ ...td, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{grand}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}
