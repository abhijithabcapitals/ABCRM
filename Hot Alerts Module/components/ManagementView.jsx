import { useEffect, useState } from "react";
import ScopeView from "./ScopeView";
import Tiles from "./Tiles";
import { Note, box } from "./ui";
import { DUE_DATE_CATEGORIES, MANAGER_FILTERS, scanBand, noteForCategories, fmtScanTime } from "../logic/alertLogic";
import { alertManagementSummary, alertCoverage } from "../services/alertsApi";

const th = { textAlign: "left", fontSize: 11, color: "#888", fontWeight: 600, padding: "6px 10px", borderBottom: "1px solid #eee", whiteSpace: "nowrap" };
const td = { fontSize: 12, padding: "6px 10px", borderBottom: "1px solid #f3f3f3" };
const dash = (v) => (v == null ? "-" : v);

// Management tab (admin only): scan health band, mode banner, summary panels, backlog filter, Coverage.
export default function ManagementView({ supabase, access, today, onOpen, refreshKey }) {
  const [summary, setSummary] = useState(null);
  const [coverage, setCoverage] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [s, c] = await Promise.all([alertManagementSummary(supabase), alertCoverage(supabase)]);
        if (live) { setSummary(s); setCoverage(c); }
      } catch (e) {
        if (live) setError(e.message);
      }
    })();
    return () => { live = false; };
  }, [supabase, refreshKey]);

  const band = scanBand(coverage);
  const dueDates = noteForCategories(coverage, DUE_DATE_CATEGORIES);
  const renewals = noteForCategories(coverage, ["Licence", "Visa & Emirates ID"]);

  return (
    <div>
      {error && <Note tone="bad">{error}</Note>}
      {band && <Note tone="bad">{band}</Note>}
      {access?.mode === "Preview" && <Note>Preview: only management can see these alerts.</Note>}

      {summary && (
        <Tiles items={[
          { label: "Critical Alerts", value: summary.critical, tone: "red" },
          { label: "Today's Work", value: summary.today, note: dueDates },
          { label: "Pending Client Actions", value: summary.client_pending },
          { label: "Government Pending", value: summary.government_pending },
          { label: "Upcoming Renewals", value: summary.renewals, note: renewals },
          { label: "Unassigned Cases", value: summary.unassigned, tone: "orange" },
          // Not built until Phase 3: say so rather than show a 0 that reads as all clear.
          { label: "Delayed Services", text: "Available in Phase 3" },
        ]} />
      )}

      <ScopeView supabase={supabase} scope="Management" today={today} onOpen={onOpen} refreshKey={refreshKey}
        filters={MANAGER_FILTERS} empty={(f) => (f === "All" ? "No open alerts" : "Nothing matches this filter")} tileItems={() => []} />

      {summary && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 14 }}>
          <div style={{ ...box, flex: 1, minWidth: 260 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>Employee Performance</div>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>Counts only. Early data is thin.</div>
            {(summary.performance || []).length === 0 && <div style={{ fontSize: 12, color: "#888" }}>No data yet</div>}
            {(summary.performance || []).map((p) => <div key={p.user_id} style={{ fontSize: 12 }}>{p.name || "Unknown"}: {p.pending} pending, {p.resolved} resolved</div>)}
          </div>
          <div style={{ ...box, flex: 1, minWidth: 260 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Client Risk</div>
            {(summary.client_risk || []).length === 0 && <div style={{ fontSize: 12, color: "#888" }}>No clients with critical alerts</div>}
            {(summary.client_risk || []).map((c) => <div key={c.client_id} style={{ fontSize: 12 }}>{c.client_name || c.client_id}: {c.critical} critical</div>)}
          </div>
        </div>
      )}

      {coverage && (
        <div style={box}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Coverage</div>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
            Last scan: {fmtScanTime(coverage.last_scan_at)} ({coverage.last_scan_status || "none"}). In step means alerts in step at that scan, new or already open. It is not a count of new alerts.
          </div>
          {coverage.escalation_error && <Note tone="bad">Escalation failed at the last scan: {coverage.escalation_error}</Note>}
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Rule</th><th style={th}>Checked</th><th style={th}>With data</th><th style={th}>Missing</th>
                <th style={th}>In step</th><th style={th}>Closed</th><th style={th}>Last scan</th>
              </tr>
            </thead>
            <tbody>
              {(coverage.rules || []).map((r) => (
                <tr key={r.rule}>
                  <td style={td}>
                    {r.rule}{!r.enabled && <span style={{ color: "#888" }}> (off)</span>}
                    {r.error && <div style={{ color: "#b91c1c", fontSize: 11 }}>{r.error}</div>}
                  </td>
                  <td style={td}>{dash(r.checked)}</td><td style={td}>{dash(r.with_data)}</td><td style={td}>{dash(r.missing_data)}</td>
                  <td style={td}>{dash(r.raised)}</td><td style={td}>{dash(r.closed)}</td>
                  <td style={td}>{fmtScanTime(coverage.last_scan_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
