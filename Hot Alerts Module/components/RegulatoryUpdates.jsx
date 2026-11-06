import { useEffect, useState } from "react";
import { Note, box, btn, btnDark } from "./ui";
import { EVIDENCE_LEVELS, LEGAL_STATUSES, REG_CATEGORIES, applicabilityFromForm, applicabilityToForm, isHttpsUrl, nextRegStep } from "../logic/alertLogic";
import {
  regulatoryCreateTasks, regulatoryDecideClient, regulatoryDetail, regulatoryList, regulatoryProposeList, regulatorySave, regulatoryStartReview, regulatoryVerify,
} from "../services/alertsApi";

const th = { textAlign: "left", fontSize: 11, color: "#888", fontWeight: 600, padding: "6px 10px", borderBottom: "1px solid #eee" };
const td = { fontSize: 12, padding: "6px 10px", borderBottom: "1px solid #f3f3f3" };
const input = { padding: 6, fontSize: 12, width: "100%", boxSizing: "border-box" };
const EMPTY = { title: "", category: "Tax", issuing_authority: "", document_number: "", publication_date: "", issue_date: "", effective_date: "", official_url: "", summary: "", legal_status: "UNVERIFIED", evidence_level: "E4" };

function Field({ label, children }) {
  return <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 8 }}>{label}{children}</label>;
}

function UpdateForm({ value, error, onChange, onSave, onCancel, busy }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  return (
    <div style={box}>
      {error && <Note tone="bad">{error}</Note>}
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{value.id ? "Edit update" : "New update"}</div>
      <Field label="Title"><input style={input} value={value.title || ""} onChange={set("title")} /></Field>
      <Field label="Category"><select style={input} value={value.category} onChange={set("category")}>{REG_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
      <Field label="Issuing authority"><input style={input} value={value.issuing_authority || ""} onChange={set("issuing_authority")} /></Field>
      <Field label="Document number"><input style={input} value={value.document_number || ""} onChange={set("document_number")} /></Field>
      <Field label="Official source (web address)"><input style={input} value={value.official_url || ""} onChange={set("official_url")} /></Field>
      <div style={{ display: "flex", gap: 8 }}>
        {[["publication_date", "Publication date"], ["issue_date", "Issue date"], ["effective_date", "Effective date"]].map(([k, l]) => (
          <Field key={k} label={l}><input type="date" style={input} value={value[k] || ""} onChange={set(k)} /></Field>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Field label="Legal status"><select style={input} value={value.legal_status} onChange={set("legal_status")}>{LEGAL_STATUSES.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Evidence"><select style={input} value={value.evidence_level} onChange={set("evidence_level")}>{EVIDENCE_LEVELS.map(([c, l]) => <option key={c} value={c}>{c}: {l}</option>)}</select></Field>
      </div>
      <Field label="Summary"><textarea rows={3} style={input} value={value.summary || ""} onChange={set("summary")} /></Field>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" style={btnDark} disabled={busy || !value.title?.trim()} onClick={onSave}>Save</button>
        <button type="button" style={btn} disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function UpdateDetail({ supabase, id, onBack, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [appl, setAppl] = useState(applicabilityToForm({}));

  async function load() {
    try {
      const d = await regulatoryDetail(supabase, id);
      setData(d);
      setAppl(applicabilityToForm(d.update.applicability));
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, [id]);

  async function run(fn) {
    setBusy(true); setError("");
    try { await fn(); await load(); onChanged?.(); } catch (e) { setError(e.message); }
    setBusy(false);
  }
  if (!data) return <div>{error ? <Note tone="bad">{error}</Note> : <div style={{ fontSize: 13, color: "#888" }}>Loading...</div>}<button type="button" style={btn} onClick={onBack}>Back</button></div>;

  const u = data.update;
  const step = data.can_manage ? nextRegStep(u.workflow_status) : null;
  const canEdit = data.can_manage && ["Draft", "Under review", "List proposed"].includes(u.workflow_status);
  const actions = {
    review: () => regulatoryStartReview(supabase, id),
    propose: () => regulatoryProposeList(supabase, id),
    verify: () => regulatoryVerify(supabase, id),
    tasks: () => regulatoryCreateTasks(supabase, id),
  };
  if (editing) {
    return <UpdateForm value={editing} error={error} busy={busy} onChange={setEditing} onCancel={() => setEditing(null)}
      onSave={() => run(async () => { await regulatorySave(supabase, editing); setEditing(null); })} />;
  }
  return (
    <div>
      <button type="button" style={{ ...btn, marginBottom: 12 }} onClick={onBack}>Back</button>
      {error && <Note tone="bad">{error}</Note>}
      <div style={box}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{u.title}</div>
        <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>{u.update_number} · {u.category} · {u.workflow_status} · {u.source}</div>
        <div style={{ fontSize: 12, lineHeight: 1.7 }}>
          <div>Authority: {u.issuing_authority || "-"}. Document: {u.document_number || "-"}.</div>
          <div>Published: {u.publication_date || "-"}. Issued: {u.issue_date || "-"}. <b>Effective: {u.effective_date || "not confirmed"}</b>.</div>
          <div>Legal status: {u.legal_status}. Evidence: {u.evidence_level}.</div>
          <div>Source: {u.official_url ? (isHttpsUrl(u.official_url) ? <a href={u.official_url} target="_blank" rel="noreferrer">{u.official_url}</a> : u.official_url) : "not recorded"}</div>
          {u.summary && <div style={{ marginTop: 6 }}>{u.summary}</div>}
          {data.tasks_total > 0 && <div style={{ marginTop: 6 }}>Client tasks: {data.tasks_total - data.tasks_open} of {data.tasks_total} finished.</div>}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          {canEdit && <button type="button" style={btn} disabled={busy} onClick={() => setEditing({ ...EMPTY, ...u })}>Edit</button>}
          {step && <button type="button" style={btnDark} disabled={busy} onClick={() => run(actions[step.action])}>{step.label}</button>}
        </div>
        {step?.action === "verify" && <div style={{ fontSize: 11, color: "#666", marginTop: 8 }}>Verifying confirms this is law, its effective date, and the list below. Nothing reaches a client: tasks go to staff.</div>}
      </div>

      {canEdit && (
        <div style={box}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Who this applies to</div>
          <label style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
            <input type="checkbox" checked={appl.all} onChange={(e) => setAppl({ ...appl, all: e.target.checked })} /> All clients
          </label>
          {!appl.all && (
            <>
              <Field label="Jurisdictions, comma separated, as written on the client profile"><input style={input} value={appl.jurisdictions} onChange={(e) => setAppl({ ...appl, jurisdictions: e.target.value })} /></Field>
              <Field label="Visa holders">
                <select style={input} value={appl.visa} onChange={(e) => setAppl({ ...appl, visa: e.target.value })}>
                  <option value="">Any</option><option value="yes">Has a visa on file</option><option value="no">No visa on file</option>
                </select>
              </Field>
            </>
          )}
          <button type="button" style={btn} disabled={busy} onClick={() => run(() => regulatorySave(supabase, { id, applicability: applicabilityFromForm(appl) }))}>Save who this applies to</button>
        </div>
      )}

      {data.can_manage && data.clients.length > 0 && (
        <div style={box}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Client list ({data.clients.length})</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Client</th><th style={th}>Why</th><th style={th}>Decision</th><th style={th}>Task</th></tr></thead>
            <tbody>
              {data.clients.map((c) => (
                <tr key={c.client_id}>
                  <td style={td}>{c.client_id} {c.client_name}</td>
                  <td style={{ ...td, color: "#666" }}>{c.match_reason}</td>
                  <td style={td}>
                    {u.workflow_status === "List proposed" ? (
                      <select value={c.decision} disabled={busy} style={{ padding: 4, fontSize: 12 }} onChange={(e) => run(() => regulatoryDecideClient(supabase, id, c.client_id, e.target.value))}>
                        {["Applies", "Does not apply", "Check"].map((x) => <option key={x}>{x}</option>)}
                      </select>
                    ) : c.decision}
                  </td>
                  <td style={td}>{c.task_status || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Announcements reviewed by managers. Nothing here becomes a client obligation until it is verified.
export default function RegulatoryUpdates({ supabase }) {
  const [rows, setRows] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    regulatoryList(supabase, filter || null, 200)
      .then((r) => { if (live) { setRows(r?.rows || []); setCanManage(!!r?.can_manage); setError(""); } })
      .catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [supabase, filter, reload]);

  if (openId) return <UpdateDetail supabase={supabase} id={openId} onBack={() => setOpenId(null)} onChanged={() => setReload((n) => n + 1)} />;
  if (creating) {
    return <UpdateForm value={creating} error={error} busy={busy} onChange={setCreating} onCancel={() => setCreating(null)} onSave={async () => {
      setBusy(true); setError("");
      try { const id = await regulatorySave(supabase, creating); setCreating(null); setReload((n) => n + 1); setOpenId(id); } catch (e) { setError(e.message); }
      setBusy(false);
    }} />;
  }
  return (
    <div>
      {error && <Note tone="bad">{error}</Note>}
      <Note>An announcement is information until a manager verifies it, confirms the effective date and checks which clients it applies to.</Note>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ padding: 6, fontSize: 12 }}>
          <option value="">All</option>
          {canManage && <option value="Needs review">Needs review</option>}
          <option value="Tasks created">In progress</option>
          <option value="Closed">Closed</option>
        </select>
        {canManage && <button type="button" style={btn} onClick={() => setCreating({ ...EMPTY })}>New update</button>}
      </div>
      <div style={{ background: "#fff", border: "1px solid #e8e8e8", borderRadius: 8, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Update</th><th style={th}>Category</th><th style={th}>Effective</th><th style={th}>Legal status</th><th style={th}>Stage</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => setOpenId(r.id)}>
                <td style={td}>{r.title}<div style={{ fontSize: 11, color: "#888" }}>{r.update_number}</div></td>
                <td style={td}>{r.category}</td>
                <td style={td}>{r.effective_date || "-"}</td>
                <td style={td}>{r.legal_status}</td>
                <td style={td}>{r.workflow_status}</td>
              </tr>
            ))}
            {!rows.length && <tr><td style={{ ...td, color: "#888" }} colSpan={5}>No updates</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
