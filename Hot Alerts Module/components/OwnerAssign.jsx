import { useEffect, useMemo, useState } from "react";
import { Note, box, btn, btnDark } from "./ui";
import { clientOwnerList, clientOwnerProposals, clientOwnersSet } from "../services/alertsApi";

const th = { textAlign: "left", fontSize: 11, color: "#888", fontWeight: 600, padding: "6px 10px", borderBottom: "1px solid #eee", whiteSpace: "nowrap" };
const td = { fontSize: 12, padding: "6px 10px", borderBottom: "1px solid #f3f3f3" };
const MAX_ROWS = 500;

// Client owners for one department. Choosing, applying and ticking proposals only stage a change on this screen;
// nothing is written until Save. Save sends one client_owners_set call per owner.
export default function OwnerAssign({ supabase, department, people, onBack, onChanged }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [noOwner, setNoOwner] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [staged, setStaged] = useState({});        // client_id -> owner id, not saved yet
  const [owner, setOwner] = useState("");
  const [proposals, setProposals] = useState(null); // null = closed
  const [ticked, setTicked] = useState(() => new Set());

  const nameOf = useMemo(() => {
    const m = new Map((people || []).map((p) => [p.id, p.full_name || "Unnamed"]));
    return (id) => (id ? m.get(id) || "Unknown person" : "");
  }, [people]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setRows((await clientOwnerList(supabase, department)) || []);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }
  useEffect(() => {
    setStaged({}); setSelected(new Set()); setProposals(null); setMessage("");
    load();
  }, [supabase, department]);

  const statuses = useMemo(() => [...new Set(rows.map((r) => r.client_status).filter(Boolean))].sort(), [rows]);
  const jurisdictions = useMemo(() => [...new Set(rows.map((r) => r.jurisdiction).filter(Boolean))].sort(), [rows]);
  const effectiveOwner = (r) => staged[r.client_id] ?? r.owner_id;
  const visible = rows.filter((r) =>
    (!status || r.client_status === status) && (!jurisdiction || r.jurisdiction === jurisdiction) && (!noOwner || !effectiveOwner(r)));
  const shown = visible.slice(0, MAX_ROWS);
  const stagedCount = Object.keys(staged).length;

  function toggle(id) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  const allShownSelected = shown.length > 0 && shown.every((r) => selected.has(r.client_id));
  function toggleAll() {
    setSelected(allShownSelected ? new Set() : new Set(shown.map((r) => r.client_id)));
  }
  function applyToSelected() {
    if (!owner || !selected.size) return;
    setStaged((s) => { const n = { ...s }; selected.forEach((id) => { n[id] = owner; }); return n; });
    setSelected(new Set());
    setMessage("");
  }

  async function showProposals() {
    setError(""); setTicked(new Set());
    try {
      setProposals((await clientOwnerProposals(supabase, department)) || []);
    } catch (e) {
      setError(e.message);
    }
  }
  function stageTicked() {
    setStaged((s) => {
      const n = { ...s };
      (proposals || []).forEach((p) => { if (ticked.has(p.client_id)) n[p.client_id] = p.owner_id; });
      return n;
    });
    setProposals(null);
    setMessage("");
  }

  async function save() {
    const groups = {};
    Object.entries(staged).forEach(([cid, o]) => { (groups[o] ||= []).push(cid); });
    setBusy(true); setError(""); setMessage("");
    let saved = 0;
    const left = { ...staged };
    try {
      for (const [o, ids] of Object.entries(groups)) {
        await clientOwnersSet(supabase, department, ids, o);
        ids.forEach((id) => delete left[id]);
        saved += ids.length;
      }
      setMessage(`Saved ${saved} client${saved === 1 ? "" : "s"}. Open unassigned alerts for them are now assigned.`);
    } catch (e) {
      setError(`${e.message} ${saved} saved before the error; the rest are still waiting.`);
    }
    setStaged(left);
    setBusy(false);
    await load();
    if (saved) onChanged?.();
  }

  const select = { padding: 6, fontSize: 12 };
  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <button type="button" style={btn} onClick={onBack}>Back</button>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Client owners: {department}</div>
      </div>
      {error && <Note tone="bad">{error}</Note>}
      {message && <Note>{message}</Note>}

      <div style={{ ...box, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={select} aria-label="Status">
          <option value="">Any status</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} style={select} aria-label="Jurisdiction">
          <option value="">Any jurisdiction</option>
          {jurisdictions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label style={{ fontSize: 12 }}><input type="checkbox" checked={noOwner} onChange={(e) => setNoOwner(e.target.checked)} /> No owner</label>
        <span style={{ flex: 1 }} />
        <select value={owner} onChange={(e) => setOwner(e.target.value)} style={select} aria-label="Owner">
          <option value="">Choose owner</option>
          {(people || []).map((p) => <option key={p.id} value={p.id}>{p.full_name || "Unnamed"}</option>)}
        </select>
        <button type="button" style={btn} disabled={!owner || !selected.size} onClick={applyToSelected}>Set owner for {selected.size} selected</button>
        <button type="button" style={btn} onClick={showProposals}>Show proposals</button>
      </div>

      {proposals && (
        <div style={box}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Proposed owners</div>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
            Suggestions only. Tick the ones that are right, then add them to the changes below. Nothing is saved until you press Save.
          </div>
          {proposals.length === 0 ? (
            <div style={{ fontSize: 12, color: "#888" }}>No proposals for {department}.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={th} /><th style={th}>Client</th><th style={th}>Proposed owner</th><th style={th}>Why</th></tr></thead>
              <tbody>
                {proposals.map((p) => {
                  const row = rows.find((r) => r.client_id === p.client_id);
                  return (
                    <tr key={p.client_id}>
                      <td style={td}><input type="checkbox" checked={ticked.has(p.client_id)} aria-label={`Tick ${p.client_id}`}
                        onChange={() => setTicked((s) => { const n = new Set(s); n.has(p.client_id) ? n.delete(p.client_id) : n.add(p.client_id); return n; })} /></td>
                      <td style={td}>{p.client_id}{row?.legal_name ? `  ${row.legal_name}` : ""}</td>
                      <td style={td}>{nameOf(p.owner_id)}</td>
                      <td style={{ ...td, color: "#666" }}>{p.basis}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button type="button" style={btn} disabled={!ticked.size} onClick={stageTicked}>Add {ticked.size} ticked</button>
            <button type="button" style={btn} onClick={() => setProposals(null)}>Close</button>
          </div>
        </div>
      )}

      {stagedCount > 0 && (
        <Note>
          {stagedCount} change{stagedCount === 1 ? "" : "s"} not saved yet.{" "}
          <button type="button" style={btnDark} disabled={busy} onClick={save}>{busy ? "Saving..." : "Save"}</button>{" "}
          <button type="button" style={btn} disabled={busy} onClick={() => setStaged({})}>Discard</button>
        </Note>
      )}

      {loading ? <div style={{ color: "#888", fontSize: 13 }}>Loading...</div> : (
        <div style={{ background: "#fff", border: "1px solid #e8e8e8", borderRadius: 8, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}><input type="checkbox" checked={allShownSelected} onChange={toggleAll} aria-label="Select all shown" /></th>
                <th style={th}>Client</th><th style={th}>Name</th><th style={th}>Status</th><th style={th}>Jurisdiction</th><th style={th}>Owner</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const o = effectiveOwner(r);
                const isStaged = staged[r.client_id] != null;
                return (
                  <tr key={r.client_id}>
                    <td style={td}><input type="checkbox" checked={selected.has(r.client_id)} onChange={() => toggle(r.client_id)} aria-label={`Select ${r.client_id}`} /></td>
                    <td style={td}>{r.client_id}</td>
                    <td style={td}>{r.legal_name || "-"}</td>
                    <td style={td}>{r.client_status || "-"}</td>
                    <td style={td}>{r.jurisdiction || "-"}</td>
                    <td style={{ ...td, color: o ? undefined : "#c2410c" }}>
                      {o ? nameOf(o) : "No owner"}{isStaged && <span style={{ color: "#a16207" }}> (not saved)</span>}
                    </td>
                  </tr>
                );
              })}
              {!shown.length && <tr><td style={{ ...td, color: "#888" }} colSpan={6}>No clients match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {visible.length > MAX_ROWS && <div style={{ fontSize: 12, color: "#888", marginTop: 6 }}>Showing {MAX_ROWS} of {visible.length}. Use the filters to narrow the list.</div>}
    </div>
  );
}
