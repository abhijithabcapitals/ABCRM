import { useState } from "react";
import { checkBody, checkWebLink } from "../logic/chat.js";
import { QUICK_REACTIONS, formatBytes, mentionParts, reactionList } from "../logic/parity.js";

const TICKS = { sent: ["✓", "Sent"], read: ["✓✓", "Read"], sending: ["…", "Sending"] };
const TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", hour12: false });

function Editor({ start, onSave, onCancel }) {
  const [text, setText] = useState(start);
  const [problem, setProblem] = useState("");
  async function save() {
    const bad = checkBody(text);
    if (bad) { setProblem(bad); return; }
    try { await onSave(text.trim()); } catch (e) { setProblem(e.message); }
  }
  return (
    <div className="msgr-edit">
      <textarea className="msgr-input" aria-label="Edit message" autoFocus value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } }} />
      {problem && <p className="msgr-problem" role="alert">{problem}</p>}
      <div className="msgr-edit-row">
        <button type="button" className="msgr-link" onClick={save}>Save</button>
        <button type="button" className="msgr-link" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// The buttons on one message, shown on hover or keyboard focus. Delete asks once more in place.
function Actions({ mine, editable, onReply, onReact, onEdit, onDelete }) {
  const [asking, setAsking] = useState(false);
  if (asking) {
    return (
      <div className="msgr-actions msgr-actions-on">
        <span>Delete this message?</span>
        <button type="button" className="msgr-link" onClick={onDelete}>Delete</button>
        <button type="button" className="msgr-link" onClick={() => setAsking(false)}>Keep</button>
      </div>
    );
  }
  return (
    <div className="msgr-actions">
      {QUICK_REACTIONS.map((e) => <button key={e} type="button" className="msgr-action" aria-label={`React with ${e}`} onClick={() => onReact(e)}>{e}</button>)}
      {onReply && <button type="button" className="msgr-action" onClick={onReply}>Reply</button>}
      {mine && editable && <button type="button" className="msgr-action" onClick={onEdit}>Edit</button>}
      {mine && <button type="button" className="msgr-action" onClick={() => setAsking(true)}>Delete</button>}
    </div>
  );
}

// One message bubble. Text goes in as React text nodes, so nothing in a message is ever read as HTML.
// Only a web link opens; a record label is plain text because the CRM has no address for one record.
export default function Message({ message, mine, name, tick, onRetry, me, names = [], parent, noQuote, footer, onReply, onReact, onEdit, onDelete, onOpenFile }) {
  const [editing, setEditing] = useState(false);
  const label = message.link_label;
  const openable = message.link_type === "web" && !checkWebLink(message.link_ref);
  // A link sent without text has its label as the body; show it once.
  const same = !!label && message.body === label;
  const hideText = (same && message.link_type === "web") || !!message.attachment;
  const hideLabel = same && message.link_type !== "web";
  const deleted = !!message.deleted_at;
  const settled = !message.status && !deleted && !!onReact;
  const file = message.attachment;
  const reactions = reactionList(message.reactions, me);
  return (
    <div className={`msgr-msg ${mine ? "msgr-mine" : "msgr-theirs"}`}>
      {name && <span className="msgr-sender">{name}</span>}
      {message.parent_id && !deleted && !noQuote && <span className="msgr-quote">{parent ? (parent.deleted_at ? "Message deleted" : parent.body) : "Earlier message"}</span>}
      {deleted
        ? <span className="msgr-text msgr-deleted">Message deleted</span>
        : editing
          ? <Editor start={message.body} onCancel={() => setEditing(false)} onSave={async (text) => { await onEdit(text); setEditing(false); }} />
          : message.body && !hideText && <span className="msgr-text">{mentionParts(message.body, names).map((p, i) => (p.mention ? <span key={i} className="msgr-mention">{p.text}</span> : p.text))}</span>}
      {file && !deleted && (
        <button type="button" className="msgr-file" disabled={!file.id} onClick={() => onOpenFile?.(file.id)} aria-label={`Download ${file.name}`}>
          <span className="msgr-file-name">{file.name}</span>
          <small>{formatBytes(file.size)}</small>
        </button>
      )}
      {!deleted && label && !hideLabel && (openable
        ? <a className="msgr-attach" href={message.link_ref} target="_blank" rel="noopener noreferrer">{label}</a>
        : <span className="msgr-attach">{label}</span>)}
      {!deleted && reactions.length > 0 && (
        <div className="msgr-reactions">
          {reactions.map((r) => (
            <button key={r.emoji} type="button" className={`msgr-reaction${r.mine ? " msgr-reaction-mine" : ""}`} aria-pressed={r.mine}
              aria-label={`${r.emoji}, ${r.count}`} onClick={() => onReact?.(r.emoji)}>{r.emoji} {r.count}</button>
          ))}
        </div>
      )}
      <span className="msgr-meta">
        {message.edited_at && !deleted && "Edited "}
        {TIME.format(new Date(message.created_at))}
        {tick === "failed"
          ? <> <span className="msgr-failed">Not sent</span> <button type="button" className="msgr-link" onClick={onRetry}>Retry</button></>
          : tick && <span className={`msgr-tick msgr-tick-${tick}`} title={TICKS[tick][1]}> {TICKS[tick][0]}</span>}
      </span>
      {footer}
      {settled && !editing && <Actions mine={mine} editable={!file} onReply={onReply} onReact={onReact} onEdit={() => setEditing(true)} onDelete={onDelete} />}
    </div>
  );
}
