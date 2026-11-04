import { useState } from "react";

// Two panes. Later screens fill the list and conversation panes; until then they hold plain placeholders.
export default function MessengerPanel({ profile, rows, reload, onMessage, visible, connected = true, error = "", onClose }) {
  const [selected] = useState(null);

  return (
    <div className={`msgr-panel ${selected ? "msgr-show-chat" : "msgr-show-list"}`} hidden={!visible} role="dialog" aria-label="Team chat">
      {!connected && <div className="msgr-reconnect">Reconnecting…</div>}
      <div className="msgr-panes">
        <section className="msgr-list-pane" aria-label="Chats">
          <header className="msgr-pane-head">
            <strong>Chats</strong>
            <button type="button" className="msgr-close" onClick={onClose} aria-label="Close chat">×</button>
          </header>
          {error && <p className="msgr-note">{error}</p>}
        </section>
        <section className="msgr-chat-pane" aria-label="Conversation">
          <p className="msgr-empty">Select a chat</p>
        </section>
      </div>
    </div>
  );
}
