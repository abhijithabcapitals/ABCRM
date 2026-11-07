// The client's Business Development quotes: open each, accept or reject it, and open the engagement letter once we have sent it.
// Accepting goes through the same confirmation as the other quotes (DecisionPanel); the server has the last word.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, Panel, fmtDate, useLoad } from "@banking/components/shared";
import DecisionPanel from "./DecisionPanel";

const money = (n) => Number(n || 0).toLocaleString("en-AE", { maximumFractionDigits: 2 });

export default function BdQuotesPanel({ api }) {
  const list = useLoad(() => api.bdQuotes(), [api]);
  const [acting, setActing] = useState(null);   // { doc, decision }
  const [error, setError] = useState(null);
  const rows = list.data || [];
  if (list.error) return <ErrorNote message={list.error} />;
  if (!rows.length) return null;
  const open = async (id) => {
    setError(null);
    try { window.location.assign(await api.bdFile(id)); } catch (e) { setError(e.message); }
  };
  const file = (id, label) => <button type="button" className="bk-link" onClick={() => open(id)}>{label}</button>;
  // DecisionPanel talks to setupDecide and openFile; here they go to the BD calls.
  const decideApi = { setupDecide: api.bdDecide };
  const openFile = (_kind, id) => api.bdFile(id).then((url) => { window.location.assign(url); });
  const finish = async (message) => { setActing(null); setError(message || null); await list.reload(); };
  return (
    <Panel title="Your quotations" sub="Please review each quotation and accept or reject it. Once you accept, we send you the engagement letter.">
      <ErrorNote message={error} onClose={() => setError(null)} />
      {acting && <DecisionPanel key={acting.doc.id + acting.decision} kind="quote" doc={acting.doc} decision={acting.decision} api={decideApi} openFile={openFile}
        onDone={() => finish()} onFail={(m) => finish(m)} onCancel={() => setActing(null)} />}
      <DataTable rows={rows} columns={[
        { key: "number", label: "Quotation", render: (q) => (q.has_file ? file(q.id, q.number) : q.number) },
        { key: "date", label: "Date", render: (q) => fmtDate(q.date) },
        { key: "services", label: "Services", render: (q) => (q.services || []).join(", ") },
        { key: "total", label: "Total (AED)", right: true, render: (q) => money(q.total) },
        { key: "decision", label: "Your decision", render: (q) => {
          const x = q.decision;
          if (x) return <span><Badge tone={x.decision === "Accepted" ? "good" : "bad"}>{x.decision === "Accepted" ? "Accepted" : "Declined"}</Badge> {fmtDate(x.date)}{x.source === "Signed copy" ? " (from your signed copy)" : ""}{x.note ? <> Your note: {x.note}</> : null}</span>;
          if (q.can_decide) return <span><Button variant="primary" onClick={() => setActing({ doc: q, decision: "Accepted" })}>Accept</Button> <Button onClick={() => setActing({ doc: q, decision: "Rejected" })}>Reject</Button></span>;
          if (q.expired) return <Badge tone="bad">Expired: please ask us for a new one</Badge>;
          return null;
        } },
        { key: "letter", label: "Engagement letter", render: (q) => (q.letter ? (q.letter.has_file ? file(q.letter.id, q.letter.number) : q.letter.number) : (q.status === "accepted" ? <small className="bk-muted">Coming soon</small> : "")) },
      ]} />
    </Panel>
  );
}
