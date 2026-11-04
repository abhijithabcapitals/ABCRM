import { badgeText, chatTitle, initials, railTitle, sortChats } from "../logic/chat.js";

const Icon = ({ children }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const SETTINGS = <Icon><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Icon>;
const NEW_CHAT = <Icon><path d="M12 5v14M5 12h14" /></Icon>;
const WHATSAPP = <Icon><path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L4 20.5l1.1-4.3A8.5 8.5 0 1 1 21 12z" /><path d="M9 9c0 3.3 2.7 6 6 6l1-1.5-2-1-1 .7a4 4 0 0 1-2.2-2.2l.7-1-1-2z" /></Icon>;
const TELEGRAM = <Icon><path d="M21 4 3 11l6 2.5L18 7l-7 8 7 5z" /></Icon>;
const MAIL = <Icon><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></Icon>;

// The narrow strip that stays on the right of every page: settings and new chat, the chats, then the other channels.
export default function ChatRail({ rows, myId, selectedId, open, error, mailCount, onSettings, onNew, onSelect, onRetry, onOpenMail }) {
  const mail = badgeText(mailCount || 0);
  return (
    <nav className="msgr-rail" aria-label="Team chat">
      <div className="msgr-rail-group">
        <button type="button" className="msgr-rail-btn" title="Chat settings" aria-label="Chat settings" onClick={onSettings}>{SETTINGS}</button>
        <button type="button" className="msgr-rail-btn" title="New chat" aria-label="New chat" onClick={onNew}>{NEW_CHAT}</button>
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
        <a className="msgr-rail-btn" href="https://web.whatsapp.com/" target="_blank" rel="noopener noreferrer" title="WhatsApp" aria-label="WhatsApp, opens in a new tab">{WHATSAPP}</a>
        <a className="msgr-rail-btn" href="https://web.telegram.org/" target="_blank" rel="noopener noreferrer" title="Telegram" aria-label="Telegram, opens in a new tab">{TELEGRAM}</a>
        {onOpenMail && (
          <button type="button" className="msgr-rail-btn" title="New mail" aria-label={mail ? `New mail, ${mail}` : "New mail"} onClick={onOpenMail}>
            {MAIL}
            {mail && <span className="msgr-badge">{mail}</span>}
          </button>
        )}
      </div>
    </nav>
  );
}
