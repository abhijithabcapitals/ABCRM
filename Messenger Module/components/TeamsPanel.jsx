// Starts a Microsoft Teams chat from a client or lead record. Only the record reference goes into the message.
import { useMemo, useState } from "react";
import "@banking/components/banking.css";
import { Button, Empty, ErrorNote, Panel, Spinner, useLoad } from "@banking/components/shared";
import { buildChatLink, participantsKey, referenceText } from "../logic/deepLink.js";
import { splitStaff } from "../logic/people.js";
import { currentUserId as fetchUserId, deleteLink, listLinks, listStaff, saveChatLink } from "../services/messengerApi.js";

export default function TeamsPanel({ recordType, recordId, displayId, label, currentUserId }) {
  const staff = useLoad(async () => ({ rows: await listStaff(), me: currentUserId || (await fetchUserId()) }), [currentUserId]);
  const links = useLoad(() => listLinks(recordType, recordId), [recordType, recordId]);
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState([]);
  const [topic, setTopic] = useState("");
  const defaultMessage = useMemo(() => referenceText({ recordType, id: displayId, label }), [recordType, displayId, label]);
  const [message, setMessage] = useState(defaultMessage);
  const [blockedUrl, setBlockedUrl] = useState(null);
  const [error, setError] = useState(null);

  const { available, noEmail } = splitStaff(staff.data?.rows, staff.data?.me);
  const q = search.trim().toLowerCase();
  const match = (p) => !q || `${p.full_name ?? ""} ${p.email ?? ""}`.toLowerCase().includes(q);
  const toggle = (email) => setChosen((c) => (c.includes(email) ? c.filter((e) => e !== email) : [...c, email]));
  const nameOf = (email) => available.find((p) => p.email === email)?.full_name || email;

  const open = (emails, chatTopic, text, savedLabel) => {
    setError(null);
    setBlockedUrl(null);
    let url;
    try { url = buildChatLink({ emails, topic: chatTopic, message: text }); } catch (e) { setError(e.message); return; }
    // Opened straight from the click so the browser allows it.
    const win = window.open(url, "_blank", "noopener");
    if (!win) setBlockedUrl(url);
    saveChatLink({ recordType, recordId, reference: participantsKey(emails), label: savedLabel })
      .then(() => links.reload())
      .catch((e) => setError(`The chat opened, but it could not be saved to this record: ${e.message}`));
  };

  const start = () => open(chosen, topic, message, topic.trim() || chosen.map(nameOf).join(", "));
  const again = (l) => open(l.reference.split(","), l.label, message, l.label);
  const remove = async (l) => {
    try { await deleteLink(l.id); links.reload(); } catch (e) { setError(e.message); }
  };

  return (
    <Panel title="Teams" sub="Start a Teams chat about this record. The message holds only the reference.">
      <ErrorNote message={error || staff.error || links.error} onClose={error ? () => setError(null) : undefined} />
      {staff.loading ? <Spinner /> : (
        <>
          <input type="search" aria-label="Search staff" placeholder="Search staff" value={search} onChange={(e) => setSearch(e.target.value)} />
          <ul className="bk-list">
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
      <h4>Saved chats</h4>
      {links.loading ? <Spinner /> : (links.data || []).length === 0 ? <Empty>No chats saved for this record.</Empty> : (
        <ul className="bk-list">
          {links.data.map((l) => (
            <li key={l.id}>{l.label} <Button onClick={() => again(l)}>Open again</Button> <Button onClick={() => remove(l)}>Remove</Button></li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
