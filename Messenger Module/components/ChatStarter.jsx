// Staff picker and "Open in Teams" button. Shared by the record panel and the Chats tab.
import { useImperativeHandle, useState } from "react";
import "@banking/components/banking.css";
import "./messenger.css";
import { Button, ErrorNote, Spinner, useLoad } from "@banking/components/shared";
import { buildChatLink } from "../logic/deepLink.js";
import { splitStaff } from "../logic/people.js";
import { currentUserId as fetchUserId, listStaff } from "../services/messengerApi.js";

// onOpened({ emails, topic, label }) runs after the window opens; if it throws, the message is shown.
export default function ChatStarter({ message: initialMessage = "", onOpened, currentUserId, ref }) {
  const staff = useLoad(async () => ({ rows: await listStaff(), me: currentUserId || (await fetchUserId()) }), [currentUserId]);
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState([]);
  const [topic, setTopic] = useState("");
  const [message, setMessage] = useState(initialMessage);
  const [blockedUrl, setBlockedUrl] = useState(null);
  const [error, setError] = useState(null);

  const { available, noEmail } = splitStaff(staff.data?.rows, staff.data?.me);
  const q = search.trim().toLowerCase();
  const match = (p) => !q || `${p.full_name ?? ""} ${p.email ?? ""}`.toLowerCase().includes(q);
  const toggle = (email) => setChosen((c) => (c.includes(email) ? c.filter((e) => e !== email) : [...c, email]));
  const nameOf = (email) => available.find((p) => p.email === email)?.full_name || email;

  const open = (emails, chatTopic, savedLabel) => {
    setError(null);
    setBlockedUrl(null);
    let url;
    try { url = buildChatLink({ emails, topic: chatTopic, message }); } catch (e) { setError(e.message); return; }
    // Opened straight from the click so the browser allows it.
    // No "noopener" feature: it makes window.open return null even when the window opened.
    const win = window.open(url, "_blank");
    if (win) win.opener = null;
    else setBlockedUrl(url);
    Promise.resolve()
      .then(() => onOpened?.({ emails, topic: chatTopic, label: savedLabel }))
      .catch((e) => setError(e.message));
  };

  useImperativeHandle(ref, () => ({ open }));

  const start = () => open(chosen, topic, topic.trim() || chosen.map(nameOf).join(", "));

  return (
    <>
      <ErrorNote message={error || staff.error} onClose={error ? () => setError(null) : undefined} />
      {staff.loading ? <Spinner /> : (
        <>
          <input type="search" aria-label="Search staff" placeholder="Search staff" value={search} onChange={(e) => setSearch(e.target.value)} />
          <ul className="msg-list msg-picker">
            {available.filter(match).map((p) => (
              <li key={p.id}>
                <label><input type="checkbox" checked={chosen.includes(p.email)} onChange={() => toggle(p.email)} /> {p.full_name} <small>{p.email}</small></label>
              </li>
            ))}
            {noEmail.filter(match).map((p) => (
              <li key={p.id} style={{ opacity: 0.5 }}><label><input type="checkbox" disabled /> {p.full_name} <small>No email on file</small></label></li>
            ))}
          </ul>
          {chosen.length > 1 && (
            <div className="bk-field"><label htmlFor="teams-topic">Chat topic</label><input id="teams-topic" value={topic} onChange={(e) => setTopic(e.target.value)} /></div>
          )}
          <div className="bk-field bk-full"><label htmlFor="teams-message">Message</label><textarea id="teams-message" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
          <div className="bk-actions bk-mt"><Button variant="primary" disabled={chosen.length === 0} onClick={start}>Open in Teams</Button></div>
        </>
      )}
      {blockedUrl && <div className="bk-alert bk-alert-warn">Your browser blocked the new window. <a href={blockedUrl} target="_blank" rel="noopener noreferrer">Open it here.</a></div>}
    </>
  );
}
