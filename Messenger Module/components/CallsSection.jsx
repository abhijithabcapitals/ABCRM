import { useCallback, useEffect, useState } from "react";
import chatApi from "../services/chatClient.js";
import { startCall } from "../services/callBus.js";
import { historyLine, historyTitle, wasMissed } from "../logic/calls.js";
import { rowTime } from "../logic/app.js";

// This person's recent calls. Mounted only while the section is open, so it always loads fresh.
export default function CallsSection() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setRows((await chatApi.callHistory()) || []);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { const first = setTimeout(load, 0); return () => clearTimeout(first); }, [load]);

  return (
    <section className="abm-page" aria-label="Calls">
      <header className="abm-side-head"><h2>Calls</h2></header>
      <div className="abm-side-body">
        {error && <div className="abm-list-note" role="alert"><p>{error}</p><button type="button" className="abm-btn" onClick={load}>Try again</button></div>}
        {!error && rows === null && <div aria-label="Loading calls" role="status"><div className="abm-skeleton" /><div className="abm-skeleton" /></div>}
        {rows?.length === 0 && !error && <p className="abm-list-note">No calls yet. Use Call or Video at the top of a chat.</p>}
        {rows?.length > 0 && (
          <ul className="abm-list">
            {rows.map((c) => (
              <li key={c.id} className="abm-call-row">
                <span className="abm-row-main">
                  <strong>{historyTitle(c)}</strong>
                  <span className={`abm-row-sub${wasMissed(c) ? " abm-row-missed" : ""}`}>{historyLine(c)}</span>
                </span>
                <span className="abm-row-side">{rowTime(c.started_at)}</span>
                <button type="button" className="abm-btn-quiet" aria-label={`Call ${historyTitle(c)}`} onClick={() => startCall({ conversationId: c.conversation_id, media: c.media, title: historyTitle(c) })}>Call</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
