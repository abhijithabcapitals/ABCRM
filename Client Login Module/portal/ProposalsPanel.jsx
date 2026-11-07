// The client's proposals: every option we shared, and the client's reply. The client chooses an option or comments here; Accept and Reject
// go through DecisionPanel (setup_decide), as for any quote. Everything is written to the proposal itself, the same one AB Capital sees in the CRM.
import { useState } from "react";
import { Badge, Button, ErrorNote, Panel, fmtDate, useLoad } from "@banking/components/shared";

const money = (n) => Number(n || 0).toLocaleString("en-AE", { maximumFractionDigits: 2 });
const LABEL = { option: "You chose", accepted: "Accepted", declined: "Declined", comment: "Comment" };

function History({ p }) {
  const items = [...(p.replies || []).map((r) => ({ ...r, at: r.date })), ...(p.decision ? [{ kind: p.decision.decision === "Accepted" ? "accepted" : "declined", at: p.decision.date, comment: p.decision.note, source: p.decision.source, formal: true }] : [])]
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  if (!items.length) return null;
  return (
    <ul className="bk-mb">
      {items.map((r, i) => (
        <li key={i}>{fmtDate(r.at)}: {LABEL[r.kind] || r.kind}{r.option != null ? ` Option ${r.option + 1}` : ""}{r.source === "Staff" ? " (recorded by AB Capital Services FZE)" : ""}{r.comment ? <>: &ldquo;{r.comment}&rdquo;</> : null}</li>
      ))}
    </ul>
  );
}

function Proposal({ p, api, onChange, onDecide, open }) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const single = (p.options || []).length === 1;
  const chosen = p.chosen ?? (single ? 0 : null);
  const send = async (kind, option) => {
    if (busy) return;
    if (kind === "comment" && !comment.trim()) { setError("Write your comment first."); return; }
    setBusy(kind === "option" ? `o${option}` : kind); setError(null);
    try {
      await api.proposalReply(p.id, kind, option, kind === "comment" ? comment.trim() : undefined);
      if (kind === "comment") setComment("");
      await onChange();
    } catch (e) { setError(e.message); }
    setBusy(null);
  };
  const doc = { id: p.id, number: p.number, has_file: p.has_file };
  return (
    <div className="bk-mb">
      <h4>{p.has_file ? <button type="button" className="bk-link" onClick={() => open("quote", p.id)}>{p.number}</button> : p.number} <small className="bk-muted">{fmtDate(p.date)}</small>
        {" "}{p.decision ? <Badge tone={p.decision.decision === "Accepted" ? "good" : "bad"}>{p.decision.decision === "Accepted" ? "Accepted" : "Declined"}</Badge> : p.can_reply ? <Badge tone="warn">Waiting for your reply</Badge> : <Badge>Closed</Badge>}</h4>
      <ErrorNote message={error} onClose={() => setError(null)} />
      <ul>
        {(p.options || []).map((o) => (
          <li key={o.index}>
            Option {o.index + 1}: {o.authority}{o.activity ? `, ${o.activity}` : ""}, AED {money(o.total)}
            {" "}{chosen === o.index ? <Badge tone="good">Your choice</Badge> : p.can_reply && !single ? <Button busy={busy === `o${o.index}`} onClick={() => send("option", o.index)}>Choose this option</Button> : null}
          </li>
        ))}
      </ul>
      <History p={p} />
      {p.can_reply && (
        <>
          <div className="bk-field"><label htmlFor={`pp-c-${p.id}`}>Comment or question</label>
            <textarea id={`pp-c-${p.id}`} rows={2} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} /></div>
          <div className="bk-actions">
            <Button busy={busy === "comment"} onClick={() => send("comment")}>Send comment</Button>
            <Button variant="primary" disabled={chosen === null} title={chosen === null ? "Choose an option first" : undefined} onClick={() => onDecide(doc, "Accepted")}>Accept{chosen !== null && !single ? ` Option ${chosen + 1}` : ""}</Button>
            <Button onClick={() => onDecide(doc, "Rejected")}>Decline</Button>
          </div>
          {chosen === null && <small className="bk-muted">Choose an option to accept it.</small>}
        </>
      )}
    </div>
  );
}

export default function ProposalsPanel({ api, onDecide, open, refresh, onChanged }) {
  const list = useLoad(() => api.proposals(), [api, refresh]);
  const rows = list.data || [];
  if (list.error) return <ErrorNote message={list.error} />;
  if (!rows.length) return null;
  return (
    <Panel title="Your proposals" sub="Every option we shared with you. Choose one, ask a question, accept or decline: AB Capital Services FZE sees your reply straight away.">
      {rows.map((p) => <Proposal key={p.id} p={p} api={api} onChange={async () => { await list.reload(); await onChanged?.(); }} onDecide={onDecide} open={open} />)}
    </Panel>
  );
}
