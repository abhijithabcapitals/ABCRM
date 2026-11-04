import { useState } from "react";
import "@banking/components/banking.css";
import Overview from "./Overview.jsx";
import Chats from "./Chats.jsx";

// Phase 2 adds Settings and Logs here.
const TABS = [["overview", "Overview", Overview], ["chats", "Chats", Chats]];

export default function MessengerModule({ profile }) {
  const [tab, setTab] = useState("overview");
  const Current = TABS.find(([key]) => key === tab)[2];
  return (
    <div className="bk-root">
      <header className="bk-header"><div><span className="bk-eyebrow">AB CAPITAL SERVICES FZE</span><h1>Messenger</h1></div></header>
      <div className="bk-nav-wrap"><nav className="bk-nav" aria-label="Messenger">
        {TABS.map(([key, label]) => (
          <button type="button" key={key} data-label={label} aria-current={tab === key ? "page" : undefined} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav></div>
      <Current profile={profile} />
    </div>
  );
}
