import { useEffect, useState, useCallback } from "react";
import HotAlerts from "./HotAlerts";
import AlertList from "./AlertList";
import AlertDrawer from "./AlertDrawer";
import Tiles from "./Tiles";
import { FILTERS, dubaiToday, emptyText, isNotSwitchedOn, tabsFor } from "../logic/alertLogic";
import {
  alertMyAccess, alertList, alertTiles, alertManagementSummary, alertCoverage, alertSetMode, alertScanNow,
} from "../services/alertsApi";

const box = { background: "#fff", border: "1px solid #e8e8e8", borderRadius: 8, padding: 14, marginBottom: 14 };
const btn = { padding: "6px 12px", fontSize: 12, borderRadius: 6, border: "1px solid #d4d4d4", background: "#fff", cursor: "pointer" };

function Note({ children, tone }) {
  const bad = tone === "bad";
  return (
    <div style={{ background: bad ? "#fee2e2" : "#f8fafc", color: bad ? "#b91c1c" : "#475569", border: `1px solid ${bad ? "#fecaca" : "#e2e8f0"}`, padding: "10px 12px", borderRadius: 8, fontSize: 13, marginBottom: 14 }}>
      {children}
    </div>
  );
}

function FilterBar({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
      {FILTERS.map((f) => (
        <button key={f} type="button" onClick={() => onChange(f)} style={{ ...btn, background: value === f ? "#111827" : "#fff", color: value === f ? "#fff" : "#333" }}>{f}</button>
      ))}
    </div>
  );
}

// One scope (My, Department or Management) as tiles, filters and a list.
function ScopeView({ supabase, scope, department, today, fmtDate, access, onOpen, refreshKey, empty, tileItems }) {
  const [filter, setFilter] = useState("All");
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [tiles, setTiles] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const [l, t] = await Promise.all([alertList(supabase, scope, filter, department), alertTiles(supabase, scope, department)]);
        if (!live) return;
        setRows(l?.rows || []);
        setTotal(l?.total || 0);
        setTiles(t);
      } catch (e) {
        if (live) setError(e.message);
      }
      if (live) setLoading(false);
    })();
    return () => { live = false; };
  }, [supabase, scope, department, filter, refreshKey]);

  return (
    <div>
      {error && <Note tone="bad">{error}</Note>}
      {tiles && <Tiles items={tileItems(tiles)} />}
      <FilterBar value={filter} onChange={setFilter} />
      {loading && !rows.length ? (
        <div style={{ color: "#888", fontSize: 13 }}>Loading...</div>
      ) : (
        <>
          <AlertList rows={rows} today={today} onOpen={onOpen} showRead={scope === "My"} showAssignee={scope !== "My"} empty={empty(filter)} />
          {total > rows.length && <div style={{ fontSize: 12, color: "#888", marginTop: 6 }}>Showing {rows.length} of {total}.</div>}
        </>
      )}
    </div>
  );
}

function ManagementView({ supabase, today, onOpen, refreshKey }) {
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

  return (
    <div>
      {error && <Note tone="bad">{error}</Note>}
      {coverage && (coverage.last_scan_status === "failed" || coverage.stale) && (
        <Note tone="bad">
          {coverage.last_scan_status === "failed" ? `The last scan failed${coverage.last_scan_error ? `: ${coverage.last_scan_error}` : "."}` : "No successful scan in the last 26 hours."} Counts below may be out of date.
        </Note>
      )}
      {summary && (
        <Tiles items={[
          { label: "Critical Alerts", value: summary.critical, tone: "red" },
          { label: "Today's Work", value: summary.today },
          { label: "Pending Client Actions", value: summary.client_pending },
          { label: "Government Pending", value: summary.government_pending },
          { label: "Upcoming Renewals", value: summary.renewals },
          { label: "Unassigned Cases", value: summary.unassigned, tone: "orange" },
        ]} />
      )}
      <ScopeView supabase={supabase} scope="Management" today={today} fmtDate={(d) => d} onOpen={onOpen} refreshKey={refreshKey}
        empty={() => "No open alerts"} tileItems={() => []} />
      {summary && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 14 }}>
          <div style={{ ...box, flex: 1, minWidth: 260 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Employee performance</div>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>A count of pending and resolved alerts, not a judgement.</div>
            {(summary.performance || []).length === 0 && <div style={{ fontSize: 12, color: "#888" }}>No data yet</div>}
            {(summary.performance || []).map((p) => <div key={p.user_id} style={{ fontSize: 12 }}>{p.name || "Unknown"}: {p.pending} pending, {p.resolved} resolved</div>)}
          </div>
          <div style={{ ...box, flex: 1, minWidth: 260 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Client risk</div>
            {(summary.client_risk || []).length === 0 && <div style={{ fontSize: 12, color: "#888" }}>No clients with critical alerts</div>}
            {(summary.client_risk || []).map((c) => <div key={c.client_id} style={{ fontSize: 12 }}>{c.client_name || c.client_id}: {c.critical} critical</div>)}
          </div>
        </div>
      )}
      {coverage && (
        <div style={box}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Coverage</div>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
            Last scan: {coverage.last_scan_at || "never"} ({coverage.last_scan_status || "none"}). {coverage.raised_means}.
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Rule</th><th style={{ textAlign: "left" }}>Enabled</th><th style={{ textAlign: "left" }}>Checked</th>
                <th style={{ textAlign: "left" }}>With data</th><th style={{ textAlign: "left" }}>Missing data</th><th style={{ textAlign: "left" }}>In step</th><th style={{ textAlign: "left" }}>Error</th>
              </tr>
            </thead>
            <tbody>
              {(coverage.rules || []).map((r) => (
                <tr key={r.rule}>
                  <td>{r.rule}</td><td>{r.enabled ? "Yes" : "No"}</td><td>{r.checked ?? "-"}</td><td>{r.with_data ?? "-"}</td>
                  <td>{r.missing_data ?? "-"}</td><td>{r.raised ?? "-"}</td><td style={{ color: "#b91c1c" }}>{r.error || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SettingsView({ supabase, access, onChanged }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(fn, ok) {
    setBusy(true);
    setError("");
    setMessage("");
    try { await fn(); setMessage(ok); onChanged(); } catch (e) { setError(e.message); }
    setBusy(false);
  }
  return (
    <div>
      {error && <Note tone="bad">{error}</Note>}
      {message && <Note>{message}</Note>}
      <div style={box}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Mode</div>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
          Preview: only admins see alerts, nobody is notified. Triage: alerts reach recipients, managers are not belled. Live: everything on.
        </div>
        <select value={access.mode} disabled={busy} onChange={(e) => run(() => alertSetMode(supabase, e.target.value), `Mode set to ${e.target.value}.`)} style={{ padding: 6, fontSize: 12 }}>
          {["Preview", "Triage", "Live"].map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <div style={box}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Scan</div>
        <button type="button" style={btn} disabled={busy} onClick={() => run(() => alertScanNow(supabase), "Scan finished. See Coverage in Management.")}>Run now</button>
      </div>
    </div>
  );
}

export default function NotificationCentre({ profile, supabase, fmtDate, openAlertId, onAlertShown, onOpenClient }) {
  const [access, setAccess] = useState(null);
  const [off, setOff] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("My Notifications");
  const [department, setDepartment] = useState("");
  const [departments, setDepartments] = useState([]);
  const [drawerId, setDrawerId] = useState(null);
  const [people, setPeople] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const today = dubaiToday();

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const a = await alertMyAccess(supabase);
        if (live) setAccess(a);
      } catch (e) {
        if (!live) return;
        if (isNotSwitchedOn(e)) setOff(true);
        else setError(e.message);
      }
    })();
    return () => { live = false; };
  }, [supabase, profile?.id]);

  useEffect(() => {
    if (!openAlertId) return;
    setDrawerId(openAlertId);
    onAlertShown?.();
  }, [openAlertId]);

  const canManage = access?.is_admin || access?.is_manager;
  useEffect(() => {
    if (!canManage) return;
    let live = true;
    (async () => {
      const { data } = await supabase.from("profiles").select("id, full_name").order("full_name");
      if (live && data) setPeople(data);
    })();
    return () => { live = false; };
  }, [supabase, canManage]);

  // Department names come from the alerts themselves.
  useEffect(() => {
    if (tab !== "Department") return;
    let live = true;
    (async () => {
      try {
        const l = await alertList(supabase, "Department", "All", null, 500);
        if (live) setDepartments([...new Set((l?.rows || []).map((r) => r.department).filter(Boolean))].sort());
      } catch { /* the tab itself shows the error */ }
    })();
    return () => { live = false; };
  }, [supabase, tab, refreshKey]);

  const bump = useCallback((reload = true) => { if (reload) setRefreshKey((k) => k + 1); }, []);
  const tabs = access ? tabsFor(access) : ["My Notifications"];
  const open = (id) => setDrawerId(id);

  return (
    <div>
    <div style={{ padding: "24px 28px 0" }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Notification Centre</div>
      <div style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>Alerts assigned to you, and your tasks.</div>

      {off && <Note>Notification Centre is not switched on yet. Your tasks are shown below.</Note>}
      {error && <Note tone="bad">{error}</Note>}

      {access && (
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          {tabs.map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} style={{ ...btn, background: tab === t ? "#111827" : "#fff", color: tab === t ? "#fff" : "#333" }}>{t}</button>
          ))}
        </div>
      )}

      {access && tab === "My Notifications" && (
        <ScopeView supabase={supabase} scope="My" today={today} fmtDate={fmtDate} access={access} onOpen={open} refreshKey={refreshKey}
          empty={(f) => emptyText(access, f)}
          tileItems={(t) => [
            { label: "Overdue", value: t.overdue, tone: "red" },
            { label: "Due Today", value: t.due_today, tone: "orange" },
            { label: "New Tasks", value: t.new_today, tone: "blue" },
          ]} />
      )}

      {access && tab === "Department" && (
        <div>
          <select value={department} onChange={(e) => setDepartment(e.target.value)} style={{ padding: 6, fontSize: 12, marginBottom: 12 }}>
            <option value="">All departments</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <ScopeView supabase={supabase} scope="Department" department={department || null} today={today} fmtDate={fmtDate} access={access} onOpen={open} refreshKey={refreshKey}
            empty={(f) => (f === "All" ? "No open alerts" : "Nothing matches this filter")}
            tileItems={(t) => [
              { label: "Overdue", value: t.overdue, tone: "red" },
              { label: "Upcoming (7 days)", value: t.upcoming },
              { label: "Client documents", value: t.documents },
              { label: "Government", value: t.authority },
              { label: "Renewals", value: t.renewals },
              { label: "Unassigned", value: t.unassigned, tone: "orange" },
            ]} />
        </div>
      )}

      {access && tab === "Management" && <ManagementView supabase={supabase} today={today} onOpen={open} refreshKey={refreshKey} />}
      {access && tab === "Settings" && <SettingsView supabase={supabase} access={access} onChanged={() => { bump(); alertMyAccess(supabase).then(setAccess).catch(() => {}); }} />}

      <div style={{ fontSize: 14, fontWeight: 700, marginTop: 24 }}>My tasks</div>
    </div>
    <HotAlerts profile={profile} supabase={supabase} fmtDate={fmtDate} />

      {drawerId && (
        <AlertDrawer supabase={supabase} alertId={drawerId} today={today} fmtDate={fmtDate} access={access} people={people}
          onClose={() => setDrawerId(null)} onChanged={bump} onOpenClient={onOpenClient ? (id) => { setDrawerId(null); onOpenClient(id); } : undefined} />
      )}
    </div>
  );
}
