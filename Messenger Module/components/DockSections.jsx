import MessengerPanel from "./MessengerPanel.jsx";
import TeamsSection from "./TeamsSection.jsx";
import ActivitySection from "./ActivitySection.jsx";
import InboxSection from "./InboxSection.jsx";
import CallsSection from "./CallsSection.jsx";
import FilesSection from "./FilesSection.jsx";
import { SECTIONS } from "../logic/app.js";
import "../replica/design/tokens.css";
import "./messengerApp.css";

// The open pane of the dock. It shows the Messenger page's own sections, so the two stay in step.
// Chats and Teams stay mounted, so half-typed messages survive switching section.
export default function DockSections({ section, profile, chat, teamsData, activity, target, inboxChannel, onActivityOpen, onCountChanged, onOpenSettings, onOpenPage, onClose }) {
  const label = SECTIONS.find((s) => s.key === section)?.label || "Chats";
  const isAdmin = profile?.role === "admin";
  return (
    <div className={`msgr-sections msgr-section-${section}`}>
      <header className="msgr-section-bar">
        <strong>{label}</strong>
        {onOpenPage && <button type="button" className="msgr-link" onClick={onOpenPage}>Open the full page</button>}
        <button type="button" className="msgr-close" onClick={onClose} aria-label="Close chat">×</button>
      </header>
      <div className="msgr-section-body">
        <div className="msgr-section-fill" hidden={section !== "chats"}>
          <MessengerPanel {...chat} profile={profile} visible={chat.visible && section === "chats"} />
        </div>
        <div className="msgr-section-fill" hidden={section !== "teams"}>
          <TeamsSection profile={profile} teamsData={teamsData} visible={chat.visible && section === "teams"} connected={chat.connected} onMessage={chat.onMessage} target={target} />
        </div>
        {section === "activity" && <ActivitySection {...activity} onOpen={onActivityOpen} onMarkAll={() => activity.markRead()} onRetry={activity.reload} />}
        {section === "inbox" && <InboxSection key={inboxChannel} initialChannel={inboxChannel} me={profile?.id} isAdmin={isAdmin} onCountChanged={onCountChanged} onOpenSettings={onOpenSettings} />}
        {section === "calls" && <CallsSection />}
        {section === "files" && <FilesSection chats={chat.rows} />}
      </div>
    </div>
  );
}
