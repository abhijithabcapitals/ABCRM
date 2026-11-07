import { useEffect, useState } from "react";
import { alertDetail, alertMarkRead, alertAssign, alertEscalate, alertResolve, clientContactLog, clientDocumentRequest, checklistItemDone } from "../services/alertsApi";
import { BACKLOG_STYLE, PRIORITY_STYLES, TAG_STYLES, resolvePlaceholder, tagFor, daysLabel } from "../logic/alertLogic";

const btn = { padding: "6px 12px", fontSize: 12, borderRadius: 6, border: "1px solid #d4d4d4", background: "#fff", cursor: "pointer" };

function Field({ name, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: "#888", marginBottom: 2 }}>{name}</div>
      <div style={{ fontSize: 13 }}>{children || "-"}</div>
    </div>
  );
}

// Shows one alert in full. Opening it marks it read for the caller (a no-op when the caller is not a recipient).
export default function AlertDrawer({ supabase, alertId, today, fmtDate, access, people, onClose, onChanged, onOpenClient }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState(null); // "assign" | "escalate" | "resolve"
  const [text, setText] = useState("");
  const [person, setPerson] = useState("");
  const [date, setDate] = useState("");

  useEffect(() => { setText(""); setPerson(""); setDate(""); }, [mode]);

  async function load() {
    try {
      setError("");
      setData(await alertDetail(supabase, alertId));
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    let live = true;
    setData(null);
    setMode(null);
    setError("");
    (async () => {
      try {
        const d = await alertDetail(supabase, alertId);
        if (!live) return;
        setData(d);
        try {
          await alertMarkRead(supabase, alertId);
          // Reload the list behind the drawer, so the unread dot clears.
          if (live && !d?.alert?.read) onChanged?.(true);
        } catch {
          // not a recipient: nothing to mark
        }
      } catch (e) {
        if (live) setError(e.message);
      }
    })();
    return () => { live = false; };
  }, [alertId]);

  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setMode(null);
      setText("");
      setPerson("");
      setDate("");
      await load();
      onChanged?.(true);
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  const a = data?.alert;
  const open = a && (a.status === "Open" || a.status === "In progress");
  const canManage = access?.is_admin || access?.is_manager;
  const tag = a ? tagFor(a, today) : null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9000, display: "flex", justifyContent: "flex-end", background: "rgba(0,0,0,0.25)" }} onClick={onClose}>
      <div style={{ width: 460, maxWidth: "100%", background: "#fff", height: "100%", overflowY: "auto", padding: 20, boxShadow: "-8px 0 24px rgba(0,0,0,0.12)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, gap: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{a ? a.title : "Alert"}</div>
          <button type="button" style={btn} onClick={onClose}>Close</button>
        </div>
        {error && <div style={{ background: "#fee2e2", color: "#b91c1c", padding: "8px 10px", borderRadius: 6, fontSize: 12, marginBottom: 10 }}>{error}</div>}
        {!a && !error && <div style={{ color: "#888", fontSize: 13 }}>Loading...</div>}
        {a && (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
              <span className="badge" style={PRIORITY_STYLES[a.priority] || PRIORITY_STYLES.Normal}>{a.priority}</span>
              {tag && <span className="badge" style={TAG_STYLES[tag]}>{tag}</span>}
              <span className="badge" style={{ background: "#f1f5f9", color: "#475569" }}>{a.status}</span>
              {a.backlog && <span className="badge" style={BACKLOG_STYLE}>Backlog</span>}
              {a.escalation_level > 0 && <span className="badge" style={{ background: "#fef3c7", color: "#92400e" }}>Escalated {a.escalation_level}</span>}
            </div>
            <Field name="Notification ID">{a.alert_number}</Field>
            <Field name="Category">{a.category}</Field>
            <Field name="Client">{a.client_name || a.client_id}</Field>
            <Field name="Description">{a.description}</Field>
            <Field name="Action required">{a.action_required}</Field>
            <Field name="Assigned employee">{a.assignee_name || "Unassigned"}</Field>
            <Field name="Department">{a.department}</Field>
            <Field name="Trigger date">{a.trigger_date ? fmtDate(a.trigger_date) : null}</Field>
            <Field name="Due date">{a.due_date ? `${fmtDate(a.due_date)} (${daysLabel(a.due_date, today)})` : null}</Field>
            <Field name="Created">{a.created_at ? fmtDate(a.created_at) : null}</Field>
            {a.resolved_at && <Field name="Resolved">{`${fmtDate(a.resolved_at)}${a.resolution_note ? ` - ${a.resolution_note}` : ""}`}</Field>}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "14px 0" }}>
              {a.client_id && onOpenClient && <button type="button" style={btn} onClick={() => onOpenClient(a.client_id)}>Open Client</button>}
              {open && a.source_table === "business_setup_service_checkpoints" && <button type="button" style={btn} disabled={busy} onClick={() => run(() => checklistItemDone(supabase, a.source_id))}>Mark item done</button>}
              {open && a.client_id && <button type="button" style={btn} onClick={() => setMode("contact")}>Contact Client</button>}
              {open && a.client_id && <button type="button" style={btn} onClick={() => setMode("request")}>Request Documents</button>}
              {open && canManage && <button type="button" style={btn} onClick={() => setMode("assign")}>Assign Employee</button>}
              {open && canManage && <button type="button" style={btn} onClick={() => setMode("escalate")}>Escalate</button>}
              {open && <button type="button" style={btn} onClick={() => setMode("resolve")}>Mark Resolved</button>}
            </div>

            {mode === "contact" && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: "#666", marginBottom: 6 }}>Log a contact you made. This sends nothing to the client.</div>
                <select aria-label="Channel" value={person} onChange={(e) => setPerson(e.target.value)} style={{ padding: 6, fontSize: 12, marginRight: 8 }}>
                  <option value="">Choose channel</option>
                  {["Email", "Call", "WhatsApp", "Meeting", "Other"].map((c) => <option key={c}>{c}</option>)}
                </select>
                <input aria-label="Follow-up date" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ padding: 6, fontSize: 12 }} />
                <textarea aria-label="Note" value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="What was said" style={{ width: "100%", fontSize: 12, padding: 6, boxSizing: "border-box", margin: "6px 0" }} />
                <button type="button" style={btn} disabled={busy || !person} onClick={() => run(() => clientContactLog(supabase, { client_id: a.client_id, channel: person, note: text, follow_up_on: date || null }))}>Save contact</button>
              </div>
            )}
            {mode === "request" && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: "#666", marginBottom: 6 }}>Log a request you made, so it is chased if unanswered. This sends nothing to the client.</div>
                <input aria-label="Due date" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ padding: 6, fontSize: 12 }} />
                <textarea aria-label="Documents" value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Which documents" style={{ width: "100%", fontSize: 12, padding: 6, boxSizing: "border-box", margin: "6px 0" }} />
                <button type="button" style={btn} disabled={busy || !text.trim()} onClick={() => run(() => clientDocumentRequest(supabase, { client_id: a.client_id, what: text, due_on: date || null }))}>Save request</button>
              </div>
            )}
            {mode === "assign" && (
              <div style={{ marginBottom: 14 }}>
                <select value={person} onChange={(e) => setPerson(e.target.value)} style={{ padding: 6, fontSize: 12, marginRight: 8 }}>
                  <option value="">Choose employee</option>
                  {(people || []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
                <button type="button" style={btn} disabled={busy || !person} onClick={() => run(() => alertAssign(supabase, a.id, person))}>Assign</button>
              </div>
            )}
            {(mode === "escalate" || mode === "resolve") && (
              <div style={{ marginBottom: 14 }}>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={3}
                  placeholder={mode === "escalate" ? "Reason for escalation" : resolvePlaceholder(a.priority)}
                  style={{ width: "100%", fontSize: 12, padding: 6, boxSizing: "border-box", marginBottom: 6 }}
                />
                <button
                  type="button"
                  style={btn}
                  disabled={busy || (mode === "escalate" && !text.trim())}
                  onClick={() => run(() => (mode === "escalate" ? alertEscalate(supabase, a.id, text) : alertResolve(supabase, a.id, text.trim() || null, false)))}
                >
                  {mode === "escalate" ? "Escalate" : "Mark Resolved"}
                </button>
              </div>
            )}

            <div style={{ fontSize: 12, fontWeight: 700, margin: "8px 0 6px" }}>Recipients</div>
            {(data.recipients || []).length === 0 && <div style={{ fontSize: 12, color: "#888" }}>None</div>}
            {(data.recipients || []).map((r) => (
              <div key={r.user_id} style={{ fontSize: 12, marginBottom: 3 }}>
                {r.name || "Unknown"} <span style={{ color: "#888" }}>({r.reason}, {r.read_at ? "read" : "unread"})</span>
              </div>
            ))}

            <div style={{ fontSize: 12, fontWeight: 700, margin: "14px 0 6px" }}>History</div>
            {(data.events || []).map((e) => (
              <div key={e.id} style={{ fontSize: 12, marginBottom: 4 }}>
                <span style={{ color: "#888" }}>{e.created_at ? fmtDate(e.created_at) : ""}</span> {e.event}{e.by_name ? ` by ${e.by_name}` : ""}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
