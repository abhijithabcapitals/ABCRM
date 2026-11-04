import { badgeText, chatTitle, initials, previewText, sortChats } from "../logic/chat.js";
import { filterChats, rowTime } from "../logic/app.js";

const SKELETONS = [0, 1, 2, 3, 4];

function Body({ rows, shown, myId, loaded, error, query, selected, onSelect, onRetry }) {
  if (error) {
    return (
      <div className="abm-list-note" role="alert">
        <p>{error}</p>
        <button type="button" className="abm-btn" onClick={onRetry}>Try again</button>
      </div>
    );
  }
  if (!loaded) return <div aria-label="Loading chats" role="status">{SKELETONS.map((n) => <div key={n} className="abm-skeleton" />)}</div>;
  if (!rows.length) return <p className="abm-list-note">No conversations yet. Use New chat to message a colleague.</p>;
  if (!shown.length) return <p className="abm-list-note">No chat is called &ldquo;{query.trim()}&rdquo;.</p>;
  return (
    <ul className="abm-list">
      {sortChats(shown).map((r) => {
        const count = badgeText(r.unread);
        const title = chatTitle(r);
        return (
          <li key={r.id}>
            <button type="button" className={`msgr-row${r.id === selected ? " msgr-row-on" : ""}`} aria-current={r.id === selected ? "true" : undefined}
              aria-label={count ? `${title}, ${count} unread` : title} onClick={() => onSelect(r.id)}>
              <span className="msgr-avatar" aria-hidden="true">{initials(title)}</span>
              <span className="msgr-row-main">
                <span className="msgr-row-title">{title}</span>
                <span className="msgr-row-preview">{previewText(r, myId)}</span>
              </span>
              <span className="msgr-row-side">
                <span className="msgr-row-time">{rowTime(r.last_message_at)}</span>
                {count && <span className="msgr-unread">{count}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// The left pane of the Chats section. The rows are the dock's, so both look alike.
export default function PageChatList({ rows, myId, loaded, error, query, selected, onSelect, onNew, onRetry }) {
  return (
    <section className="abm-side" aria-label="Your chats">
      <header className="abm-side-head">
        <h2>Chats</h2>
        <button type="button" className="abm-btn" onClick={onNew}>New chat</button>
      </header>
      <div className="abm-side-body">
        <Body rows={rows} shown={filterChats(rows, query)} myId={myId} loaded={loaded} error={error} query={query}
          selected={selected} onSelect={onSelect} onRetry={onRetry} />
      </div>
    </section>
  );
}
