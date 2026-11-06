import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import chatApi from "../services/chatClient.js";
import { openLink } from "../services/desktop.js";
import { startCall } from "../services/callBus.js";
import { catchUp, chatTitle, dayKey, mergeMessage, personLeft, senderName, tickState, typingLabel } from "../logic/chat.js";
import { replyChange } from "../logic/teams.js";
import Composer from "./Composer.jsx";
import Message from "./Message.jsx";
import useTyping from "./useTyping.js";

const PAGE = 50;
const NEAR_BOTTOM = 80;
const DAY_LABEL = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", weekday: "short", day: "numeric", month: "short", year: "numeric" });

// Newest first from the service; the screen wants oldest first.
const oldestFirst = (list) => [...list].reverse();
const addAll = (cur, page) => oldestFirst(page).reduce((acc, m) => mergeMessage(acc, m), cur);

// Open chat. The panel gives it key={conversationId}, so every chat starts with clean state.
export default function Conversation({ row, profile, visible, connected, onMessage, reload, draft, onDraft, onClose, onInfo, attachSlot, status, onFlags, onArchive, noPin, threaded, onOpenThread, replyLabel, thread, topSlot, title, placeholder }) {
  const cid = row.id;
  const threadId = thread?.id;
  // A channel lists its top-level posts, a thread lists the replies to one post, and a chat lists everything.
  const loadPage = useCallback((opts) => {
    if (threaded) return chatApi.channelPosts(cid, opts);
    if (threadId) return chatApi.threadReplies(threadId, opts);
    return chatApi.messages(cid, opts);
  }, [cid, threaded, threadId]);
  const me = profile?.id;
  const [messages, setMessages] = useState([]);
  const latest = useRef([]); // the messages on screen, for catch-up to compare with
  latest.current = messages;
  const [members, setMembers] = useState([]);
  const [readAt, setReadAt] = useState(null);
  const [deliveredAt, setDeliveredAt] = useState(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [fresh, setFresh] = useState(false); // "New messages" while scrolled up
  const [replyTo, setReplyTo] = useState(null);
  const pendingFiles = useRef(new Map()); // files still being sent, by message id, so a retry can send them again
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
      const [page, state] = await Promise.all([loadPage({ limit: PAGE }), chatApi.receiptState(cid).catch(() => undefined)]);
      // A page with no message in common with the loaded ones means a gap: it replaces them.
      const { replaced } = catchUp(latest.current, page);
      const stick = first || replaced || atBottom();
      setMessages((cur) => catchUp(cur, page).messages);
      if (first || replaced) setHasMore(page.length === PAGE);
      loadMembers();
      if (state !== undefined) { setReadAt(state.read_at); setDeliveredAt(state.delivered_at); }
      if (stick) scrollTo.current = "bottom";
      setError("");
      setLoaded(true);
      markIfSeen();
    } catch {
      setError("Could not load messages. Please try again.");
    }
  }, [cid, loadPage, markIfSeen, loadMembers]);

  useEffect(() => { refresh(true); }, [cid, refresh]);

  // Ticks change as soon as someone else receives or reads. Channels have no ticks.
  const hasTicks = row.kind !== "channel" && !threadId;
  useEffect(() => {
    if (!hasTicks) return undefined;
    return chatApi.watchReceipts(cid, (changed) => {
      if (changed.profile_id === me) return;
      chatApi.receiptState(cid).then((state) => { setReadAt(state.read_at); setDeliveredAt(state.delivered_at); }, () => {});
    });
  }, [cid, me, hasTicks]);

  const typing = useTyping(cid, me, !threadId && !personLeft(row));

  // Live messages for this chat.
  useEffect(() => onMessage((m, change) => {
    if (m.conversation_id !== cid) return;
    if (!change && m.sender_id) typing.drop(m.sender_id);
    // A reply belongs in its thread; the channel only counts it.
    if (threaded && m.parent_id) {
      const step = replyChange(m, change);
      if (step) setMessages((cur) => cur.map((x) => (x.id === m.parent_id ? { ...x, reply_count: Math.max(0, (x.reply_count || 0) + step) } : x)));
      if (!change && m.sender_id !== me) markIfSeen();
      return;
    }
    if (threadId && m.parent_id !== threadId) return;
    // An edit, delete, reaction or file summary. Only messages already on screen change, and nobody is scrolled.
    if (change === "update") {
      setMessages((cur) => {
        const old = cur.find((x) => x.id === m.id);
        return old ? mergeMessage(cur, { ...old, ...m }) : cur;
      });
      return;
    }
    const stick = atBottom() || m.sender_id === me;
    setMessages((cur) => mergeMessage(cur, m));
    if (stick) scrollTo.current = "bottom"; else setFresh(true);
    if (m.sender_id !== me) markIfSeen();
    // Someone added to the group after it was opened is not in the member list yet.
    if (m.sender_id && !known.current.has(m.sender_id)) { known.current.add(m.sender_id); loadMembers(); }
  }), [cid, me, threaded, threadId, onMessage, markIfSeen, loadMembers, typing.drop]);

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
      const page = await loadPage({ before: messages[0].created_at, limit: PAGE });
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
      if (pendingFiles.current.has(m.id)) {
        await chatApi.sendFile({ id: m.id, conversationId: cid, file: pendingFiles.current.get(m.id), parentId: m.parent_id });
        pendingFiles.current.delete(m.id);
        // The live copy brings the stored file's id; a refresh covers a missed one.
        refresh(false);
      } else {
        await chatApi.send({ id: m.id, conversationId: cid, senderId: me, body: m.body, link, parentId: m.parent_id, mentionIds: m.mention_ids });
      }
      setStatus(m.id, undefined);
    } catch (e) {
      setStatus(m.id, "failed");
      // A file can fail for a reason worth saying: its type, its size, or storage not being set up.
      if (pendingFiles.current.has(m.id)) setError(e.message);
    }
  }

  function sendFile(file, parentId) {
    const m = { id: crypto.randomUUID(), conversation_id: cid, sender_id: me, body: file.name, parent_id: parentId ?? threadId, attachment: { name: file.name, size: file.size }, created_at: new Date().toISOString(), status: "sending" };
    pendingFiles.current.set(m.id, file);
    scrollTo.current = "bottom";
    setMessages((cur) => mergeMessage(cur, m));
    deliver(m);
  }

  const patchMessage = (id, change) => setMessages((cur) => cur.map((m) => (m.id === id ? { ...m, ...change } : m)));

  async function react(m, emoji) {
    try { patchMessage(m.id, { reactions: await chatApi.toggleReaction(m.id, emoji) }); } catch (e) { setError(e.message); }
  }

  // A failure comes back to the editor, which stays open with the text.
  async function saveEdit(m, body) {
    await chatApi.editMessage(m.id, body);
    patchMessage(m.id, { body, edited_at: new Date().toISOString() });
    reload();
  }

  async function remove(m) {
    try {
      await chatApi.deleteMessage(m.id);
      patchMessage(m.id, { deleted_at: new Date().toISOString(), body: "Message deleted", reactions: {}, attachment: null });
      if (replyTo?.id === m.id) setReplyTo(null);
      reload();
    } catch (e) { setError(e.message); }
  }

  const openFile = (id) => openLink(() => chatApi.fileLink(id)).catch((e) => setError(e.message));

  function send(body, link, extra = {}) {
    typing.notify(false);
    const m = { id: crypto.randomUUID(), conversation_id: cid, sender_id: me, body, parent_id: extra.parentId ?? threadId, mention_ids: extra.mentionIds, created_at: new Date().toISOString(), status: "sending" };
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
  const allNames = members.map((x) => x.full_name);
  const typingNow = typingLabel(typing.ids.map((id) => names.get(id)).filter(Boolean));
  const byId = new Map(messages.map((x) => [x.id, x]));
  const group = row.kind !== "direct";
  const channel = row.kind === "channel";
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
          tick={tickState(m, me, channel ? null : readAt, channel ? null : deliveredAt)} onRetry={() => retry(m)} me={me} names={allNames} parent={byId.get(m.parent_id)} noQuote={!!threadId}
          footer={threaded && <button type="button" className="msgr-reply-count" onClick={() => onOpenThread(m)}>{replyLabel(m.reply_count)}</button>}
          onReply={threadId ? undefined : threaded ? () => onOpenThread(m) : () => setReplyTo(m)} onReact={(emoji) => react(m, emoji)} onEdit={(body) => saveEdit(m, body)} onDelete={() => remove(m)} onOpenFile={openFile} />
      </div>
    );
  });

  return (
    <section className="msgr-chat-pane" aria-label="Conversation">
      <header className="msgr-pane-head">
        <span className="msgr-head-title">
          <strong>{title || chatTitle(row)}</strong>
          {typingNow ? <small className="msgr-typing">{typingNow}</small> : thread ? <small>In {chatTitle(row)}</small> : group ? <small>{row.team_name ? `${row.team_name} · ` : ""}{row.member_count} members</small> : status && <small>{status}</small>}
        </span>
        {!channel && !thread && !personLeft(row) && <button type="button" className="msgr-link msgr-flag" onClick={() => startCall({ conversationId: cid, media: "audio", title: chatTitle(row) })}>Call</button>}
        {!channel && !thread && !personLeft(row) && <button type="button" className="msgr-link msgr-flag" onClick={() => startCall({ conversationId: cid, media: "video", title: chatTitle(row) })}>Video</button>}
        {onFlags && !noPin && <button type="button" className="msgr-link msgr-flag" aria-pressed={!!row.pinned} onClick={() => onFlags({ pinned: !row.pinned })}>{row.pinned ? "Unpin" : "Pin"}</button>}
        {onFlags && <button type="button" className="msgr-link msgr-flag" aria-pressed={!!row.muted} onClick={() => onFlags({ muted: !row.muted })}>{row.muted ? "Unmute" : "Mute"}</button>}
        {onArchive && !channel && !thread && <button type="button" className="msgr-link msgr-flag" aria-pressed={!!row.archived} onClick={() => onArchive(!row.archived)}>{row.archived ? "Restore" : "Archive"}</button>}
        {group && onInfo && <button type="button" className="msgr-icon-btn" onClick={onInfo} aria-label="Group info">ⓘ</button>}
        <button type="button" className="msgr-close" onClick={onClose} aria-label={thread ? "Close thread" : channel ? "Close channel" : "Close chat"}>×</button>
      </header>
      {error && <p className="msgr-note">{error} <button type="button" className="msgr-link" onClick={() => refresh(!loaded)}>Retry</button></p>}
      <div className="msgr-messages" ref={box} onScroll={onScroll}>
        {topSlot}
        {loaded && !messages.length && !error && <p className="msgr-empty">{thread ? "No replies yet" : threaded ? "No posts yet. Start the conversation." : "No messages yet"}</p>}
        {items}
      </div>
      {fresh && <button type="button" className="msgr-fresh" onClick={() => { scrollTo.current = "bottom"; setMessages((c) => [...c]); }}>New messages</button>}
      {personLeft(row)
        ? <p className="msgr-note">This person has left</p>
        : <Composer conversationId={cid} onTyping={typing.notify} draft={draft} onDraft={onDraft} onSend={send} attachSlot={attachSlot} members={members} me={me} onFile={sendFile} placeholder={placeholder}
            replyTo={replyTo} replyName={replyTo ? (replyTo.sender_id === me ? "yourself" : senderName(names.get(replyTo.sender_id) ?? null)) : ""} onCancelReply={() => setReplyTo(null)} />}
    </section>
  );
}
