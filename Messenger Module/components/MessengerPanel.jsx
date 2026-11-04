import { useState } from "react";
import ChatList from "./ChatList.jsx";
import Conversation from "./Conversation.jsx";

// Two panes: the list and the open chat. On phones only one shows at a time.
// Drafts live here, so a half-typed message survives switching chats and closing the panel.
export default function MessengerPanel({ profile, rows, reload, onMessage, visible, connected = true, error = "", onClose }) {
  const [selected, setSelected] = useState(null);
  const [drafts, setDrafts] = useState({});
  const row = rows.find((r) => r.id === selected);

  return (
    <div className={`msgr-panel ${row ? "msgr-show-chat" : "msgr-show-list"}`} hidden={!visible} role="dialog" aria-label="Team chat">
      {!connected && <div className="msgr-reconnect">Reconnecting…</div>}
      <div className="msgr-panes">
        <ChatList rows={rows} selectedId={selected} myId={profile?.id} error={error} onSelect={setSelected} onRetry={reload} onClose={onClose} />
        {row ? (
          <Conversation key={row.id} row={row} profile={profile} visible={visible} connected={connected} onMessage={onMessage} reload={reload}
            draft={drafts[row.id] || ""} onDraft={(text) => setDrafts((d) => ({ ...d, [row.id]: text }))}
            onBack={() => setSelected(null)} onClose={onClose} />
        ) : (
          <section className="msgr-chat-pane" aria-label="Conversation"><p className="msgr-empty">Select a chat</p></section>
        )}
      </div>
    </div>
  );
}
