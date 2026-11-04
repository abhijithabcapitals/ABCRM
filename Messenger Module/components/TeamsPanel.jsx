// Starts a Microsoft Teams chat from a client or lead record. Only the record reference goes into the message.
import { useMemo, useRef, useState } from "react";
import "@banking/components/banking.css";
import "./messenger.css";
import { Button, Empty, ErrorNote, Panel, Spinner, useLoad } from "@banking/components/shared";
import { participantsKey, referenceText } from "../logic/deepLink.js";
import { deleteLink, listLinks, saveChatLink } from "../services/messengerApi.js";
import ChatStarter from "./ChatStarter.jsx";

export default function TeamsPanel({ recordType, recordId, displayId, label, currentUserId }) {
  const links = useLoad(() => listLinks(recordType, recordId), [recordType, recordId]);
  const starter = useRef(null);
  const [error, setError] = useState(null);
  const defaultMessage = useMemo(() => referenceText({ recordType, id: displayId, label }), [recordType, displayId, label]);

  const save = async ({ emails, label: savedLabel }) => {
    try {
      await saveChatLink({ recordType, recordId, reference: participantsKey(emails), label: savedLabel });
    } catch (e) {
      throw new Error(`The chat opened, but it could not be saved to this record: ${e.message}`);
    }
    links.reload();
  };
  const again = (l) => starter.current?.open(l.reference.split(","), l.label, l.label);
  const remove = async (l) => {
    try { await deleteLink(l.id); links.reload(); } catch (e) { setError(e.message); }
  };

  return (
    <div className="msg-teams">
    <Panel title="Teams" sub="Start a Teams chat about this record. The message holds only the reference.">
      <ErrorNote message={error || (links.error ? "Saved chats could not be loaded. You can still start a chat." : null)} onClose={error ? () => setError(null) : undefined} />
      <ChatStarter ref={starter} message={defaultMessage} onOpened={save} currentUserId={currentUserId} />
      <h4>Saved chats</h4>
      {links.loading ? <Spinner /> : (links.data || []).length === 0 ? <Empty>No chats saved for this record.</Empty> : (
        <ul className="msg-list">
          {links.data.map((l) => (
            <li key={l.id}>{l.label} <Button onClick={() => again(l)}>Open again</Button> <Button onClick={() => remove(l)}>Remove</Button></li>
          ))}
        </ul>
      )}
    </Panel>
    </div>
  );
}
