// Start a chat with no record, and list the person's last 20 saved chats.
import "@banking/components/banking.css";
import { Empty, ErrorNote, Panel, Spinner, fmtDateTime, useLoad } from "@banking/components/shared";
import { listMyChats } from "../services/messengerApi.js";
import ChatStarter from "./ChatStarter.jsx";

export default function Chats() {
  const chats = useLoad(() => listMyChats(20), []);
  return (
    <>
      <Panel title="New chat" sub="Pick one or more colleagues and open a Teams chat.">
        <ChatStarter message="" />
      </Panel>
      <Panel title="Your saved chats" sub="Chats you started from client and lead records. Last 20.">
        <ErrorNote message={chats.error} />
        {chats.loading ? <Spinner /> : (chats.data || []).length === 0 ? <Empty>No saved chats yet.</Empty> : (
          <ul className="bk-list">
            {chats.data.map((c) => <li key={c.id}>{c.label} <small>{c.record_type} {c.record_id} - {fmtDateTime(c.created_at)}</small></li>)}
          </ul>
        )}
      </Panel>
    </>
  );
}
