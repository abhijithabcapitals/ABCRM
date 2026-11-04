import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import chatApi from "../services/chatClient.js";
import { catchUp, chatTitle, dayKey, mergeMessage, personLeft, senderName, tickState } from "../logic/chat.js";
import Composer from "./Composer.jsx";
import Message from "./Message.jsx";

const PAGE = 50;
const NEAR_BOTTOM = 80;
const DAY_LABEL = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", weekday: "short", day: "numeric", month: "short", year: "numeric" });

// Newest first from the service; the screen wants oldest first.
const oldestFirst = (list) => [...list].reverse();
const addAll = (cur, page) => oldestFirst(page).reduce((acc, m) => mergeMessage(acc, m), cur);

// Open chat. The panel gives it key={conversationId}, so every chat starts with clean state.
export default function Conversation({ row, profile, visible, connected, onMessage, reload, draft, onDraft, onClose, onInfo, attachSlot }) {
  const cid = row.id;
  const me = profile?.id;
  const [messages, setMessages] = useState([]);
  const latest = useRef([]); // the messages on screen, for catch-up to compare with
  latest.current = messages;
  const [members, setMembers] = useState([]);
  const [readAt, setReadAt] = useState(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [fresh, setFresh] = useState(false); // "New messages" while scrolled up
  const box = useRef(null);
  const scrollTo = useRef(null); // "bottom", or the scroll height from before older messages were added
  const busy = useRef(false);
  const seen = useRef(visible);
  seen.current = visible;
  const shown = useRef(visible); // last seen value of visible, to spot the panel being reopened
  const known = useRef(new Set()); // senders already looked up, so one unknown sender is fetched once

  const atBottom = () => !box.current || box.current.scrollHeight - box.current.scrollTop - box.current.clientHeight < NEAR_BOTTOM;

  // Marks read only while the person can actually see the chat; the list is reloaded so its count clears.
  const markIfSeen = useCallback(() => {
    if (!seen.current || document.visibilityState !== "visible") return;
    chatApi.markRead(cid).then(reload, () => {});
  }, [cid, reload]);

  const loadMembers = useCallback(() => chatApi.members(cid).then((list) => {
    list.forEach((x) => known.current.add(x.profile_id));
    setMembers(list);
  }, () => {}), [cid]);

  // Newest page and the other members' reading state. Used on opening and on catch-up.
  const refresh = useCallback(async (first) => {
    try {
      const [page, state] = await Promise.all([chatApi.messages(cid, { limit: PAGE }), chatApi.readState(cid).catch(() => undefined)]);
      // A page with no message in common with the loaded ones means a gap: it replaces them.
      const { replaced } = catchUp(latest.current, page);
      const stick = first || replaced || atBottom();
      setMessages((cur) => catchUp(cur, page).messages);
      if (first || replaced) setHasMore(page.length === PAGE);
      loadMembers();
      if (state !== undefined) setReadAt(state);
      if (stick) scrollTo.current = "bottom";
      setError("");
      setLoaded(true);
      markIfSeen();
    } catch {
      setError("Could not load messages. Please try again.");
    }
  }, [cid, markIfSeen, loadMembers]);

  useEffect(() => { refresh(true); }, [cid, refresh]);

  // Live messages for this chat.
  useEffect(() => onMessage((m) => {
    if (m.conversation_id !== cid) return;
    const stick = atBottom() || m.sender_id === me;
    setMessages((cur) => mergeMessage(cur, m));
    if (stick) scrollTo.current = "bottom"; else setFresh(true);
    if (m.sender_id !== me) markIfSeen();
    // Someone added to the group after it was opened is not in the member list yet.
    if (m.sender_id && !known.current.has(m.sender_id)) { known.current.add(m.sender_id); loadMembers(); }
  }), [cid, me, onMessage, markIfSeen, loadMembers]);

  // Catch-up: the channel came back, the panel was opened again, or the window got focus.
  const was = useRef({ connected, visible });
  useEffect(() => {
    if ((connected && !was.current.connected) || (visible && !was.current.visible)) refresh(false);
    was.current = { connected, visible };
  }, [connected, visible, refresh]);
  useEffect(() => {
    const onFocus = () => { if (seen.current) refresh(false); };
    const onShow = () => { if (document.visibilityState === "visible") markIfSeen(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onShow);
    return () => { window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onShow); };
  }, [refresh, markIfSeen]);
  useEffect(() => { if (loaded) markIfSeen(); }, [visible, loaded, markIfSeen]);

  // Scroll after the list has rendered: to the end, or back to where the person was before older messages arrived.
  useLayoutEffect(() => {
    const el = box.current;
    // A hidden panel can lose its scroll position; reopening lands on the newest message.
    if (visible && !shown.current) scrollTo.current = "bottom";
    shown.current = visible;
    if (!el || scrollTo.current == null) return;
    el.scrollTop = scrollTo.current === "bottom" ? el.scrollHeight : el.scrollHeight - scrollTo.current;
    if (scrollTo.current === "bottom") setFresh(false);
    scrollTo.current = null;
  }, [messages, visible]);

  async function older() {
    if (busy.current || !seen.current || !hasMore || !messages.length) return;
    busy.current = true;
    try {
      const page = await chatApi.messages(cid, { before: messages[0].created_at, limit: PAGE });
      scrollTo.current = box.current.scrollHeight;
      setMessages((cur) => addAll(cur, page));
      setHasMore(page.length === PAGE);
    } catch {
      setError("Could not load messages. Please try again.");
    } finally {
      busy.current = false;
    }
  }

  function onScroll() {
    if (box.current.scrollTop < 40) older();
    if (atBottom()) setFresh(false);
  }

  const setStatus = (id, status) => setMessages((cur) => cur.map((m) => (m.id === id ? { ...m, status } : m)));

  // The same id is used for every attempt, so a retry cannot deliver the message twice.
  async function deliver(m) {
    const link = m.link_type ? { type: m.link_type, ref: m.link_ref, label: m.link_label } : undefined;
    try {
      await chatApi.send({ id: m.id, conversationId: cid, senderId: me, body: m.body, link });
      setStatus(m.id, undefined);
    } catch {
      setStatus(m.id, "failed");
    }
  }

  function send(body, link) {
    const m = { id: crypto.randomUUID(), conversation_id: cid, sender_id: me, body, created_at: new Date().toISOString(), status: "sending" };
    if (link) Object.assign(m, { link_type: link.type, link_ref: link.ref, link_label: link.label });
    scrollTo.current = "bottom";
    setMessages((cur) => mergeMessage(cur, m));
    deliver(m);
  }

  function retry(m) {
    setStatus(m.id, "sending");
    deliver(m);
  }

  const names = new Map(members.map((x) => [x.profile_id, x.full_name]));
  const group = row.kind === "group";
  let lastDay = null;
  let lastSender = null;
  const items = messages.map((m) => {
    const day = dayKey(m.created_at);
    const showDay = day !== lastDay;
    const showName = group && m.sender_id !== me && (showDay || m.sender_id !== lastSender);
    lastDay = day;
    lastSender = m.sender_id;
    return (
      <div key={m.id}>
        {showDay && <div className="msgr-day">{DAY_LABEL.format(new Date(m.created_at))}</div>}
        <Message message={m} mine={m.sender_id === me} name={showName ? senderName(names.get(m.sender_id) ?? null) : ""}
          tick={tickState(m, me, readAt)} onRetry={() => retry(m)} />
      </div>
    );
  });

  return (
    <section className="msgr-chat-pane" aria-label="Conversation">
      <header className="msgr-pane-head">
        <span className="msgr-head-title">
          <strong>{chatTitle(row)}</strong>
          {group && <small>{row.member_count} members</small>}
        </span>
        {group && <button type="button" className="msgr-icon-btn" onClick={onInfo} aria-label="Group info">ⓘ</button>}
        <button type="button" className="msgr-close" onClick={onClose} aria-label="Close chat">×</button>
      </header>
      {error && <p className="msgr-note">{error} <button type="button" className="msgr-link" onClick={() => refresh(!loaded)}>Retry</button></p>}
      <div className="msgr-messages" ref={box} onScroll={onScroll}>
        {loaded && !messages.length && !error && <p className="msgr-empty">No messages yet</p>}
        {items}
      </div>
      {fresh && <button type="button" className="msgr-fresh" onClick={() => { scrollTo.current = "bottom"; setMessages((c) => [...c]); }}>New messages</button>}
      {personLeft(row)
        ? <p className="msgr-note">This person has left</p>
        : <Composer conversationId={cid} draft={draft} onDraft={onDraft} onSend={send} attachSlot={attachSlot} />}
    </section>
  );
}
