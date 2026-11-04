import { useState } from "react";
import ChatList from "./ChatList.jsx";
import Conversation from "./Conversation.jsx";
import NewChat from "./NewChat.jsx";
import GroupInfo from "./GroupInfo.jsx";
import AttachPicker from "./AttachPicker.jsx";

// Two panes: the list and the open chat. On phones only one shows at a time.
// Drafts live here, so a half-typed message survives switching chats and closing the panel.
export default function MessengerPanel({ profile, rows, reload, onMessage, visible, connected = true, error = "", onClose }) {
  const [selected, setSelected] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [screen, setScreen] = useState(null); // "new", "info", or null
  const row = rows.find((r) => r.id === selected);

  // The new chat arrives through reload; selection is by id, so it shows as soon as the row is in the list.
  async function opened(id) {
    await reload();
    setSelected(id);
    setScreen(null);
  }

  return (
    <div className={`msgr-panel ${row ? "msgr-show-chat" : "msgr-show-list"}`} hidden={!visible} role="dialog" aria-label="Team chat">
      {!connected && <div className="msgr-reconnect">Reconnecting…</div>}
      <div className="msgr-panes">
        <ChatList rows={rows} selectedId={selected} myId={profile?.id} error={error} onSelect={setSelected} onRetry={reload} onClose={onClose} onNew={() => setScreen("new")} />
        {row ? (
          <Conversation key={row.id} row={row} profile={profile} visible={visible} connected={connected} onMessage={onMessage} reload={reload}
            draft={drafts[row.id] || ""} onDraft={(text) => setDrafts((d) => ({ ...d, [row.id]: text }))}
            onBack={() => setSelected(null)} onClose={onClose}
            onInfo={() => setScreen("info")} attachSlot={(slot) => <AttachPicker {...slot} />} />
        ) : (
          <section className="msgr-chat-pane" aria-label="Conversation"><p className="msgr-empty">Select a chat</p></section>
        )}
      </div>
      {screen === "new" && <NewChat me={profile?.id} onOpened={opened} onBack={() => setScreen(null)} onClose={onClose} />}
      {screen === "info" && row && row.kind === "group" && (
        <GroupInfo key={row.id} row={row} me={profile?.id} reload={reload} onBack={() => setScreen(null)} onClose={onClose}
          onLeft={() => { setSelected(null); setScreen(null); }} />
      )}
    </div>
  );
}
