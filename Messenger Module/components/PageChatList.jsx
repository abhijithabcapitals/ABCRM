import { useEffect, useState } from "react";
import chatApi from "../services/chatClient.js";
import { badgeText, chatsIn, chatTitle, initials, previewText, sortChats } from "../logic/chat.js";
import { filterChats, rowTime } from "../logic/app.js";
import { presenceLabel } from "../logic/parity.js";

const SKELETONS = [0, 1, 2, 3, 4];
const SEARCH_WAIT_MS = 300;
const SEARCH_MIN = 2;

// Message search. The wait means one database call per pause in typing, and a late answer for old text is dropped.
function MessageResults({ query, rows, onOpenResult }) {
  const [found, setFound] = useState({ query: "", list: [], problem: "" });
  const q = query.trim();
  useEffect(() => {
    if (q.length < SEARCH_MIN) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      chatApi.search(q).then(
        (list) => { if (live) setFound({ query: q, list: list || [], problem: "" }); },
        (e) => { if (live) setFound({ query: q, list: [], problem: e.message }); },
      );
    }, SEARCH_WAIT_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [q]);
  if (q.length < SEARCH_MIN) return null;
  const ready = found.query === q;
  const titleOf = (m) => { const c = rows.find((r) => r.id === m.conversation_id); return c ? chatTitle(c) : m.conversation_title || ""; };
  return (
    <section aria-label="Messages found">
      <h3 className="abm-found">Messages</h3>
      {!ready && <div role="status" aria-label="Searching messages" className="abm-skeleton" />}
      {ready && found.problem && <p className="abm-list-note" role="alert">{found.problem}</p>}
      {ready && !found.problem && !found.list.length && <p className="abm-list-note">No message has these words.</p>}
      {ready && found.list.length > 0 && (
        <ul className="abm-list">
          {found.list.map((m) => (
            <li key={m.message_id}>
              <button type="button" className="abm-row" onClick={() => onOpenResult(m)}>
                <span className="abm-row-main">
                  <strong>{titleOf(m)}</strong>
                  <span className="abm-row-sub">{m.sender_name ? `${m.sender_name}: ` : ""}{m.body}</span>
                </span>
                <span className="abm-row-side">{rowTime(m.created_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Body({ rows, shown, archived, myId, loaded, error, query, selected, onSelect, onRetry, stateOf }) {
  if (error) {
    return (
      <div className="abm-list-note" role="alert">
        <p>{error}</p>
        <button type="button" className="abm-btn" onClick={onRetry}>Try again</button>
      </div>
    );
  }
  if (!loaded) return <div aria-label="Loading chats" role="status">{SKELETONS.map((n) => <div key={n} className="abm-skeleton" />)}</div>;
  if (!rows.length) return <p className="abm-list-note">{archived ? "No archived chats." : "No conversations yet. Use New chat to message a colleague."}</p>;
  if (!shown.length) return <p className="abm-list-note">No chat is called &ldquo;{query.trim()}&rdquo;.</p>;
  const stateFor = (r) => (r.other_id && stateOf ? stateOf(r.other_id) : null);
  return (
    <ul className="abm-list">
      {sortChats(shown).map((r) => {
        const count = badgeText(r.unread);
        const title = chatTitle(r);
        return (
          <li key={r.id}>
            <button type="button" className={`msgr-row${r.id === selected ? " msgr-row-on" : ""}`} aria-current={r.id === selected ? "true" : undefined}
              aria-label={count ? `${title}, ${count} unread` : title} onClick={() => onSelect(r.id)}>
              <span className="abm-avatar-box">
                <span className="msgr-avatar" aria-hidden="true">{initials(title)}</span>
                {stateFor(r) && <span className={`abm-dot abm-dot-${stateFor(r)}`} title={presenceLabel(stateFor(r))} />}
              </span>
              <span className="msgr-row-main">
                <span className="msgr-row-title">{r.pinned && <span className="abm-flag">Pinned </span>}{title}{r.muted && <span className="abm-flag"> Muted</span>}</span>
                <span className="msgr-row-preview">{previewText(r, myId)}</span>
              </span>
              <span className="msgr-row-side">
                <span className="msgr-row-time">{rowTime(r.last_message_at)}</span>
                {count && <span className={r.muted ? "abm-unread-quiet" : "msgr-unread"}>{count}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// The left pane of the Chats section. The rows are the dock's, so both look alike.
export default function PageChatList({ rows, myId, loaded, error, query, selected, onSelect, onNew, onRetry, stateOf, onOpenResult }) {
  const [archived, setArchived] = useState(false);
  const archivedCount = chatsIn(rows, true).length;
  const list = chatsIn(rows, archived);
  return (
    <section className="abm-side" aria-label="Your chats">
      <header className="abm-side-head">
        <h2>Chats</h2>
        <button type="button" className="abm-btn" onClick={onNew}>New chat</button>
      </header>
      <div className="abm-side-body">
        {(archived || archivedCount > 0) && (
          <label className="abm-picker-row"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /><span>Show archived ({archivedCount})</span></label>
        )}
        <Body rows={list} shown={filterChats(list, query)} archived={archived} myId={myId} loaded={loaded} error={error} query={query}
          selected={selected} onSelect={onSelect} onRetry={onRetry} stateOf={stateOf} />
        {loaded && !error && <MessageResults query={query} rows={rows} onOpenResult={onOpenResult} />}
      </div>
    </section>
  );
}
