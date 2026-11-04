import { badgeText, chatTitle, initials, railTitle, sortChats } from "../logic/chat.js";

const Icon = ({ children }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const SETTINGS = <Icon><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Icon>;
const NEW_CHAT = <Icon><path d="M12 5v14M5 12h14" /></Icon>;
const WHATSAPP = <Icon><path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L4 20.5l1.1-4.3A8.5 8.5 0 1 1 21 12z" /><path d="M9 9c0 3.3 2.7 6 6 6l1-1.5-2-1-1 .7a4 4 0 0 1-2.2-2.2l.7-1-1-2z" /></Icon>;
const TELEGRAM = <Icon><path d="M21 4 3 11l6 2.5L18 7l-7 8 7 5z" /></Icon>;
const MAIL = <Icon><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></Icon>;
const ACTIVITY = <Icon><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10 20a2 2 0 0 0 4 0" /></Icon>;
const TEAMS = <Icon><circle cx="9" cy="8" r="3.5" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 5a3.5 3.5 0 0 1 0 6.5M18 14.5a6 6 0 0 1 3 5.5" /></Icon>;
const CALLS = <Icon><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.8 2.1z" /></Icon>;
const FILES = <Icon><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></Icon>;

// One round button, with its unread count, for a section or channel. It lights up while that one is open.
function RailButton({ label, icon, on, count, onClick }) {
  const badge = badgeText(count || 0);
  return (
    <button type="button" className={`msgr-rail-btn${on ? " msgr-rail-btn-on" : ""}`} title={label} aria-label={badge ? `${label}, ${badge} new` : label} aria-current={on ? "true" : undefined} onClick={onClick}>
      {icon}
      {badge && <span className="msgr-badge">{badge}</span>}
    </button>
  );
}

// The narrow strip that stays on the right of every page: settings and new chat, the sections, the chats, then the other channels.
export default function ChatRail({ rows, myId, selectedId, open, error, section, inboxChannel, screen, counts = {}, onSettings, onNew, onSelect, onRetry, onSection, onInbox }) {
  const inboxOn = (channel) => section === "inbox" && inboxChannel === channel;
  return (
    <nav className="msgr-rail" aria-label="Team chat">
      <div className="msgr-rail-group">
        <RailButton label="Chat settings" icon={SETTINGS} on={screen === "settings"} onClick={onSettings} />
        <RailButton label="New chat" icon={NEW_CHAT} on={screen === "new"} onClick={onNew} />
      </div>
      <div className="msgr-rail-group msgr-rail-sections">
        <RailButton label="Activity" icon={ACTIVITY} on={section === "activity"} count={counts.activity} onClick={() => onSection("activity")} />
        <RailButton label="Teams" icon={TEAMS} on={section === "teams"} count={counts.teams} onClick={() => onSection("teams")} />
        <RailButton label="Calls" icon={CALLS} on={section === "calls"} onClick={() => onSection("calls")} />
        <RailButton label="Files" icon={FILES} on={section === "files"} onClick={() => onSection("files")} />
      </div>
      <div className="msgr-rail-group msgr-rail-chats">
        {error && <button type="button" className="msgr-rail-btn msgr-rail-error" title={`${error} Click to try again.`} aria-label="Chats did not load. Try again" onClick={onRetry}>!</button>}
        {sortChats(rows).map((r) => {
          const count = badgeText(r.unread);
          return (
            <button key={r.id} type="button" className={`msgr-rail-chat${open && r.id === selectedId ? " msgr-rail-chat-on" : ""}`} title={railTitle(r, myId)}
              aria-label={count ? `${chatTitle(r)}, ${count} unread` : chatTitle(r)} onClick={() => onSelect(r.id)}>
              {initials(chatTitle(r))}
              {count && <span className="msgr-badge">{count}</span>}
            </button>
          );
        })}
      </div>
      <div className="msgr-rail-group">
        <RailButton label="WhatsApp" icon={WHATSAPP} on={inboxOn("whatsapp")} onClick={() => onInbox("whatsapp")} />
        <RailButton label="Telegram" icon={TELEGRAM} on={inboxOn("telegram")} onClick={() => onInbox("telegram")} />
        <RailButton label="Mail" icon={MAIL} on={inboxOn("email")} count={counts.inbox} onClick={() => onInbox("email")} />
      </div>
    </nav>
  );
}
