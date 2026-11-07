// What AB Capital asked this client for (Accounting Base 006), with "I have sent everything" on an open request.
// Nothing shows when there is no request in the last 90 days.
import { useState } from "react";
import { Badge, Button, ErrorNote, Panel, fmtDate, useLoad } from "@banking/components/shared";

const itemText = (r) => (r.items || []).map((i) => (i === "Other" && r.other_note ? `Other: ${r.other_note}` : i)).join(", ");

export default function RequestsPanel({ api }) {
  const list = useLoad(() => api.requests(), [api]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const rows = list.data || [];
  if (!rows.length && !list.error) return null;
  const shared = async (id) => {
    setBusy(id); setError(null);
    try { await api.requestShared(id); await list.reload(); } catch (e) { setError(e.message); }
    setBusy(null);
  };
  return (
    <Panel title="Requested from you" sub="Please upload documents under Documents, or update details under My Information, then tell us you have sent everything.">
      <ErrorNote message={list.error || error} />
      <ul className="bk-list">
        {rows.map((r) => (
          <li key={r.id}>
            <strong>{fmtDate(r.created_at)}</strong>: {itemText(r)}
            {r.message && <div className="bk-note">{r.message}</div>}
            <div className="bk-actions">
              {r.done ? <Badge tone="good">Received</Badge>
                : r.shared_at ? <Badge tone="warn">{`You told us on ${fmtDate(r.shared_at)}`}</Badge>
                : <Button busy={busy === r.id} onClick={() => shared(r.id)}>I have sent everything</Button>}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
