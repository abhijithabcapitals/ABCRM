import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AiAssistWindow from "./AiAssistWindow.jsx";
import ReplyComposer from "./ReplyComposer.jsx";

// Inbox view of the CEO Agent: every conversation of the connected mailboxes
// (Email Base in the CRM Project: email_base.threads of the mailboxes tagged
// 'ceo', written by the ceo-mail-sync Edge Function from all IMAP folders). The
// mailbox itself is read-only; this view can search the whole store, open the
// original messages with attachments, mark threads important, save facts,
// review unsent reply drafts, and turn a suggested action into a task or reminder.

const FILTERS = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "important", label: "Important" },
  { id: "reply", label: "Needs reply" },
  { id: "urgent", label: "Urgent" },
  { id: "sent", label: "Sent" },
  { id: "archived", label: "Archived" },
];
const MAILBOX_COLORS = [
  { bg: "#e6f4f3", fg: "#0b6b70", border: "#99d5d2" },
  { bg: "#eef0ff", fg: "#3a43a8", border: "#c3c8f5" },
  { bg: "#fff4e5", fg: "#9a5b00", border: "#f5d39a" },
  { bg: "#fde8f1", fg: "#a3245e", border: "#f3b8d1" },
];
const POLL_MS = 2 * 60 * 1000;
const PAGE_SIZE = 50;
const BUCKET = "email-base";
const THREAD_COLUMNS = "id, mailbox_id, subject, participants, last_message_at, message_count, status, category, priority, needs_reply, is_important, summary, key_points, suggested_actions, folders";
const MESSAGE_COLUMNS = "id, folder, direction, from_address, from_name, to_addresses, cc_addresses, subject, sent_at, body_text, body_complete, parse_error, attachment_count, raw_path";

const fileSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// Unread count for the tab badge, plus an optional browser alert when a new
// urgent or needs-reply conversation arrives while the CRM is open.
// Mailboxes the user switched off in the Inbox settings (ceo.inbox_preferences); they keep syncing.
async function fetchHiddenMailboxes(sb) {
  const { data } = await sb.from("inbox_preferences").select("hidden_mailbox_ids").maybeSingle();
  return data?.hidden_mailbox_ids || [];
}

// Leaves the switched-off mailboxes out of a threads query.
const withoutHidden = (q, hidden) => (hidden.length ? q.not("mailbox_id", "in", `(${hidden.join(",")})`) : q);

export function useInboxAlerts(sb) {
  const [unread, setUnread] = useState(0);
  const seenRef = useRef(null);

  const check = useCallback(async () => {
    const hidden = await fetchHiddenMailboxes(sb);
    const { data, error } = await withoutHidden(sb.schema("email_base").from("threads")
      .select("id, subject, priority, needs_reply").contains("tags", ["ceo"]).eq("status", "new"), hidden).limit(200);
    if (error) return;
    setUnread(data.length);
    const important = data.filter((t) => t.priority === "urgent" || t.needs_reply);
    if (seenRef.current && typeof Notification !== "undefined" && Notification.permission === "granted") {
      const fresh = important.filter((t) => !seenRef.current.has(t.id));
      if (fresh.length) {
        new Notification(fresh.length === 1 ? "New important email" : `${fresh.length} new important emails`, {
          body: fresh.slice(0, 3).map((t) => t.subject || "(no subject)").join("\n"),
          tag: "ceo-inbox",
        });
      }
    }
    seenRef.current = new Set(important.map((t) => t.id));
  }, [sb]);

  useEffect(() => {
    check();
    const id = setInterval(check, POLL_MS);
    return () => clearInterval(id);
  }, [check]);

  return { unread, refresh: check };
}

export default function InboxPanel({ sb, timezone, userId, refreshKey, onChanged }) {
  const [account, setAccount] = useState(undefined);
  const [folders, setFolders] = useState([]);
  const [threads, setThreads] = useState(null);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [query, setQuery] = useState("");
  const [searchIds, setSearchIds] = useState(null);
  const [searching, setSearching] = useState(false);
  const [messagesByThread, setMessagesByThread] = useState({});
  const [attachmentsByMessage, setAttachmentsByMessage] = useState({});
  const [loadingMessages, setLoadingMessages] = useState(null);
  const [savedFacts, setSavedFacts] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [draftEdits, setDraftEdits] = useState({});
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(null);
  const [replying, setReplying] = useState(null);
  const [expanded, setExpanded] = useState({}); // message id -> shown in full (the latest is shown by default)
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [hidden, setHidden] = useState([]); // mailbox ids switched off in the Inbox settings
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [alerts, setAlerts] = useState(() => (typeof Notification === "undefined" ? "unsupported" : Notification.permission));

  // Conversations are filtered and paged in the database, so every stored email is reachable.
  const threadQuery = useCallback((sentFolders, hiddenIds, from, to) => {
    let q = withoutHidden(sb.schema("email_base").from("threads").select(THREAD_COLUMNS, { count: "exact" }).contains("tags", ["ceo"]), hiddenIds);
    q = filter === "archived" ? q.eq("status", "archived") : q.neq("status", "archived");
    if (filter === "unread") q = q.eq("status", "new");
    if (filter === "important") q = q.eq("is_important", true);
    if (filter === "reply") q = q.eq("needs_reply", true);
    if (filter === "urgent") q = q.in("priority", ["urgent", "high"]);
    if (filter === "sent") q = q.overlaps("folders", sentFolders.length ? sentFolders : ["-"]);
    if (searchIds) q = q.in("id", searchIds.length ? searchIds : ["00000000-0000-0000-0000-000000000000"]);
    return q.order("last_message_at", { ascending: false }).range(from, to);
  }, [sb, filter, searchIds]);

  const load = useCallback(async () => {
    const [acc, folderList, facts, pendingDrafts, hiddenIds] = await Promise.all([
      sb.schema("email_base").from("mailboxes").select("id, address, status, last_synced_at, last_error").contains("tags", ["ceo"]).order("address"),
      sb.schema("email_base").from("mailbox_folders").select("id, mailbox_id, name, role, enabled, last_uid, message_total, last_synced_at, last_error").order("name"),
      sb.from("email_saved_facts").select("id, thread_id, subject, fact, created_at").order("created_at", { ascending: false }).limit(100),
      sb.from("email_drafts").select("id, thread_id, to_address, subject, body, status, created_at")
        .in("status", ["draft", "approved"]).order("created_at", { ascending: false }).limit(50),
      fetchHiddenMailboxes(sb),
    ]);
    const sentFolders = [...new Set((folderList.data || []).filter((f) => f.role === "sent").map((f) => f.name))];
    const list = await threadQuery(sentFolders, hiddenIds, 0, pages * PAGE_SIZE - 1);
    const firstError = [acc, folderList, list, facts, pendingDrafts].find((result) => result.error)?.error;
    if (firstError) { setError(firstError.message); return; }
    setError("");
    setAccount(acc.data || []);
    setHidden(hiddenIds);
    setFolders(folderList.data || []);
    setThreads(list.data || []);
    setTotal(list.count ?? (list.data || []).length);
    setSavedFacts(facts.data || []);
    setDrafts(pendingDrafts.data || []);
  }, [sb, threadQuery, pages]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // Search covers message bodies, subjects and senders, and the AI summaries.
  async function runSearch(e) {
    e?.preventDefault();
    const term = query.trim();
    setPages(1);
    if (!term) { setSearchIds(null); return; }
    setSearching(true);
    const safe = term.replace(/[,()*%"\\]/g, " ").trim();
    // A fresh query builder per request: builders share their URL and must not be reused.
    const mail = () => sb.schema("email_base").from("messages");
    const [body, meta, summaries] = await Promise.all([
      mail().select("thread_id").textSearch("body_search_vector", term, { type: "websearch", config: "english" }).limit(150),
      safe ? mail().select("thread_id").or(`subject.ilike."*${safe}*",from_address.ilike."*${safe}*",from_name.ilike."*${safe}*"`).limit(150) : { data: [] },
      sb.schema("email_base").from("threads").select("id").contains("tags", ["ceo"])
        .textSearch("assistant_search_vector", term, { type: "websearch", config: "english" }).limit(150),
    ]);
    setSearching(false);
    const failed = [body, meta, summaries].find((r) => r.error)?.error;
    if (failed) { setError(`Search failed: ${failed.message}`); return; }
    setSearchIds([...new Set([
      ...(summaries.data || []).map((t) => t.id),
      ...(meta.data || []).map((m) => m.thread_id),
      ...(body.data || []).map((m) => m.thread_id),
    ])].slice(0, 200));
  }

  function clearSearch() {
    setQuery("");
    setSearchIds(null);
    setPages(1);
  }

  async function download(path, filename) {
    setError("");
    const { data, error: err } = await sb.storage.from(BUCKET).createSignedUrl(path, 120, { download: filename || true });
    if (err) { setError(`Could not open the file: ${err.message}`); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  const fmt = useMemo(() => new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }), [timezone]);
  const when = (v) => (v ? fmt.format(new Date(v)) : "");

  // Chronological: newest conversation first. The filter is applied in the database.
  const shown = useMemo(() => [...(threads || [])].sort((a, b) =>
    String(b.last_message_at).localeCompare(String(a.last_message_at))), [threads]);

  // Each mailbox keeps one colour, so its bubble identifies the email account at a glance.
  const mailboxColor = useCallback((mailboxId) => {
    const index = (account || []).findIndex((a) => a.id === mailboxId);
    return MAILBOX_COLORS[(index < 0 ? 0 : index) % MAILBOX_COLORS.length];
  }, [account]);
  const mailboxBubble = (mailboxId) => {
    const address = account?.find((a) => a.id === mailboxId)?.address;
    if (!address) return null;
    const c = mailboxColor(mailboxId);
    return <span className="ceo-mailbox-bubble" style={{ background: c.bg, color: c.fg, borderColor: c.border }}>{address}</span>;
  };

  async function syncNow() {
    setSyncing(true);
    setNotice("");
    setError("");
    const { data, error: fnError } = await sb.functions.invoke("ceo-mail-sync", { body: {} });
    setSyncing(false);
    let message = data?.error;
    if (fnError) {
      try { message = (await fnError.context?.json())?.error || fnError.message; } catch { message = fnError.message; }
    }
    // One result per connected mailbox.
    const results = data?.results || [];
    const failed = results.filter((r) => r.error);
    const read = results.reduce((n, r) => n + (r.fetched || 0), 0);
    if (message) setError(message);
    else if (failed.length) setError(failed.map((r) => `${r.address}: ${r.error}`).join(" "));
    const remaining = results.reduce((n, r) => n + (r.remaining || 0), 0);
    if (!message && results.length > failed.length) {
      setNotice(read ? `Stored ${read} email(s) across ${results.length} mailbox(es).${remaining ? ` ${remaining} more are queued for the next runs.` : ""}`
        : results.some((r) => r.skipped) ? "A sync is already running." : "No new email.");
    }
    onChanged?.();
  }

  async function setStatus(id, status) {
    const { error: err } = await sb.schema("email_base").from("threads").update({ status }).eq("id", id);
    if (err) { setError(err.message); return; }
    setThreads((list) => (list || [])
      .map((t) => (t.id === id ? { ...t, status } : t))
      .filter((t) => (filter === "archived") === (t.status === "archived")));
    onChanged?.();
  }

  async function setImportant(thread, isImportant) {
    setError("");
    const { error: err } = await sb.schema("email_base").from("threads").update({ is_important: isImportant }).eq("id", thread.id);
    if (err) { setError(err.message); return; }
    setThreads((list) => (list || []).map((t) => t.id === thread.id ? { ...t, is_important: isImportant } : t));
    setNotice(isImportant ? "Marked important in the CRM inbox." : "Removed the important marker.");
    onChanged?.();
  }

  async function saveFact(thread, fact) {
    setError("");
    const { data, error: err } = await sb.from("email_saved_facts")
      .insert({ user_id: userId, thread_id: thread.id, subject: thread.subject || "(no subject)", fact })
      .select("id, thread_id, subject, fact, created_at").single();
    if (err?.code === "23505") {
      setNotice("That fact is already saved to CEO memory.");
      return;
    }
    if (err) { setError(err.message); return; }
    setSavedFacts((list) => [data, ...list]);
    setNotice("Saved this email fact to searchable CEO memory.");
    onChanged?.();
  }

  async function saveDraft(draft) {
    const body = draftEdits[draft.id] ?? draft.body;
    if (!body.trim()) { setError("A reply draft cannot be empty."); return; }
    const { error: err } = await sb.from("email_drafts").update({ body }).eq("id", draft.id);
    if (err) { setError(err.message); return; }
    setDrafts((list) => list.map((item) => item.id === draft.id ? { ...item, body } : item));
    setDraftEdits((edits) => ({ ...edits, [draft.id]: body }));
    setNotice("Draft changes saved. The email has not been sent.");
  }

  async function approveDraft(draft) {
    if (!window.confirm("Approve this draft? It will remain unsent; you must send it yourself outside this agent.")) return;
    const body = draftEdits[draft.id] ?? draft.body;
    if (!body.trim()) { setError("A reply draft cannot be empty."); return; }
    const { error: err } = await sb.from("email_drafts").update({ body, status: "approved" }).eq("id", draft.id);
    if (err) { setError(err.message); return; }
    setDrafts((list) => list.map((item) => item.id === draft.id ? { ...item, body, status: "approved" } : item));
    setNotice("Draft approved and kept unsent. Copy it to your mail client when you are ready to send.");
  }

  async function cancelDraft(draft) {
    if (!window.confirm("Cancel and remove this reply draft from the review list?")) return;
    const { error: err } = await sb.from("email_drafts").update({ status: "cancelled" }).eq("id", draft.id);
    if (err) { setError(err.message); return; }
    setDrafts((list) => list.filter((item) => item.id !== draft.id));
    setNotice("Reply draft cancelled.");
  }

  // A conversation opens as its own page, like Gmail. The browser Back button returns to the list.
  const pushedRef = useRef(false);
  useEffect(() => {
    const onPop = () => {
      if (!pushedRef.current) return;
      pushedRef.current = false;
      setOpen(null);
      setReplying(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // While a conversation is open the page behind it does not scroll, and Escape closes it
  // (not while a reply is being written, so a draft is never lost by accident).
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape" && !replying) closeThread(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
    // closeThread only reads refs and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, replying]);

  function closeThread() {
    if (pushedRef.current) { window.history.back(); return; }
    setOpen(null);
    setReplying(null);
  }

  function openThread(t) {
    setOpen(t.id);
    setReplying(null);
    setExpanded({});
    if (!pushedRef.current) {
      window.history.pushState({ ceoInboxThread: t.id }, "");
      pushedRef.current = true;
    }
    window.scrollTo({ top: 0 });
    if (t.status === "new") setStatus(t.id, "read");
    if (messagesByThread[t.id] || loadingMessages === t.id) return;
    setLoadingMessages(t.id);
    sb.schema("email_base").from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("thread_id", t.id).order("sent_at", { ascending: true }).limit(1000)
      .then(async ({ data, error: messageError }) => {
        if (messageError) { setError(`Could not load email messages: ${messageError.message}`); return; }
        setMessagesByThread((messages) => ({ ...messages, [t.id]: data || [] }));
        const withFiles = (data || []).filter((m) => m.attachment_count > 0).map((m) => m.id);
        if (!withFiles.length) return;
        const { data: files, error: fileError } = await sb.schema("email_base").from("attachments")
          .select("id, message_id, position, filename, content_type, size_bytes, storage_path").in("message_id", withFiles).order("position");
        if (fileError) { setError(`Could not load attachments: ${fileError.message}`); return; }
        const grouped = {};
        for (const f of files || []) (grouped[f.message_id] ||= []).push(f);
        setAttachmentsByMessage((all) => ({ ...all, ...grouped }));
      })
      .catch((messageError) => setError(`Could not load email messages: ${messageError.message || String(messageError)}`))
      .finally(() => setLoadingMessages(null));
  }

  // A suggested action becomes a reminder (when it has a date) or a task.
  async function addAction(thread, action) {
    setError("");
    const title = action.type === "reply" ? `Reply: ${thread.subject || action.title}` : action.title;
    if (action.type === "reminder" && action.due) {
      const { error: err } = await sb.from("reminders")
        .insert({ user_id: userId, title, body: thread.summary, scheduled_at: action.due, timezone, channel: "in_app" });
      if (err) { setError(err.message); return; }
    } else {
      const { data: rec, error: recErr } = await sb.from("records")
        .insert({ user_id: userId, record_type: "task", title, summary: thread.summary, attributes: { source: "ceo-mail", thread_id: thread.id } })
        .select("id").single();
      if (recErr) { setError(recErr.message); return; }
      const { error: err } = await sb.from("tasks")
        .insert({ user_id: userId, record_id: rec.id, title, description: thread.summary, due_at: action.due, priority: thread.priority === "urgent" ? "urgent" : "normal" });
      if (err) {
        await sb.from("records").delete().eq("id", rec.id);
        setError(err.message);
        return;
      }
    }
    setNotice(`Added "${title}" to your ${action.type === "reminder" && action.due ? "reminders" : "tasks"}.`);
    onChanged?.();
  }

  async function toggleMailbox(id) {
    const next = hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id];
    const { error: err } = await sb.from("inbox_preferences")
      .upsert({ user_id: userId, hidden_mailbox_ids: next, updated_at: new Date().toISOString() });
    if (err) { setError(`Could not save the Inbox setting: ${err.message}`); return; }
    setHidden(next);
    setPages(1);
    onChanged?.();
  }

  async function enableAlerts() {
    if (typeof Notification === "undefined") return;
    setAlerts(await Notification.requestPermission());
  }

  if (account === undefined && !error) return <section className="ceo-dash"><p className="ceo-muted">Loading inbox…</p></section>;
  if (!account?.length && !error) {
    return (
      <section className="ceo-dash">
        <div className="ceo-panel"><h3>Inbox</h3><p className="ceo-panel-empty">No mailbox is connected to this CEO workspace.</p></div>
      </section>
    );
  }

  const current = open ? (threads || []).find((x) => x.id === open) : null;
  let threadPopup = null;
  if (current) {
    const t = current;
    const messages = messagesByThread[t.id] || [];
    const lastIndex = messages.length - 1;
    const leaveWith = async (status) => { await setStatus(t.id, status); closeThread(); };
    threadPopup = (
      <div className="ceo-mail-overlay" role="presentation"
        onMouseDown={(e) => { if (e.target === e.currentTarget && replying !== t.id) closeThread(); }}>
      <section className="ceo-mail-window" role="dialog" aria-modal="true" aria-label="Email conversation">
        <div className="ceo-thread-toolbar">
          <button type="button" className="ceo-text-btn ceo-back" onClick={closeThread}>✕ Close</button>
          <span className="ceo-thread-tools">
            <button className="ceo-text-btn" type="button" onClick={() => setImportant(t, !t.is_important)}>
              {t.is_important ? "Unmark important" : "Mark important"}
            </button>
            <button className="ceo-text-btn" type="button" onClick={() => leaveWith("new")}>Mark unread</button>
            {t.status === "archived"
              ? <button className="ceo-text-btn" type="button" onClick={() => leaveWith("read")}>Unarchive</button>
              : <button className="ceo-text-btn" type="button" onClick={() => leaveWith("archived")}>Archive</button>}
          </span>
        </div>
        {error && <p className="ceo-notice ceo-error" role="alert">{error}</p>}
        {notice && <p className="ceo-notice ceo-ok" role="status">{notice}</p>}

        <header className="ceo-thread-head">
          <h2>{t.subject || "(no subject)"}</h2>
          <div className="ceo-thread-tags">
            {mailboxBubble(t.mailbox_id)}
            {t.category && <span className="ceo-tag">{t.category}</span>}
            {t.is_important && <span className="ceo-tag ceo-tag-important">important</span>}
            {t.needs_reply && <span className="ceo-tag ceo-tag-reply">needs reply</span>}
            <span className="ceo-muted">{t.message_count} email{t.message_count === 1 ? "" : "s"}</span>
          </div>
        </header>

        <div className="ceo-thread-layout">
          <div className="ceo-thread-messages">
            {loadingMessages === t.id && <p className="ceo-muted">Loading messages…</p>}
            {messages.map((message, index) => {
              const full = expanded[message.id] ?? index === lastIndex;
              const name = message.from_name || message.from_address || "Unknown sender";
              return (
                <article key={message.id} className={`ceo-msg ${full ? "ceo-msg-open" : ""}`}>
                  <button type="button" className="ceo-msg-head" aria-expanded={full}
                    onClick={() => setExpanded((all) => ({ ...all, [message.id]: !full }))}>
                    <span className="ceo-avatar" aria-hidden="true">{name.trim().charAt(0).toUpperCase()}</span>
                    <span className="ceo-msg-who">
                      <span>
                        <b>{name}</b>
                        {message.direction === "outbound" && <span className="ceo-tag ceo-tag-sent">sent</span>}
                        {message.folder && message.folder.toUpperCase() !== "INBOX" && <span className="ceo-tag ceo-tag-folder">{message.folder.replace(/^INBOX[./]/i, "")}</span>}
                      </span>
                      <small>{full ? `<${message.from_address || ""}>` : (message.body_text || "").replace(/\s+/g, " ").slice(0, 140)}</small>
                    </span>
                    <span className="ceo-msg-date">{when(message.sent_at)}</span>
                  </button>
                  {full && (
                    <div className="ceo-msg-body">
                      <div className="ceo-muted">To: {(message.to_addresses || []).join(", ") || "Not available"}</div>
                      {message.cc_addresses?.length > 0 && <div className="ceo-muted">Cc: {message.cc_addresses.join(", ")}</div>}
                      {message.body_complete === false && message.parse_error && <div className="ceo-mail-warning">{message.parse_error}</div>}
                      <pre>{message.body_text || "(No text body)"}</pre>
                      {(attachmentsByMessage[message.id] || []).length > 0 && (
                        <div className="ceo-attachments">
                          {attachmentsByMessage[message.id].map((f) => (
                            <button key={f.id} type="button" className="ceo-chip" onClick={() => download(f.storage_path, f.filename)}>
                              📎 {f.filename || "attachment"} · {fileSize(f.size_bytes)}
                            </button>
                          ))}
                        </div>
                      )}
                      {message.raw_path && (
                        <button type="button" className="ceo-text-btn ceo-eml" onClick={() => download(message.raw_path, "message.eml")}>
                          Download original (.eml)
                        </button>
                      )}
                    </div>
                  )}
                </article>
              );
            })}

            {replying === t.id ? (
              <ReplyComposer sb={sb} thread={t} when={when} onClose={() => setReplying(null)}
                onSent={() => { setThreads((list) => (list || []).map((x) => (x.id === t.id ? { ...x, needs_reply: false, status: "read" } : x))); onChanged?.(); }} />
            ) : (
              <div className="ceo-thread-reply">
                <button className="btn btn-primary" type="button" onClick={() => setReplying(t.id)}>↩ Reply</button>
              </div>
            )}
          </div>

        </div>
      </section>
      <AiAssistWindow sb={sb} thread={t} when={when} savedFacts={savedFacts} onSaveFact={saveFact} onAddAction={addAction} />
      </div>
    );
  }

  return (
    <section className="ceo-dash ceo-inbox" aria-label="Email summaries">
      <InboxStyles />
      <div className="ceo-inbox-head">
        <div>
          {account?.filter((a) => !hidden.includes(a.id)).map((a) => {
            const synced = folders.filter((f) => f.mailbox_id === a.id && f.enabled);
            return (
              <div key={a.id} className="ceo-mailbox-line">
                {mailboxBubble(a.id)}
                <span>
                  {a.status === "syncing" ? "Syncing…"
                    : a.last_synced_at ? `Last checked ${when(a.last_synced_at)}`
                      : "Not synced yet"}
                  {synced.length > 0 && ` · ${synced.map((f) => f.name.replace(/^INBOX[./]/i, "")).join(", ")}`}
                </span>
              </div>
            );
          })}
          <span>Checks every 5 minutes · {total} conversation(s){searchIds ? " match the search" : ""}</span>
        </div>
        <div className="ceo-inbox-tools">
          {alerts === "default" && <button className="ceo-text-btn" type="button" onClick={enableAlerts}>Enable alerts</button>}
          <button className="btn btn-primary" type="button" onClick={syncNow} disabled={syncing}>{syncing ? "Checking…" : "Sync now"}</button>
          <span className="ceo-gear-wrap">
            <button type="button" className="ceo-gear" onClick={() => setSettingsOpen((o) => !o)} aria-expanded={settingsOpen}
              title="Inbox settings" aria-label="Inbox settings">⚙</button>
            {settingsOpen && (
              <div className="ceo-gear-panel" role="dialog" aria-label="Mailboxes shown in the Inbox">
                <b>Show in Inbox</b>
                {(account || []).map((a) => (
                  <label key={a.id} className="ceo-gear-row">
                    <span>{a.address}</span>
                    <input type="checkbox" role="switch" checked={!hidden.includes(a.id)} onChange={() => toggleMailbox(a.id)} />
                  </label>
                ))}
                <small>A switched-off mailbox keeps syncing; it is only hidden here.</small>
              </div>
            )}
          </span>
        </div>
      </div>

      {account?.filter((a) => a.status === "error" && a.last_error).map((a) => (
        <p key={a.id} className="ceo-notice ceo-error" role="alert">{a.address}: {a.last_error}</p>
      ))}
      {folders.filter((f) => f.enabled && f.last_error).map((f) => (
        <p key={f.id} className="ceo-notice ceo-error" role="alert">
          {account?.find((a) => a.id === f.mailbox_id)?.address} · {f.name}: {f.last_error}
        </p>
      ))}
      {error && <p className="ceo-notice ceo-error" role="alert">{error}</p>}
      {notice && <p className="ceo-notice ceo-ok" role="status">{notice}</p>}

      {drafts.length > 0 && (
        <section className="ceo-mail-review" aria-label="Reply drafts awaiting review">
          <div className="ceo-mail-review-head">
            <h3>Reply drafts</h3>
            <span>Approval does not send an email.</span>
          </div>
          {drafts.map((draft) => (
            <article key={draft.id} className="ceo-mail-draft">
              <span className={`ceo-tag ${draft.status === "approved" ? "ceo-tag-approved" : ""}`}>
                {draft.status === "approved" ? "approved · unsent" : "awaiting review"}
              </span>
              <p><b>To:</b> {draft.to_address}</p>
              <p><b>Subject:</b> {draft.subject}</p>
              <p className="ceo-mail-draft-source">Source thread: {draft.thread_id}</p>
              <label>
                Reply
                <textarea readOnly={draft.status === "approved"} value={draft.status === "approved" ? draft.body : draftEdits[draft.id] ?? draft.body}
                  onChange={(e) => setDraftEdits((edits) => ({ ...edits, [draft.id]: e.target.value }))} />
              </label>
              {draft.status === "draft" && (
                <div className="ceo-mail-buttons">
                  <button className="ceo-text-btn" type="button" onClick={() => saveDraft(draft)}>Save edits</button>
                  <button className="ceo-text-btn" type="button" onClick={() => approveDraft(draft)}>Approve (still unsent)</button>
                  <button className="ceo-text-btn" type="button" onClick={() => cancelDraft(draft)}>Cancel draft</button>
                </div>
              )}
            </article>
          ))}
        </section>
      )}

      <form className="ceo-mail-search" role="search" onSubmit={runSearch}>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search all emails: text, subject, sender, summary" aria-label="Search emails" />
        <button className="btn btn-primary" type="submit" disabled={searching}>{searching ? "Searching…" : "Search"}</button>
        {searchIds && <button className="ceo-text-btn" type="button" onClick={clearSearch}>Clear</button>}
      </form>

      <div className="ceo-switch" role="tablist" aria-label="Filter conversations">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={filter === f.id ? "on" : ""}
            onClick={() => { setFilter(f.id); setPages(1); }}>{f.label}</button>
        ))}
      </div>

      {threads && !shown.length && (
        <div className="ceo-panel"><p className="ceo-panel-empty">
          {searchIds ? "No email matches this search." : filter !== "all" ? "Nothing matches this filter." : "No conversations yet. They appear here after the next sync."}
        </p></div>
      )}

      <ul className="ceo-mail-list">
        {shown.map((t) => (
          <li key={t.id} className={`ceo-mail ${t.status === "new" ? "ceo-mail-new" : ""}`}>
            <button type="button" className="ceo-mail-row" onClick={() => openThread(t)}>
              <span className={`ceo-dot ceo-dot-${t.priority || "normal"}`} title={t.priority || "normal"} />
              <span className="ceo-mail-main">
                {mailboxBubble(t.mailbox_id)}
                <b>{t.subject || "(no subject)"}</b>
                <span>{(t.participants || []).slice(0, 2).join(", ")}{t.message_count > 1 ? ` · ${t.message_count} emails` : ""}</span>
                {t.summary
                  ? <small className="ceo-clamp">{t.summary}</small>
                  : <small className="ceo-muted">Summary not available.</small>}
              </span>
              <span className="ceo-mail-meta">
                <span>{when(t.last_message_at)}</span>
                {t.is_important && <span className="ceo-tag ceo-tag-important">important</span>}
                {t.category && <span className="ceo-tag">{t.category}</span>}
                {t.needs_reply && <span className="ceo-tag ceo-tag-reply">needs reply</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {threads && threads.length < total && (
        <button className="ceo-text-btn ceo-more" type="button" onClick={() => setPages((n) => n + 1)}>
          Show more ({threads.length} of {total})
        </button>
      )}
      <p className="ceo-chat-note">The source mailbox remains read-only. Every folder&apos;s messages, attachments and original .eml files are kept in CRM Email Base. Email text is sent to DeepSeek via OpenRouter for summaries.</p>
      {threadPopup}
    </section>
  );
}

function InboxStyles() {
  return (
    <style>{`
      .ceo-inbox-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; background: #fff; border: 1px solid #e8e8e8; border-radius: 10px; padding: 12px 14px; }
      .ceo-inbox-head b { display: block; font-size: 14px; color: #1f2a30; }
      .ceo-inbox-head span { font-size: 12px; color: #6b7280; }
      .ceo-mailbox-line + .ceo-mailbox-line { margin-top: 6px; }
      .ceo-mailbox-bubble { justify-self: start; display: inline-block; max-width: 100%; font-size: 11px; font-weight: 600; line-height: 1.5; padding: 1px 9px; border: 1px solid; border-radius: 999px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ceo-mailbox-line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
      .ceo-inbox-tools { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
      .ceo-gear-wrap { position: relative; }
      .ceo-gear { width: 34px; height: 34px; border: 1px solid #d1d5db; border-radius: 8px; background: #fff; font-size: 17px; cursor: pointer; }
      .ceo-gear-panel { position: absolute; right: 0; top: 40px; z-index: 50; width: 280px; display: grid; gap: 8px; padding: 12px; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; box-shadow: 0 12px 30px rgba(0,0,0,.15); font-size: 13px; }
      .ceo-gear-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      .ceo-gear-panel small { color: #6b7280; font-size: 11.5px; }
      .ceo-ok { background: #ecfdf5; color: #047857; }
      .ceo-mail-review { display: grid; gap: 10px; padding: 12px; background: #f8fafc; border: 1px solid #dbe3e8; border-radius: 10px; }
      .ceo-mail-review-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
      .ceo-mail-review-head h3 { margin: 0; color: #1f2a30; font-size: 14px; }
      .ceo-mail-review-head span, .ceo-mail-draft-source { color: #6b7280; font-size: 11px; }
      .ceo-mail-draft { display: grid; gap: 6px; padding: 10px; background: white; border: 1px solid #e8e8e8; border-radius: 8px; }
      .ceo-mail-draft p { margin: 0; font-size: 12px; overflow-wrap: anywhere; }
      .ceo-mail-draft label { display: grid; gap: 4px; font-size: 12px; font-weight: 600; }
      .ceo-mail-draft textarea { min-height: 120px; resize: vertical; font: inherit; font-size: 13px; padding: 8px; border: 1px solid #d1d5db; border-radius: 7px; }
      .ceo-mail-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
      .ceo-mail { background: #fff; border: 1px solid #e8e8e8; border-radius: 10px; }
      .ceo-mail-new { border-color: #99d5d2; box-shadow: inset 3px 0 0 #0d7d82; }
      .ceo-mail-row { width: 100%; display: flex; gap: 10px; align-items: flex-start; text-align: left; background: none; border: none; padding: 12px 14px; cursor: pointer; font: inherit; color: inherit; }
      .ceo-mail-main { flex: 1; min-width: 0; display: grid; gap: 2px; }
      .ceo-mail-main b { font-size: 13.5px; font-weight: 600; color: #1f2a30; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ceo-mail:not(.ceo-mail-new) .ceo-mail-main b { font-weight: 500; }
      .ceo-mail-main > span { font-size: 12px; color: #6b7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ceo-mail-main small { font-size: 12.5px; color: #374151; line-height: 1.45; margin-top: 3px; }
      .ceo-clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .ceo-mail-meta { display: grid; justify-items: end; gap: 4px; flex-shrink: 0; font-size: 11.5px; color: #9ca3af; }
      .ceo-tag { font-size: 10.5px; padding: 1px 7px; border-radius: 9px; background: #f3f4f6; color: #4b5563; text-transform: capitalize; }
      .ceo-tag-reply { background: #fef3c7; color: #92400e; text-transform: none; }
      .ceo-tag-important { background: #fee2e2; color: #b91c1c; }
      .ceo-tag-approved { background: #dcfce7; color: #166534; text-transform: none; }
      .ceo-dot { width: 9px; height: 9px; border-radius: 50%; margin-top: 5px; flex-shrink: 0; background: #d1d5db; }
      .ceo-dot-urgent { background: #dc2626; } .ceo-dot-high { background: #f59e0b; } .ceo-dot-normal { background: #0d7d82; } .ceo-dot-low { background: #d1d5db; }
      .ceo-thread-toolbar { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; padding: 8px 12px; background: #fff; border: 1px solid #e8e8e8; border-radius: 10px; }
      .ceo-back { font-weight: 600; }
      .ceo-thread-tools { display: flex; flex-wrap: wrap; gap: 14px; }
      .ceo-thread-head { display: grid; gap: 6px; padding: 4px 2px; }
      .ceo-thread-head h2 { margin: 0; font-size: 20px; line-height: 1.3; color: #1f2a30; overflow-wrap: anywhere; }
      .ceo-thread-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; }
      .ceo-mail-overlay { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: start center; padding: 24px 16px; overflow: auto; background: rgba(15, 23, 42, .38); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
      .ceo-mail-window { width: min(980px, 100%); display: grid; gap: 10px; padding: 16px; background: #f5f7f8; border-radius: 14px; box-shadow: 0 24px 60px rgba(15,23,42,.35); }
      .ceo-thread-layout { display: grid; gap: 14px; }
      .ceo-thread-messages { display: grid; gap: 8px; min-width: 0; }
      .ceo-msg { background: #fff; border: 1px solid #e8e8e8; border-radius: 10px; }
      .ceo-msg-head { width: 100%; display: flex; align-items: flex-start; gap: 10px; padding: 10px 14px; background: none; border: 0; text-align: left; font: inherit; color: inherit; cursor: pointer; }
      .ceo-avatar { flex-shrink: 0; width: 32px; height: 32px; display: grid; place-items: center; border-radius: 50%; background: #e6f4f3; color: #0b6b70; font-weight: 700; font-size: 14px; }
      .ceo-msg-who { flex: 1; min-width: 0; display: grid; gap: 2px; }
      .ceo-msg-who b { font-size: 13.5px; color: #1f2a30; }
      .ceo-msg-who small { font-size: 12px; color: #6b7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ceo-msg-date { flex-shrink: 0; font-size: 11.5px; color: #9ca3af; }
      .ceo-msg-body { display: grid; gap: 4px; padding: 0 14px 14px 56px; font-size: 12px; }
      .ceo-msg-body pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; font-size: 13.5px; line-height: 1.55; margin: 8px 0 0; color: #1f2a30; }
      .ceo-thread-reply { padding: 4px 0; }
      @media (max-width: 900px) { .ceo-msg-body { padding-left: 14px; } .ceo-mail-overlay { padding: 8px; } .ceo-mail-window { padding: 10px; } }
      .ceo-email-history { display: grid; gap: 8px; }
      .ceo-email-history h4 { margin: 0; font-size: 13px; color: #1f2a30; }
      .ceo-email-message { display: grid; gap: 4px; padding: 10px; border: 1px solid #e8e8e8; border-radius: 8px; }
      .ceo-email-message > div { font-size: 11px; }
      .ceo-email-message pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; font-size: 12px; margin: 6px 0 0; color: #374151; }
      .ceo-points { margin: 0; padding-left: 18px; font-size: 12.5px; color: #374151; display: grid; gap: 6px; }
      .ceo-points li { padding-left: 1px; }
      .ceo-points .ceo-text-btn { display: block; padding: 2px 0; }
      .ceo-actions { display: flex; flex-wrap: wrap; gap: 6px; }
      .ceo-mail-buttons { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; }
      .ceo-reply-open { padding: 6px 16px; }
      .ceo-mail-search { display: flex; gap: 8px; align-items: center; }
      .ceo-mail-search input { flex: 1; min-width: 0; font: inherit; font-size: 13px; padding: 7px 10px; border: 1px solid #d1d5db; border-radius: 7px; }
      .ceo-tag-sent { background: #e0f2fe; color: #075985; margin-left: 6px; text-transform: none; }
      .ceo-tag-folder { margin-left: 6px; text-transform: none; }
      .ceo-mail-warning { font-size: 11.5px; color: #92400e; background: #fef3c7; padding: 4px 8px; border-radius: 6px; }
      .ceo-attachments { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
      .ceo-eml { justify-self: start; font-size: 11.5px; }
      .ceo-more { justify-self: center; }
      @media (max-width: 640px) { .ceo-inbox-head { flex-direction: column; align-items: flex-start; } .ceo-mail-meta { display: none; } }
    `}</style>
  );
}
