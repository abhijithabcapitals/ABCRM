import { activitySentence } from "../logic/parity.js";
import { rowTime } from "../logic/app.js";

// Mentions, replies and reactions meant for this person. A row opens its chat.
export default function ActivitySection({ rows, error, loaded, unread, onOpen, onMarkAll, onRetry }) {
  return (
    <section className="abm-page" aria-label="Activity">
      <header className="abm-side-head">
        <h2>Activity</h2>
        {unread > 0 && <button type="button" className="abm-btn" onClick={onMarkAll}>Mark all read</button>}
      </header>
      <div className="abm-side-body">
        {error
          ? <div className="abm-list-note" role="alert"><p>{error}</p><button type="button" className="abm-btn" onClick={onRetry}>Try again</button></div>
          : !loaded
            ? <div aria-label="Loading activity" role="status"><div className="abm-skeleton" /><div className="abm-skeleton" /></div>
            : !rows.length
              ? <p className="abm-list-note">Nothing yet. Mentions, replies and reactions to your messages will show here.</p>
              : (
                <ul className="abm-list">
                  {rows.map((r) => (
                    <li key={r.id}>
                      <button type="button" className={`abm-row${r.read_at ? "" : " abm-row-new"}`} onClick={() => onOpen(r)}>
                        <span className="abm-row-main">
                          <strong>{activitySentence(r)}</strong>
                          <span className="abm-row-sub">{r.conversation_kind === "channel" && r.conversation_title ? `${r.conversation_title}: ` : ""}{r.preview}</span>
                        </span>
                        <span className="abm-row-side">{rowTime(r.created_at)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
      </div>
    </section>
  );
}
