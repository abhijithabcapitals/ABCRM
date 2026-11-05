import { useEffect, useState } from "react";
import { Note, box, btn, btnDark } from "./ui";
import { modeConfirmText, fmtScanTime } from "../logic/alertLogic";
import { alertSetMode, alertScanNow, alertRuleList, alertRuleSave, alertManagerList, alertCoverage } from "../services/alertsApi";

const PRIORITIES = ["Critical", "High", "Medium", "Normal"];
const th = { textAlign: "left", fontSize: 11, color: "#888", fontWeight: 600, padding: "6px 10px", borderBottom: "1px solid #eee" };
const td = { fontSize: 12, padding: "6px 10px", borderBottom: "1px solid #f3f3f3", verticalAlign: "top" };

// One rule: on/off and its steps. Edits stay local until this rule's Save is pressed.
function RuleRow({ rule, busy, onSave }) {
  const [enabled, setEnabled] = useState(!!rule.enabled);
  const [steps, setSteps] = useState(() => (rule.steps || []).map((s) => ({ days: String(s.days), priority: s.priority })));
  useEffect(() => {
    setEnabled(!!rule.enabled);
    setSteps((rule.steps || []).map((s) => ({ days: String(s.days), priority: s.priority })));
  }, [rule]);
  const dirty = enabled !== !!rule.enabled
    || JSON.stringify(steps.map((s) => [s.days, s.priority])) !== JSON.stringify((rule.steps || []).map((s) => [String(s.days), s.priority]));
  const set = (i, patch) => setSteps((a) => a.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <tr>
      <td style={td}>{rule.code}<div style={{ fontSize: 11, color: "#888" }}>{rule.category}{rule.department ? `, ${rule.department}` : ""}</div></td>
      <td style={td}><input type="checkbox" checked={enabled} disabled={busy} onChange={(e) => setEnabled(e.target.checked)} aria-label={`${rule.code} on`} /></td>
      <td style={td}>
        {steps.map((s, i) => (
          <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
            <input type="number" step="1" value={s.days} disabled={busy} onChange={(e) => set(i, { days: e.target.value })}
              style={{ width: 64, padding: 4, fontSize: 12 }} aria-label="Days" />
            <span style={{ fontSize: 11, color: "#888" }}>days to due</span>
            <select value={s.priority} disabled={busy} onChange={(e) => set(i, { priority: e.target.value })} style={{ padding: 4, fontSize: 12 }} aria-label="Priority">
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <button type="button" style={btn} disabled={busy} onClick={() => setSteps((a) => a.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <button type="button" style={btn} disabled={busy} onClick={() => setSteps((a) => [...a, { days: "", priority: "Medium" }])}>Add step</button>
      </td>
      <td style={td}>
        <button type="button" style={dirty ? btnDark : btn} disabled={busy || !dirty}
          onClick={() => onSave(rule.code, enabled, steps.map((s) => ({ days: s.days === "" ? null : Number(s.days), priority: s.priority })))}>Save</button>
      </td>
    </tr>
  );
}

// Settings tab (admin only): mode, tagged managers (read-only), rules, Run now.
export default function CentreSettings({ supabase, access, onChanged }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rules, setRules] = useState([]);
  const [managers, setManagers] = useState(null);
  const [scan, setScan] = useState(null);

  async function loadAll() {
    try {
      const [r, m, c] = await Promise.all([alertRuleList(supabase), alertManagerList(supabase), alertCoverage(supabase)]);
      setRules((r || []).filter((x) => !x.code.startsWith("regulatory_")));  // Raised by the regulatory workflow, not by the scan.
      setManagers(m); setScan(c);
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => { loadAll(); }, [supabase]);

  async function run(fn, ok) {
    setBusy(true); setError(""); setMessage("");
    try { await fn(); setMessage(ok); onChanged?.(); await loadAll(); } catch (e) { setError(e.message); }
    setBusy(false);
  }

  function changeMode(to) {
    const text = modeConfirmText(access.mode, to);
    if (!text) return;
    if (!window.confirm(text)) return;
    run(() => alertSetMode(supabase, to), `Mode set to ${to}.`);
  }

  return (
    <div>
      {error && <Note tone="bad">{error}</Note>}
      {message && <Note>{message}</Note>}

      <div style={box}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Mode</div>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
          Preview: only admins see alerts, nobody is belled. Triage: assigned people are belled for new threshold crossings. Live: managers are belled and escalation starts too.
        </div>
        <select value={access.mode} disabled={busy} onChange={(e) => changeMode(e.target.value)} style={{ padding: 6, fontSize: 12 }}>
          {["Preview", "Triage", "Live"].map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      <div style={box}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Managers</div>
        <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>Everyone tagged Manager in Banking or HR. Read only: tag people there.</div>
        {managers?.fell_back && <Note>Nobody is tagged Manager yet, so the CRM admins stand in.</Note>}
        {!managers && <div style={{ fontSize: 12, color: "#888" }}>Loading...</div>}
        {managers && managers.managers.length === 0 && <div style={{ fontSize: 12, color: "#888" }}>No managers found.</div>}
        {managers?.managers.map((m) => <div key={m.user_id} style={{ fontSize: 12 }}>{m.name || "Unnamed"}</div>)}
      </div>

      <div style={box}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Rules</div>
        <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>Each step sets the alert's priority once the due date is that many days away. Negative means overdue.</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Rule</th><th style={th}>On</th><th style={th}>Steps</th><th style={th} /></tr></thead>
          <tbody>
            {rules.map((r) => (
              <RuleRow key={r.code} rule={r} busy={busy}
                onSave={(code, enabled, steps) => run(() => alertRuleSave(supabase, code, enabled, steps), `Saved ${code}.`)} />
            ))}
          </tbody>
        </table>
      </div>

      <div style={box}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Scan</div>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
          Last scan: {scan ? `${fmtScanTime(scan.last_scan_at)} (${scan.last_scan_status || "none"})` : "loading"}
          {scan?.last_scan_status === "Failed" && scan.last_scan_error ? `. ${scan.last_scan_error}` : ""}
        </div>
        <button type="button" style={btn} disabled={busy} onClick={() => run(() => alertScanNow(supabase), "Scan finished. See Coverage in Management.")}>Run now</button>
      </div>
    </div>
  );
}
