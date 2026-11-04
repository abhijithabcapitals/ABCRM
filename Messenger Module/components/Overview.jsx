// Short status: chats are ready, and whether Microsoft is connected for this person.
import "./messenger.css";
import "@banking/components/banking.css";
import { Spinner, useLoad } from "@banking/components/shared";
import { connectionStatus } from "../services/messengerApi.js";
import { connectionLine } from "../logic/connectionText.js";

export default function Overview() {
  const status = useLoad(connectionStatus, []);
  return (
    <ul className="msg-list">
      <li>Chats: ready. Pick colleagues on the Chats tab and open a Teams chat.</li>
      <li>Microsoft connection: {status.loading ? <Spinner /> : status.error ? "Could not be checked. Open Settings." : connectionLine(status.data)}</li>
    </ul>
  );
}
