import { checkWebLink } from "../logic/chat.js";

const TICKS = { sent: ["✓", "Sent"], read: ["✓✓", "Read"], sending: ["…", "Sending"] };
const TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", hour12: false });

// One message bubble. Text goes in as a React text node, so nothing in a message is ever read as HTML.
// Only a web link opens; a record label is plain text because the CRM has no address for one record.
export default function Message({ message, mine, name, tick, onRetry }) {
  const label = message.link_label;
  const openable = message.link_type === "web" && !checkWebLink(message.link_ref);
  return (
    <div className={`msgr-msg ${mine ? "msgr-mine" : "msgr-theirs"}`}>
      {name && <span className="msgr-sender">{name}</span>}
      {message.body && <span className="msgr-text">{message.body}</span>}
      {label && (openable
        ? <a className="msgr-attach" href={message.link_ref} target="_blank" rel="noopener noreferrer">{label}</a>
        : <span className="msgr-attach">{label}</span>)}
      <span className="msgr-meta">
        {TIME.format(new Date(message.created_at))}
        {tick === "failed"
          ? <> <span className="msgr-failed">Not sent</span> <button type="button" className="msgr-link" onClick={onRetry}>Retry</button></>
          : tick && <span className={`msgr-tick msgr-tick-${tick}`} title={TICKS[tick][1]}> {TICKS[tick][0]}</span>}
      </span>
    </div>
  );
}
