import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Inbox view of the CEO Agent: AI summaries of the connected mailbox
// (Email Base in the Agent Project: email_base.threads of the mailboxes tagged
// 'ceo', written by the ceo-mail-sync Edge Function). The mailbox
// itself is read-only; this view can mark threads important, save facts, review
// unsent reply drafts, and turn a suggested action into a task or reminder.

const FILTERS = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "important", label: "Important" },
  { id: "reply", label: "Needs reply" },
  { id: "urgent", label: "Urgent" },
];
const PRIORITY_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };
const POLL_MS = 2 * 60 * 1000;

// Unread count for the tab badge, plus an optional browser alert when a new
// urgent or needs-reply conversation arrives while the CRM is open.
export function useInboxAlerts(sb) {
  const [unread, setUnread] = useState(0);
  const seenRef = useRef(null);

  const check = useCallback(async () => {
    const { data, error } = await sb.schema("email_base").from("threads")
      .select("id, subject, priority, needs_reply").contains("tags", ["ceo"]).eq("status", "new").limit(200);
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
  const [threads, setThreads] = useState(null);
  const [savedFacts, setSavedFacts] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [draftEdits, setDraftEdits] = useState({});
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [alerts, setAlerts] = useState(() => (typeof Notification === "undefined" ? "unsupported" : Notification.permission));

  const load = useCallback(async () => {
    const [acc, list, facts, pendingDrafts] = await Promise.all([
      sb.schema("email_base").from("mailboxes").select("id, address, status, last_synced_at, last_error").contains("tags", ["ceo"]).order("address"),
      sb.schema("email_base").from("threads")
        .select("id, mailbox_id, subject, participants, last_message_at, message_count, status, category, priority, needs_reply, is_important, summary, key_points, suggested_actions")
        .contains("tags", ["ceo"]).neq("status", "archived").order("last_message_at", { ascending: false }).limit(60),
      sb.from("mail_saved_facts").select("id, thread_id, subject, fact, created_at").order("created_at", { ascending: false }).limit(100),
      sb.from("mail_drafts").select("id, thread_id, to_address, subject, body, status, created_at")
        .in("status", ["draft", "approved"]).order("created_at", { ascending: false }).limit(50),
    ]);
    const firstError = [acc, list, facts, pendingDrafts].find((result) => result.error)?.error;
    if (firstError) { setError(firstError.message); return; }
    setError("");
    setAccount(acc.data || []);
    setThreads(list.data || []);
    setSavedFacts(facts.data || []);
    setDrafts(pendingDrafts.data || []);
  }, [sb]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const fmt = useMemo(() => new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }), [timezone]);
  const when = (v) => (v ? fmt.format(new Date(v)) : "");

  const shown = useMemo(() => {
    const list = (threads || []).filter((t) => {
      if (filter === "unread") return t.status === "new";
      if (filter === "important") return t.is_important;
      if (filter === "reply") return t.needs_reply;
      if (filter === "urgent") return t.priority === "urgent" || t.priority === "high";
      return true;
    });
    // Unread first, then by priority, then newest.
    return list.sort((a, b) =>
      (a.status === "new" ? 0 : 1) - (b.status === "new" ? 0 : 1)
      || (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2)
      || String(b.last_message_at).localeCompare(String(a.last_message_at)));
  }, [threads, filter]);

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
    if (!message && results.length > failed.length) {
      setNotice(read ? `Read ${read} new email(s) across ${results.length} mailbox(es).`
        : results.some((r) => r.skipped) ? "A sync is already running." : "No new email.");
    }
    onChanged?.();
  }

  async function setStatus(id, status) {
    const { error: err } = await sb.schema("email_base").from("threads").update({ status }).eq("id", id);
    if (err) { setError(err.message); return; }
    setThreads((list) => (list || [])
      .map((t) => (t.id === id ? { ...t, status } : t))
      .filter((t) => t.status !== "archived"));
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
    const { data, error: err } = await sb.from("mail_saved_facts")
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
    const { error: err } = await sb.from("mail_drafts").update({ body }).eq("id", draft.id);
    if (err) { setError(err.message); return; }
    setDrafts((list) => list.map((item) => item.id === draft.id ? { ...item, body } : item));
    setDraftEdits((edits) => ({ ...edits, [draft.id]: body }));
    setNotice("Draft changes saved. The email has not been sent.");
  }

  async function approveDraft(draft) {
    if (!window.confirm("Approve this draft? It will remain unsent; you must send it yourself outside this agent.")) return;
    const body = draftEdits[draft.id] ?? draft.body;
    if (!body.trim()) { setError("A reply draft cannot be empty."); return; }
    const { error: err } = await sb.from("mail_drafts").update({ body, status: "approved" }).eq("id", draft.id);
    if (err) { setError(err.message); return; }
    setDrafts((list) => list.map((item) => item.id === draft.id ? { ...item, body, status: "approved" } : item));
    setNotice("Draft approved and kept unsent. Copy it to your mail client when you are ready to send.");
  }

  async function cancelDraft(draft) {
    if (!window.confirm("Cancel and remove this reply draft from the review list?")) return;
    const { error: err } = await sb.from("mail_drafts").update({ status: "cancelled" }).eq("id", draft.id);
    if (err) { setError(err.message); return; }
    setDrafts((list) => list.filter((item) => item.id !== draft.id));
    setNotice("Reply draft cancelled.");
  }

  function toggle(t) {
    setOpen(open === t.id ? null : t.id);
    if (t.status === "new") setStatus(t.id, "read");
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

  return (
    <section className="ceo-dash ceo-inbox" aria-label="Email summaries">
      <InboxStyles />
      <div className="ceo-inbox-head">
        <div>
          {account?.map((a) => (
            <div key={a.id} className="ceo-mailbox-line">
              <b>{a.address}</b>
              <span>
                {a.status === "syncing" ? "Syncing…"
                  : a.last_synced_at ? `Last checked ${when(a.last_synced_at)}`
                    : "Not synced yet"}
              </span>
            </div>
          ))}
          <span>Checks every 15 minutes</span>
        </div>
        <div className="ceo-inbox-tools">
          {alerts === "default" && <button className="ceo-text-btn" type="button" onClick={enableAlerts}>Enable alerts</button>}
          <button className="btn btn-primary" type="button" onClick={syncNow} disabled={syncing}>{syncing ? "Checking…" : "Sync now"}</button>
        </div>
      </div>

      {account?.filter((a) => a.status === "error" && a.last_error).map((a) => (
        <p key={a.id} className="ceo-notice ceo-error" role="alert">{a.address}: {a.last_error}</p>
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

      <div className="ceo-switch" role="tablist" aria-label="Filter conversations">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={filter === f.id ? "on" : ""}
            onClick={() => setFilter(f.id)}>{f.label}</button>
        ))}
      </div>

      {threads && !shown.length && (
        <div className="ceo-panel"><p className="ceo-panel-empty">
          {threads.length ? "Nothing matches this filter." : "No conversations yet. Summaries appear here after the next sync."}
        </p></div>
      )}

      <ul className="ceo-mail-list">
        {shown.map((t) => (
          <li key={t.id} className={`ceo-mail ${t.status === "new" ? "ceo-mail-new" : ""}`}>
            <button type="button" className="ceo-mail-row" onClick={() => toggle(t)} aria-expanded={open === t.id}>
              <span className={`ceo-dot ceo-dot-${t.priority || "normal"}`} title={t.priority || "normal"} />
              <span className="ceo-mail-main">
                <b>{t.subject || "(no subject)"}</b>
                <span>{account.length > 1 && <em className="ceo-mailbox">{account.find((a) => a.id === t.mailbox_id)?.address} · </em>}{(t.participants || []).slice(0, 2).join(", ")}{t.message_count > 1 ? ` · ${t.message_count} emails` : ""}</span>
                {t.summary
                  ? <small className={open === t.id ? "" : "ceo-clamp"}>{t.summary}</small>
                  : <small className="ceo-muted">Summary not available.</small>}
              </span>
              <span className="ceo-mail-meta">
                <span>{when(t.last_message_at)}</span>
                {t.is_important && <span className="ceo-tag ceo-tag-important">important</span>}
                {t.category && <span className="ceo-tag">{t.category}</span>}
                {t.needs_reply && <span className="ceo-tag ceo-tag-reply">needs reply</span>}
              </span>
            </button>
            {open === t.id && (
              <div className="ceo-mail-detail">
                {t.key_points?.length > 0 && (
                  <ul className="ceo-points">{t.key_points.map((p, i) => {
                    const isSaved = savedFacts.some((fact) => fact.thread_id === t.id && fact.fact === p);
                    return (
                      <li key={i}>
                        <span>{p}</span>
                        <button className="ceo-text-btn" type="button" disabled={isSaved} onClick={() => saveFact(t, p)}>
                          {isSaved ? "Saved to memory" : "Save fact"}
                        </button>
                      </li>
                    );
                  })}</ul>
                )}
                {t.suggested_actions?.length > 0 && (
                  <div className="ceo-actions">
                    {t.suggested_actions.map((a, i) => (
                      <button key={i} type="button" className="ceo-chip" onClick={() => addAction(t, a)}>
                        + {a.type === "reply" ? "Reply" : a.type}: {a.title}{a.due ? ` (${when(a.due)})` : ""}
                      </button>
                    ))}
                  </div>
                )}
                <div className="ceo-mail-buttons">
                  <button className="ceo-text-btn" type="button" onClick={() => setImportant(t, !t.is_important)}>
                    {t.is_important ? "Unmark important" : "Mark important"}
                  </button>
                  <button className="ceo-text-btn" type="button" onClick={() => setStatus(t.id, t.status === "new" ? "read" : "new")}>
                    Mark {t.status === "new" ? "read" : "unread"}
                  </button>
                  <button className="ceo-text-btn" type="button" onClick={() => setStatus(t.id, "archived")}>Archive</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="ceo-chat-note">The source mailbox remains read-only. Importance markers and saved facts are CRM-only. Email text goes to DeepSeek via OpenRouter to be summarized; only summaries and headers are stored.</p>
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
      .ceo-mailbox { font-style: normal; color: #0d7d82; }
      .ceo-inbox-tools { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
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
      .ceo-mail-detail { padding: 0 14px 12px 33px; display: grid; gap: 8px; }
      .ceo-points { margin: 0; padding-left: 18px; font-size: 12.5px; color: #374151; display: grid; gap: 6px; }
      .ceo-points li { padding-left: 1px; }
      .ceo-points .ceo-text-btn { display: block; padding: 2px 0; }
      .ceo-actions { display: flex; flex-wrap: wrap; gap: 6px; }
      .ceo-mail-buttons { display: flex; gap: 14px; }
      @media (max-width: 640px) { .ceo-inbox-head { flex-direction: column; align-items: flex-start; } .ceo-mail-meta { display: none; } }
    `}</style>
  );
}
