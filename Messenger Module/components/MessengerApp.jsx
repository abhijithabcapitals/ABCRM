import { useState } from "react";
import logo from "@app/assets/ab-capital-logo.webp";
import AppBar from "./AppBar.jsx";
import ChatBoundary from "./ChatBoundary.jsx";
import PageChatList from "./PageChatList.jsx";
import MessengerPanel from "./MessengerPanel.jsx";
import SectionNote from "./SectionNote.jsx";
import useChat from "./useChat.js";
import { SECTIONS, readSection, saveSection } from "../logic/app.js";
import { initials } from "../logic/chat.js";
import "../replica/design/tokens.css";
import "./chat.css";
import "./messengerApp.css";

function Inner({ profile }) {
  const { rows, total, error, loaded, connected, reload, onMessage } = useChat(profile?.id);
  const [section, setSection] = useState(readSection);
  const [selected, setSelected] = useState(null);
  const [screen, setScreen] = useState(null); // "new", "info", or null
  const [query, setQuery] = useState("");
  const paneOpen = !!selected || !!screen;
  const current = SECTIONS.find((s) => s.key === section);

  const go = (key) => { setSection(key); saveSection(key); };
  const pick = (id) => { setSelected(id); setScreen(null); };
  const closePane = () => { setSelected(null); setScreen(null); };
  const search = (text) => { setQuery(text); if (section !== "chats") go("chats"); };

  return (
    <div className={`abm-app${paneOpen && section === "chats" ? " abm-pane-open" : ""}`}>
      <header className="abm-top">
        <img className="abm-logo" src={logo} alt="AB Capital" />
        <span className="abm-name">Messenger</span>
        <input className="abm-search" type="search" value={query} placeholder="Search chats by name" aria-label="Search chats by name" onChange={(e) => search(e.target.value)} />
        <span className="abm-me" title={profile?.full_name || ""} aria-label={`Signed in as ${profile?.full_name || "you"}`} role="img">{initials(profile?.full_name || "You")}</span>
      </header>
      <AppBar section={section} unread={error ? 0 : total} onSection={go} />
      <div className="abm-work">
        {/* Stays mounted across sections, so a half-typed message survives. */}
        <div className="abm-chats" hidden={section !== "chats"}>
          <PageChatList rows={rows} myId={profile?.id} loaded={loaded} error={error} query={query} selected={selected}
            onSelect={pick} onNew={() => setScreen("new")} onRetry={reload} />
          <div className="abm-pane" hidden={!paneOpen}>
            <MessengerPanel profile={profile} rows={rows} reload={reload} onMessage={onMessage} visible={section === "chats"} connected={connected}
              selected={selected} onSelect={setSelected} screen={screen} onScreen={setScreen} onClose={closePane} />
          </div>
          {!paneOpen && <p className="abm-pane-empty">Pick a chat to read it here.</p>}
        </div>
        {current?.phase && <SectionNote section={current} />}
      </div>
    </div>
  );
}

export default function MessengerApp({ profile }) {
  return (
    <ChatBoundary fallback={<p className="abm-failed">Messenger could not open. Please reload the page.</p>}>
      <Inner profile={profile} />
    </ChatBoundary>
  );
}
