import { useState } from "react";
import logo from "@app/assets/ab-capital-logo.webp";
import AppBar from "./AppBar.jsx";
import ChatBoundary from "./ChatBoundary.jsx";
import PageChatList from "./PageChatList.jsx";
import MessengerPanel from "./MessengerPanel.jsx";
import SectionNote from "./SectionNote.jsx";
import SettingsSection from "./SettingsSection.jsx";
import useDesktop from "./useDesktop.js";
import TeamsSection from "./TeamsSection.jsx";
import useTeams from "./useTeams.js";
import ActivitySection from "./ActivitySection.jsx";
import FilesSection from "./FilesSection.jsx";
import StatusMenu from "./StatusMenu.jsx";
import useActivity from "./useActivity.js";
import usePresence from "./usePresence.js";
import useChat from "./useChat.js";
import { SECTIONS, readSection, saveSection } from "../logic/app.js";
import { teamsUnread } from "../logic/teams.js";
import "../replica/design/tokens.css";
import "./chat.css";
import "./messengerApp.css";

function Inner({ profile, onSignOut }) {
  const { rows, total, error, loaded, connected, reload, onMessage } = useChat(profile?.id);
  const activity = useActivity(profile?.id, onMessage);
  const presence = usePresence(profile?.id);
  const teamsData = useTeams(profile?.id, onMessage);
  const [target, setTarget] = useState(null); // the channel or thread Activity or search asked to open
  const [section, setSection] = useState(readSection);
  const [selected, setSelected] = useState(null);
  const [screen, setScreen] = useState(null); // "new", "info", or null
  const [query, setQuery] = useState("");
  const paneOpen = !!selected || !!screen;
  const teamsUnreadCount = teamsData.error ? 0 : teamsUnread(teamsData.rows);
  const current = SECTIONS.find((s) => s.key === section);

  const go = (key) => { setSection(key); saveSection(key); };
  const pick = (id) => { setSelected(id); setScreen(null); };
  const closePane = () => { setSelected(null); setScreen(null); };
  // A result from Activity or search can live in a chat, a channel, or a channel's thread.
  const openResult = (row) => {
    if (row.conversation_kind === "channel") {
      setTarget({ conversationId: row.conversation_id, threadId: row.parent_id || null });
      go("teams");
    } else {
      pick(row.conversation_id);
      go("chats");
    }
  };
  useDesktop({ me: profile?.id, unread: (error ? 0 : total) + teamsUnreadCount, chats: rows, channels: teamsData.rows, status: presence.mine, onMessage, openResult });
  const openActivity = (row) => {
    if (!row.read_at) activity.markRead(row.id);
    openResult(row);
  };
  const search = (text) => { setQuery(text); if (section !== "chats") go("chats"); };

  return (
    <div className={`abm-app${paneOpen && section === "chats" ? " abm-pane-open" : ""}`}>
      <header className="abm-top">
        <img className="abm-logo" src={logo} alt="AB Capital" />
        <span className="abm-name">Messenger</span>
        <input className="abm-search" type="search" value={query} placeholder="Search chats and messages" aria-label="Search chats and messages" onChange={(e) => search(e.target.value)} />
        <StatusMenu name={profile?.full_name} status={presence.mine} onStatus={presence.setStatus} onSettings={() => go("settings")} />
      </header>
      <AppBar section={section} unread={{ chats: error ? 0 : total, activity: activity.unread, teams: teamsUnreadCount }} onSection={go} />
      <div className="abm-work">
        {/* Stays mounted across sections, so a half-typed message survives. */}
        <div className="abm-chats" hidden={section !== "chats"}>
          <PageChatList rows={rows} myId={profile?.id} loaded={loaded} error={error} query={query} selected={selected}
            onSelect={pick} onNew={() => setScreen("new")} onRetry={reload} stateOf={presence.state} onOpenResult={openResult} />
          <div className="abm-pane" hidden={!paneOpen}>
            <MessengerPanel profile={profile} rows={rows} reload={reload} onMessage={onMessage} visible={section === "chats"} connected={connected}
              selected={selected} onSelect={setSelected} screen={screen} onScreen={setScreen} onClose={closePane} statusOf={presence.label} />
          </div>
          {!paneOpen && <p className="abm-pane-empty">Pick a chat to read it here.</p>}
        </div>
        <div className="abm-chats" hidden={section !== "teams"}>
          <TeamsSection profile={profile} teamsData={teamsData} visible={section === "teams"} connected={connected} onMessage={onMessage} target={target} />
        </div>
        {current?.phase && <SectionNote section={current} />}
        {section === "activity" && <ActivitySection {...activity} onOpen={openActivity} onMarkAll={() => activity.markRead()} onRetry={activity.reload} />}
        {section === "files" && <FilesSection chats={rows} />}
        {section === "settings" && <SettingsSection name={profile?.full_name} onSignOut={onSignOut} />}
      </div>
    </div>
  );
}

export default function MessengerApp({ profile, onSignOut }) {
  return (
    <ChatBoundary fallback={<p className="abm-failed">Messenger could not open. Please reload the page.</p>}>
      <Inner profile={profile} onSignOut={onSignOut} />
    </ChatBoundary>
  );
}
