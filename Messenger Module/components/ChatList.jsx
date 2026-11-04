import { useState } from "react";
import { chatTitle, previewText } from "../logic/chat.js";

const TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", hour12: false });
const DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short" });

function initials(title) {
  const parts = String(title || "?").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

// Today shows the time, anything older shows the day.
function when(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return DAY.format(d) === DAY.format(new Date()) ? TIME.format(d) : DAY.format(d);
}

export default function ChatList({ rows, selectedId, myId, error, onSelect, onRetry, onClose }) {
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const shown = [...rows]
    .filter((r) => !needle || chatTitle(r).toLowerCase().includes(needle))
    .sort((a, b) => Date.parse(b.last_message_at || 0) - Date.parse(a.last_message_at || 0));

  return (
    <section className="msgr-list-pane" aria-label="Chats">
      <header className="msgr-pane-head">
        <strong>Chats</strong>
        <button type="button" className="msgr-close" onClick={onClose} aria-label="Close chat">×</button>
      </header>
      <input className="msgr-search" type="search" placeholder="Search chats" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search chats" />
      {error && (
        <p className="msgr-note">
          {error} <button type="button" className="msgr-link" onClick={onRetry}>Retry</button>
        </p>
      )}
      <ul className="msgr-rows">
        {shown.map((r) => {
          const title = chatTitle(r);
          return (
            <li key={r.id}>
              <button type="button" className={`msgr-row${r.id === selectedId ? " msgr-row-on" : ""}`} onClick={() => onSelect(r.id)}>
                <span className="msgr-avatar" aria-hidden="true">{initials(title)}</span>
                <span className="msgr-row-main">
                  <span className="msgr-row-title">{title}</span>
                  <span className="msgr-row-preview">{previewText(r, myId)}</span>
                </span>
                <span className="msgr-row-side">
                  <span className="msgr-row-time">{when(r.last_message_at)}</span>
                  {r.unread > 0 && <span className="msgr-unread">{r.unread > 99 ? "99+" : r.unread}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {!error && rows.length === 0 && <p className="msgr-note">Start a chat with a colleague</p>}
      {rows.length > 0 && shown.length === 0 && <p className="msgr-note">No chats match</p>}
    </section>
  );
}
