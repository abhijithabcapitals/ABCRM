import { useEffect, useState } from "react";
import "@banking/components/banking.css";
import Overview from "./Overview.jsx";
import Chats from "./Chats.jsx";
import Settings from "./Settings.jsx";
import SyncLogs from "./SyncLogs.jsx";
import { connectionMessage } from "../logic/connectionText.js";

// The fourth item marks a tab that only admins see.
const TABS = [["overview", "Overview", Overview], ["chats", "Chats", Chats], ["settings", "Settings", Settings], ["logs", "Logs", SyncLogs, true]];

// Microsoft sends the person back with ms and reason in the address. They are read once, then removed.
const fromAddress = () => {
  const q = new URLSearchParams(location.search);
  return connectionMessage(q.get("ms"), q.get("reason"));
};

export default function MessengerModule({ profile }) {
  const [notice, setNotice] = useState(fromAddress);
  const [tab, setTab] = useState(() => (notice ? "settings" : "overview"));
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (q.has("ms") || q.has("reason")) {
      q.delete("ms");
      q.delete("reason");
      history.replaceState(null, "", location.pathname + (q.size ? "?" + q : "") + location.hash);
    }
  }, []);
  const isAdmin = profile?.role === "admin";
  const tabs = TABS.filter(([, , , adminOnly]) => !adminOnly || isAdmin);
  const Current = (tabs.find(([key]) => key === tab) || tabs[0])[2];
  return (
    <div className="bk-root">
      <header className="bk-header"><div><span className="bk-eyebrow">AB CAPITAL SERVICES FZE</span><h1>Messenger</h1></div></header>
      <div className="bk-nav-wrap"><nav className="bk-nav" aria-label="Messenger">
        {tabs.map(([key, label]) => (
          <button type="button" key={key} data-label={label} aria-current={tab === key ? "page" : undefined} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav></div>
      {notice && (
        <div className={`bk-alert bk-alert-${notice.tone}`} role="status">
          {notice.text} <button type="button" className="bk-btn bk-btn-secondary" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}
      <Current profile={profile} />
    </div>
  );
}
