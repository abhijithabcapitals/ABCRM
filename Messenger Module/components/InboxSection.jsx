import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import ChannelThread from "./ChannelThread.jsx";
import useChannelThreads from "./useChannelThreads.js";
import inboxApi from "../services/inboxClient.js";
import { openLink } from "../services/desktop.js";
import { CHANNELS, MAIL_WINDOW_DAYS, contactLabel, sandboxDoc, senderLabel, threadPeople } from "../logic/inbox.js";
import { formatBytes } from "../logic/parity.js";
import { rowTime } from "../logic/app.js";

const ReplyComposer = lazy(() => import("@ceo-agent/components/ReplyComposer.jsx"));
const SEARCH_WAIT_MS = 300;
const WHEN = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const when = (iso) => (iso ? WHEN.format(new Date(iso)) : "");

function ChannelOut({ channel, onSettings }) {
  return (
    <div className="abi-out">
      <h2>{channel.label}</h2>
      <p>{channel.note}</p>
      <div className="abi-out-actions">
        <a className="abm-btn abi-out-link" href={channel.href} target="_blank" rel="noopener noreferrer">Open {channel.label}</a>
        {onSettings && channel.key !== "linkedin" && <button type="button" className="abm-btn-quiet" onClick={onSettings}>Connect in Settings</button>}
      </div>
    </div>
  );
}

function MailMessage({ message, files, onFile }) {
  const text = (message.body_text || "").trim();
  return (
    <article className="abi-msg">
      <header>
        <strong>{senderLabel(message)}</strong>
        <small>{when(message.sent_at)}</small>
      </header>
      {message.to_addresses?.length > 0 && <p className="abi-msg-to">To: {message.to_addresses.join(", ")}{message.cc_addresses?.length > 0 && `; Cc: ${message.cc_addresses.join(", ")}`}</p>}
      {!message.body_complete && <p className="abm-hint">This message was too large to store in full. Read it on the mail server.</p>}
      {text
        ? <pre className="abi-body">{text}</pre>
        : message.body_html
          ? <iframe className="abi-html" title={`Message from ${senderLabel(message)}`} sandbox="" srcDoc={sandboxDoc(message.body_html)} />
          : <p className="abm-hint">This message has no text.</p>}
      {files.length > 0 && (
        <ul className="abi-files" aria-label="Attachments">
          {files.map((f) => (
            <li key={f.id}><button type="button" className="abm-btn-quiet" onClick={() => onFile(f)}>{f.filename || "Attachment"} ({formatBytes(f.size_bytes)})</button></li>
          ))}
        </ul>
      )}
    </article>
  );
}

function MailThread({ thread, people, onClose, onStatus }) {
  const [messages, setMessages] = useState(null);
  const [files, setFiles] = useState([]);
  const [earlier, setEarlier] = useState([]);
  const [problem, setProblem] = useState("");
  const [replying, setReplying] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await inboxApi.messages(thread.id);
      setMessages(list);
      setProblem("");
      setEarlier(await inboxApi.archivedMessages(thread.id).catch(() => []));
      setFiles(await inboxApi.attachments(list.filter((m) => m.attachment_count > 0).map((m) => m.id)).catch(() => []));
    } catch (e) {
      setProblem(e.message);
    }
  }, [thread.id]);
  useEffect(() => { const first = setTimeout(load, 0); return () => clearTimeout(first); }, [load]);

  const openFile = (f) => openLink(() => inboxApi.attachmentLink(f.storage_path, f.filename)).catch((e) => setProblem(e.message));
  const archived = thread.status === "archived";

  return (
    <section className="abi-thread" aria-label="Conversation">
      <header className="abi-thread-head">
        <div className="abi-thread-title">
          <strong title={thread.subject || ""}>{thread.subject || "(No subject)"}</strong>
          <small title={people}>{people}</small>
        </div>
        <button type="button" className="abm-btn" onClick={() => setReplying(true)}>Reply</button>
        <button type="button" className="abm-btn-quiet" onClick={() => onStatus(thread, archived ? "read" : "archived")}>{archived ? "Move to inbox" : "Archive"}</button>
        <button type="button" className="abm-btn-quiet" onClick={() => onStatus(thread, "new")}>Mark unread</button>
        <button type="button" className="abm-btn-quiet" aria-label="Close conversation" onClick={onClose}>Close</button>
      </header>
      {problem && <div className="abm-list-note" role="alert"><p>{problem}</p><button type="button" className="abm-btn" onClick={load}>Try again</button></div>}
      <div className="abm-side-body abi-thread-body">
        {!problem && messages === null && <div aria-label="Loading messages" role="status"><div className="abm-skeleton" /><div className="abm-skeleton" /></div>}
        {earlier.length > 0 && (
          <details className="abm-list-note">
            <summary>Earlier emails in this conversation ({earlier.length}), kept in SharePoint</summary>
            {earlier.map((m) => (
              <p key={m.id}>
                <strong>{m.from_name || m.from_address || "Unknown sender"}</strong> · {m.subject || "(No subject)"} · {when(m.sent_at)}{" "}
                {/^https:\/\//.test(m.eml_web_url || "") && <a href={m.eml_web_url} target="_blank" rel="noopener noreferrer">Open in SharePoint</a>}
              </p>
            ))}
          </details>
        )}
        {messages?.length === 0 && earlier.length === 0 && <p className="abm-list-note">This conversation has no stored messages.</p>}
        {messages?.map((m) => <MailMessage key={m.id} message={m} files={files.filter((f) => f.message_id === m.id)} onFile={openFile} />)}
      </div>
      {replying && (
        <Suspense fallback={null}>
          <ReplyComposer sb={inboxApi.composerClient} thread={thread} when={when} onClose={() => setReplying(false)} onSent={load} />
        </Suspense>
      )}
    </section>
  );
}

// One list for every channel. Email is live; the other channels say plainly what they can do today.
export default function InboxSection({ me, isAdmin, onCountChanged, onOpenSettings, initialChannel }) {
  const [channel, setChannel] = useState(initialChannel || "email");
  const [mailboxes, setMailboxes] = useState(null);
  const [mailboxId, setMailboxId] = useState("");
  const [archived, setArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [threads, setThreads] = useState(null);
  const [selected, setSelected] = useState(null);
  const [problem, setProblem] = useState("");
  const [accounts, setAccounts] = useState([]);
  const [picked, setPicked] = useState(null); // an open WhatsApp, Telegram or Instagram conversation, by id
  const connected = accounts.filter((a) => a.channel === channel);
  const live = useChannelThreads(channel, connected.length > 0);

  useEffect(() => {
    let on = true;
    inboxApi.channelAccounts().then((list) => { if (on) setAccounts(list); }, () => {});
    return () => { on = false; };
  }, []);

  const loadMailboxes = useCallback(async () => {
    try {
      setMailboxes(await inboxApi.mailboxes());
    } catch (e) {
      setProblem(e.message);
    }
  }, []);
  useEffect(() => { const first = setTimeout(loadMailboxes, 0); return () => clearTimeout(first); }, [loadMailboxes]);

  const load = useCallback(async () => {
    try {
      setThreads(await inboxApi.threads({ mailboxId, archived, query }));
      setProblem("");
    } catch (e) {
      setProblem(e.message);
    }
  }, [mailboxId, archived, query]);
  useEffect(() => {
    const timer = setTimeout(load, SEARCH_WAIT_MS);
    window.addEventListener("focus", load);
    return () => { clearTimeout(timer); window.removeEventListener("focus", load); };
  }, [load]);

  const addressOf = (id) => mailboxes?.find((m) => m.id === id)?.address;
  const patch = (id, change) => setThreads((list) => (list || []).map((t) => (t.id === id ? { ...t, ...change } : t)));

  async function open(thread) {
    setSelected(thread);
    if (thread.status !== "new") return;
    patch(thread.id, { status: "read" });
    try { await inboxApi.setStatus(thread.id, "read"); onCountChanged(); } catch { patch(thread.id, { status: "new" }); }
  }

  async function changeStatus(thread, status) {
    try {
      await inboxApi.setStatus(thread.id, status);
      setSelected(null);
      await load();
      onCountChanged();
    } catch (e) {
      setProblem(e.message);
    }
  }

  const out = CHANNELS.find((c) => c.key === channel && c.href);
  const liveThread = live.threads?.find((t) => t.id === picked) || null;
  const accountOf = (id) => accounts.find((a) => a.id === id);
  async function openLive(thread) {
    setPicked(thread.id);
    if (thread.status === "new") {
      await inboxApi.channelStatus(thread.id, "read").catch(() => {});
      live.reload();
      onCountChanged();
    }
  }
  const showLive = out && connected.length > 0;
  const failed = mailboxes?.filter((m) => m.last_error) || [];

  return (
    <div className={`abi${selected || (showLive && liveThread) ? " abi-open" : ""}${out && !showLive ? " abi-link-out" : ""}`}>
      <section className="abm-side abi-side" aria-label="Inbox">
        <header className="abm-side-head"><h2>Inbox</h2></header>
        <div className="abi-chips" role="group" aria-label="Channel">
          {CHANNELS.map((c) => (
            <button key={c.key} type="button" className="abi-chip" aria-pressed={channel === c.key} onClick={() => { setChannel(c.key); setSelected(null); setPicked(null); }}>{c.label}</button>
          ))}
        </div>
        {!out && (
          <div className="abi-filters">
            {mailboxes?.length > 1 && (
              <select className="abm-field" aria-label="Mailbox" value={mailboxId} onChange={(e) => { setMailboxId(e.target.value); setSelected(null); }}>
                <option value="">All mailboxes</option>
                {mailboxes.map((m) => <option key={m.id} value={m.id}>{m.address}</option>)}
              </select>
            )}
            <input type="search" className="abm-field" placeholder="Search subjects" aria-label="Search subjects" value={query} onChange={(e) => setQuery(e.target.value)} />
            <label className="abm-picker-row"><input type="checkbox" checked={archived} onChange={(e) => { setArchived(e.target.checked); setSelected(null); }} /><span>Show archived</span></label>
          </div>
        )}
        <div className="abm-side-body">
          {showLive && (
            <>
              {live.problem && <div className="abm-list-note" role="alert"><p>{live.problem}</p><button type="button" className="abm-btn" onClick={live.reload}>Try again</button></div>}
              {!live.problem && live.threads === null && <div aria-label="Loading conversations" role="status"><div className="abm-skeleton" /><div className="abm-skeleton" /></div>}
              {!live.problem && live.threads?.length === 0 && <p className="abm-list-note">No conversations yet. Messages will show here as they arrive.</p>}
              {!live.problem && live.threads?.length > 0 && (
                <ul className="abm-list">
                  {live.threads.map((t) => (
                    <li key={t.id}>
                      <button type="button" className={`abm-row abi-row${t.status === "new" ? " abi-row-new" : ""}${picked === t.id ? " abi-row-on" : ""}`} aria-current={picked === t.id ? "true" : undefined}
                        aria-label={`${t.status === "new" ? "Unread. " : ""}${contactLabel(t)}`} onClick={() => openLive(t)}>
                        <span className="abm-row-main">
                          <strong>{contactLabel(t)}</strong>
                          <span className="abi-row-subject">{t.last_preview}</span>
                          {connected.length > 1 && <span className="abm-row-sub">{accountOf(t.account_id)?.label}</span>}
                        </span>
                        <span className="abm-row-side">{rowTime(t.last_message_at)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {!out && (
            <>
              {problem && <div className="abm-list-note" role="alert"><p>{problem}</p><button type="button" className="abm-btn" onClick={() => { loadMailboxes(); load(); }}>Try again</button></div>}
              {failed.map((m) => <p key={m.id} className="abm-hint abi-warn" role="status">{m.address} has not synced lately, so new mail may be missing.</p>)}
              {!problem && (threads === null || mailboxes === null) && <div aria-label="Loading mail" role="status"><div className="abm-skeleton" /><div className="abm-skeleton" /><div className="abm-skeleton" /></div>}
              {!problem && mailboxes?.length === 0 && <p className="abm-list-note">No mailbox is available to you yet. An admin can give you access.</p>}
              {!problem && mailboxes?.length > 0 && threads?.length === 0 && <p className="abm-list-note">{query.trim() ? "No subject matches this search." : archived ? "Nothing archived." : `No mail in the last ${MAIL_WINDOW_DAYS} days.`}</p>}
              {!problem && mailboxes?.length > 0 && threads?.length > 0 && (
                <ul className="abm-list">
                  {threads.map((t) => (
                    <li key={t.id}>
                      <button type="button" className={`abm-row abi-row${t.status === "new" ? " abi-row-new" : ""}${selected?.id === t.id ? " abi-row-on" : ""}`} aria-current={selected?.id === t.id ? "true" : undefined}
                        aria-label={`${t.status === "new" ? "Unread. " : ""}${t.subject || "No subject"}, from ${threadPeople(t, addressOf(t.mailbox_id))}`} onClick={() => open(t)}>
                        <span className="abm-row-main">
                          <strong>{threadPeople(t, addressOf(t.mailbox_id))}</strong>
                          <span className="abi-row-subject">{t.subject || "(No subject)"}</span>
                          {mailboxes.length > 1 && <span className="abm-row-sub">{addressOf(t.mailbox_id)}</span>}
                        </span>
                        <span className="abm-row-side">{rowTime(t.last_message_at)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </section>
      {showLive
        ? liveThread
          ? <ChannelThread key={liveThread.id} thread={liveThread} account={accountOf(liveThread.account_id)} me={me} onClose={() => setPicked(null)} onChanged={() => { live.reload(); onCountChanged(); }} />
          : <p className="abm-pane-empty">Pick a conversation to read it here.</p>
        : out ? <ChannelOut channel={out} onSettings={isAdmin ? onOpenSettings : undefined} /> : selected
        ? <MailThread key={selected.id} thread={selected} people={threadPeople(selected, addressOf(selected.mailbox_id))} onClose={() => setSelected(null)} onStatus={changeStatus} />
        : <p className="abm-pane-empty">Pick a conversation to read it here.</p>}
    </div>
  );
}
