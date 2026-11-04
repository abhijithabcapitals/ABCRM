import { useState } from "react";
import Conversation from "./Conversation.jsx";
import NewChat from "./NewChat.jsx";
import GroupInfo from "./GroupInfo.jsx";
import AttachPicker from "./AttachPicker.jsx";
import ChatSettings from "./ChatSettings.jsx";
import chatApi from "../services/chatClient.js";

// The open pane beside the rail: a chat, or the new chat, group info or settings screen on top of it.
// Drafts live here, so a half-typed message survives switching chats and closing the panel.
export default function MessengerPanel({ profile, rows, reload, onMessage, visible, connected = true, selected, onSelect, screen, onScreen, onClose, keepOpen, onKeepOpen, statusOf }) {
  const [drafts, setDrafts] = useState({});
  const row = rows.find((r) => r.id === selected);
  const back = () => onScreen(null);
  const flags = async (change) => {
    try { await chatApi.setChatFlags(row.id, change); await reload(); } catch { /* the button stays as it was */ }
  };

  // The new chat arrives through reload; selection is by id, so it shows as soon as the row is in the list.
  async function opened(id) {
    await reload();
    onSelect(id);
    onScreen(null);
  }

  return (
    <div className="msgr-panel" role="region" aria-label="Team chat">
      {!connected && <div className="msgr-reconnect">Reconnecting…</div>}
      <div className="msgr-panes">
        {row ? (
          <Conversation key={row.id} row={row} profile={profile} visible={visible} connected={connected} onMessage={onMessage} reload={reload}
            draft={drafts[row.id] || ""} onDraft={(text) => setDrafts((d) => ({ ...d, [row.id]: text }))} onClose={onClose}
            onInfo={() => onScreen("info")} attachSlot={(slot) => <AttachPicker {...slot} />}
            status={row.other_id ? statusOf?.(row.other_id) : undefined} onFlags={flags} />
        ) : (
          <section className="msgr-chat-pane" aria-label="Conversation">
            <header className="msgr-pane-head">
              <strong>Chats</strong>
              <button type="button" className="msgr-close" onClick={onClose} aria-label="Close chat">×</button>
            </header>
            <p className="msgr-empty">Select a chat</p>
          </section>
        )}
      </div>
      {screen === "new" && <NewChat me={profile?.id} onOpened={opened} onBack={back} onClose={onClose} />}
      {screen === "settings" && <ChatSettings keepOpen={keepOpen} onKeepOpen={onKeepOpen} onBack={back} onClose={onClose} />}
      {screen === "info" && row && row.kind === "group" && (
        <GroupInfo key={row.id} row={row} me={profile?.id} reload={reload} onBack={back} onClose={onClose}
          onLeft={() => { onSelect(null); onScreen(null); }} />
      )}
    </div>
  );
}
