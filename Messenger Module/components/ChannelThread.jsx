import { useCallback, useEffect, useRef, useState } from "react";
import inboxApi from "../services/inboxClient.js";
import { contactLabel, replyWindowOpen } from "../logic/inbox.js";

const WHEN = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const FIRST_LOOK = { sending: "Sending…", failed: "Not sent" };

// One WhatsApp, Telegram or Instagram conversation. Text goes in as React text nodes, so nothing a client sends is read as HTML.
export default function ChannelThread({ thread, account, me, onClose, onChanged }) {
  const [messages, setMessages] = useState(null);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef(null);
  const canReply = replyWindowOpen(thread, account?.channel);

  const load = useCallback(async () => {
    try {
      setMessages(await inboxApi.channelMessages(thread.id));
    } catch (e) {
      setProblem(e.message);
    }
  }, [thread.id]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const stop = inboxApi.subscribeInbox(load);
    return () => { clearTimeout(first); stop(); };
  }, [load]);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [messages]);

  async function send() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setProblem("");
    try {
      await inboxApi.channelSend(thread.id, body);
      setDraft("");
    } catch (e) {
      setProblem(e.message);
    }
    setBusy(false);
    load();
    onChanged();
  }

  async function act(fn) {
    setProblem("");
    try {
      await fn();
      onChanged();
    } catch (e) {
      setProblem(e.message);
    }
  }

  const name = contactLabel(thread);
  const archived = thread.status === "archived";
  return (
    <section className="abi-thread" aria-label="Conversation">
      <header className="abi-thread-head">
        <div className="abi-thread-title">
          <strong title={name}>{name}</strong>
          <small>{account?.label}{account?.display_name ? `, ${account.display_name}` : ""}</small>
        </div>
        {thread.assigned_to === me
          ? <button type="button" className="abm-btn-quiet" onClick={() => act(() => inboxApi.channelAssign(thread.id, null))}>Unassign</button>
          : <button type="button" className="abm-btn-quiet" onClick={() => act(() => inboxApi.channelAssign(thread.id, me))}>Assign to me</button>}
        <button type="button" className="abm-btn-quiet" onClick={() => act(async () => { await inboxApi.channelStatus(thread.id, archived ? "read" : "archived"); onClose(); })}>{archived ? "Move to inbox" : "Archive"}</button>
        <button type="button" className="abm-btn-quiet" onClick={() => act(async () => { await inboxApi.channelStatus(thread.id, "new"); onClose(); })}>Mark unread</button>
        <button type="button" className="abm-btn-quiet" aria-label="Close conversation" onClick={onClose}>Close</button>
      </header>
      {problem && <p className="abm-problem" role="alert">{problem}</p>}
      <div className="abm-side-body abi-thread-body" ref={box}>
        {messages === null && !problem && <div aria-label="Loading messages" role="status"><div className="abm-skeleton" /><div className="abm-skeleton" /></div>}
        {messages?.length === 0 && <p className="abm-list-note">No messages stored yet.</p>}
        {messages?.map((m) => (
          <div key={m.id} className={`abi-bubble abi-bubble-${m.direction}`}>
            <span className="abi-bubble-text">{m.body}</span>
            <small>{WHEN.format(new Date(m.created_at))}{FIRST_LOOK[m.status] ? ` · ${FIRST_LOOK[m.status]}` : ""}</small>
          </div>
        ))}
      </div>
      <div className="abi-reply">
        {canReply ? (
          <>
            <textarea className="abm-field" rows={2} maxLength={4096} aria-label={`Reply to ${name}`} placeholder="Write a reply" value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
            <button type="button" className="abm-btn" disabled={busy || !draft.trim()} onClick={send}>{busy ? "Sending…" : "Send"}</button>
          </>
        ) : <p className="abm-hint">This person last wrote over 24 hours ago, so the platform allows no free reply. They need to message you first.</p>}
      </div>
    </section>
  );
}
