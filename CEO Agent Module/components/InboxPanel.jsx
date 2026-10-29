import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Inbox view of the CEO Agent: AI summaries of the connected mailbox
// (ceo.mail_threads, written by the ceo-mail-sync Edge Function). The mailbox
// itself is read-only; this view only changes a thread's status here and can
// turn a suggested action into a task or reminder.

const FILTERS = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
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
    const { data, error } = await sb.from("mail_threads")
      .select("id, subject, priority, needs_reply").eq("status", "new").limit(200);
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

export default function InboxPanel({ sb, timezone, userId, onChanged }) {
  const [account, setAccount] = useState(undefined);
  const [threads, setThreads] = useState(null);
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [alerts, setAlerts] = useState(() => (typeof Notification === "undefined" ? "unsupported" : Notification.permission));

  const load = useCallback(async () => {
    const [acc, list] = await Promise.all([
      sb.from("mail_accounts").select("address, status, last_synced_at, last_error").maybeSingle(),
      sb.from("mail_threads")
        .select("id, subject, participants, last_message_at, message_count, status, category, priority, needs_reply, summary, key_points, suggested_actions")
        .neq("status", "archived").order("last_message_at", { ascending: false }).limit(60),
    ]);
    if (acc.error || list.error) { setError((acc.error || list.error).message); return; }
    setError("");
    setAccount(acc.data);
    setThreads(list.data || []);
  }, [sb]);

  useEffect(() => { load(); }, [load]);

  const fmt = useMemo(() => new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }), [timezone]);
  const when = (v) => (v ? fmt.format(new Date(v)) : "");

  const shown = useMemo(() => {
    const list = (threads || []).filter((t) =>
      filter === "unread" ? t.status === "new"
        : filter === "reply" ? t.needs_reply
          : filter === "urgent" ? t.priority === "urgent" || t.priority === "high"
            : true);
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
    const result = data?.results?.[0];
    if (message || result?.error) setError(message || result.error);
    else if (result?.skipped) setNotice(result.skipped);
    else if (result) setNotice(result.fetched ? `Read ${result.fetched} new email(s) in ${result.conversations} conversation(s).` : "No new email.");
    await load();
    onChanged?.();
  }

  async function setStatus(id, status) {
    const { error: err } = await sb.from("mail_threads").update({ status }).eq("id", id);
    if (err) { setError(err.message); return; }
    setThreads((list) => (list || [])
      .map((t) => (t.id === id ? { ...t, status } : t))
      .filter((t) => t.status !== "archived"));
    onChanged?.();
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
  if (!account && !error) {
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
          <b>{account?.address}</b>
          <span>
            {account?.status === "syncing" ? "Syncing…"
              : account?.last_synced_at ? `Last checked ${when(account.last_synced_at)} · checks every 15 minutes`
                : "Not synced yet"}
          </span>
        </div>
        <div className="ceo-inbox-tools">
          {alerts === "default" && <button className="ceo-text-btn" type="button" onClick={enableAlerts}>Enable alerts</button>}
          <button className="btn btn-primary" type="button" onClick={syncNow} disabled={syncing}>{syncing ? "Checking…" : "Sync now"}</button>
        </div>
      </div>

      {account?.status === "error" && account.last_error && <p className="ceo-notice ceo-error" role="alert">{account.last_error}</p>}
      {error && <p className="ceo-notice ceo-error" role="alert">{error}</p>}
      {notice && <p className="ceo-notice ceo-ok" role="status">{notice}</p>}

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
                <span>{(t.participants || []).slice(0, 2).join(", ")}{t.message_count > 1 ? ` · ${t.message_count} emails` : ""}</span>
                {t.summary
                  ? <small className={open === t.id ? "" : "ceo-clamp"}>{t.summary}</small>
                  : <small className="ceo-muted">Summary not available.</small>}
              </span>
              <span className="ceo-mail-meta">
                <span>{when(t.last_message_at)}</span>
                {t.category && <span className="ceo-tag">{t.category}</span>}
                {t.needs_reply && <span className="ceo-tag ceo-tag-reply">needs reply</span>}
              </span>
            </button>
            {open === t.id && (
              <div className="ceo-mail-detail">
                {t.key_points?.length > 0 && <ul className="ceo-points">{t.key_points.map((p, i) => <li key={i}>{p}</li>)}</ul>}
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
      <p className="ceo-chat-note">Read-only: the agent never sends, moves or deletes email. Email text goes to DeepSeek via OpenRouter to be summarized; only summaries and headers are stored.</p>
    </section>
  );
}

function InboxStyles() {
  return (
    <style>{`
      .ceo-inbox-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; background: #fff; border: 1px solid #e8e8e8; border-radius: 10px; padding: 12px 14px; }
      .ceo-inbox-head b { display: block; font-size: 14px; color: #1f2a30; }
      .ceo-inbox-head span { font-size: 12px; color: #6b7280; }
      .ceo-inbox-tools { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
      .ceo-ok { background: #ecfdf5; color: #047857; }
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
      .ceo-dot { width: 9px; height: 9px; border-radius: 50%; margin-top: 5px; flex-shrink: 0; background: #d1d5db; }
      .ceo-dot-urgent { background: #dc2626; } .ceo-dot-high { background: #f59e0b; } .ceo-dot-normal { background: #0d7d82; } .ceo-dot-low { background: #d1d5db; }
      .ceo-mail-detail { padding: 0 14px 12px 33px; display: grid; gap: 8px; }
      .ceo-points { margin: 0; padding-left: 18px; font-size: 12.5px; color: #374151; display: grid; gap: 2px; }
      .ceo-actions { display: flex; flex-wrap: wrap; gap: 6px; }
      .ceo-mail-buttons { display: flex; gap: 14px; }
      @media (max-width: 640px) { .ceo-inbox-head { flex-direction: column; align-items: flex-start; } .ceo-mail-meta { display: none; } }
    `}</style>
  );
}
