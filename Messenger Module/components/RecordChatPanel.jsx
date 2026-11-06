// Starts or reopens a CRM Messenger group about a client, lead or task record, then opens it in the Messenger dock.
// The same record with the same people always comes back to the same group.
import { useMemo, useState } from "react";
import "@banking/components/banking.css";
import "./messenger.css";
import { Button, Empty, ErrorNote, Panel, Spinner, useLoad } from "@banking/components/shared";
import { referenceText } from "../logic/deepLink.js";
import { groupTitle, messengerLinks, openRecordGroup, requestOpenChat } from "../logic/recordChat.js";
import chatApi from "../services/chatClient.js";
import { currentUserId as fetchUserId, deleteLink, listLinks, listStaff, saveChatLink } from "../services/messengerApi.js";

const byName = (a, b) => String(a.full_name ?? "").localeCompare(String(b.full_name ?? ""));

export default function RecordChatPanel({ recordType, recordId, displayId, label, currentUserId }) {
  const staff = useLoad(async () => ({ rows: await listStaff(), me: currentUserId || (await fetchUserId()) }), [currentUserId]);
  const links = useLoad(() => listLinks(recordType, recordId), [recordType, recordId]);
  const defaultMessage = useMemo(() => referenceText({ recordType, id: displayId }), [recordType, displayId]);
  const title = useMemo(() => groupTitle({ recordType, id: displayId, label }), [recordType, displayId, label]);
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState([]);
  const [message, setMessage] = useState(defaultMessage);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);

  const me = staff.data?.me;
  const people = (staff.data?.rows || []).filter((p) => p.id !== me).sort(byName);
  const q = search.trim().toLowerCase();
  const match = (p) => !q || `${p.full_name ?? ""} ${p.email ?? ""}`.toLowerCase().includes(q);
  const toggle = (id) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const nameOf = (id) => people.find((p) => p.id === id)?.full_name || "Unnamed";
  const saved = messengerLinks(links.data);

  const start = async () => {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      const { conversationId } = await openRecordGroup({
        chat: chatApi,
        links: {
          list: () => listLinks(recordType, recordId),
          save: ({ reference, label: savedLabel }) => saveChatLink({ recordType, recordId, reference, label: savedLabel }),
        },
        newId: () => crypto.randomUUID(),
      }, {
        me, memberIds: chosen, title, label: chosen.map(nameOf).join(", "), message, defaultMessage,
        link: { type: recordType, ref: String(recordId), label: defaultMessage },
      });
      requestOpenChat(conversationId);
      setChosen([]);
      links.reload();
    } catch (e) {
      setError(e.message || "Could not open the group. Please try again.");
    } finally {
      setWorking(false);
    }
  };
  const remove = async (l) => {
    try { await deleteLink(l.id); links.reload(); } catch (e) { setError(e.message); }
  };

  return (
    <div className="msg-teams">
    <Panel title="Messenger" sub={`Start or reopen a group chat about this record. The group is named “${title}”.`}>
      <ErrorNote message={error || staff.error || (links.error ? "Saved chats could not be loaded. You can still start a chat." : null)} onClose={error ? () => setError(null) : undefined} />
      {staff.loading ? <Spinner /> : (
        <>
          <input type="search" aria-label="Search staff" placeholder="Search staff" value={search} onChange={(e) => setSearch(e.target.value)} />
          <ul className="msg-list msg-picker">
            {people.filter(match).map((p) => (
              <li key={p.id}>
                <label><input type="checkbox" checked={chosen.includes(p.id)} onChange={() => toggle(p.id)} /> {p.full_name || "Unnamed"} {p.email && <small>{p.email}</small>}</label>
              </li>
            ))}
          </ul>
          <div className="bk-field bk-full"><label htmlFor={`msgr-record-message-${recordId}`}>Message</label><textarea id={`msgr-record-message-${recordId}`} rows={2} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
          <div className="bk-actions bk-mt"><Button variant="primary" disabled={chosen.length === 0 || working || !me} onClick={start}>{working ? "Opening…" : "Open group in Messenger"}</Button></div>
        </>
      )}
      <h4>Saved chats</h4>
      {links.loading ? <Spinner /> : saved.length === 0 ? <Empty>No chats saved for this record.</Empty> : (
        <ul className="msg-list">
          {saved.map((l) => (
            <li key={l.id}>{l.label} <Button onClick={() => requestOpenChat(l.conversationId)}>Open again</Button> <Button onClick={() => remove(l)}>Remove</Button></li>
          ))}
        </ul>
      )}
    </Panel>
    </div>
  );
}
