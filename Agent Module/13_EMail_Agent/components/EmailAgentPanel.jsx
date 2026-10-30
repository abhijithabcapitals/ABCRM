import { useCallback, useEffect, useMemo, useState } from "react";

// Email Agent page: review what the agent found in Email Base, add suggestions to the
// CEO calendar, read digests, and manage rules and settings.
// Reads the `email_agent` schema with the signed-in user's session (row-level security
// limits it to their own rows). Running the agent and adding to the calendar go through
// the `email-agent` Edge Function.

const TZ = "Asia/Dubai";
const KIND_LABEL = {
  meeting: "Meeting", deadline: "Deadline", payment: "Payment", task: "Task", reminder: "Reminder",
  document_request: "Documents", follow_up: "Follow-up", phishing: "Phishing", notice: "Notice",
};
const CALENDAR_KINDS = ["meeting", "deadline", "payment", "task", "reminder", "document_request"];
const RULE_ACTIONS = {
  vip: "VIP: raise priority and always notify",
  always_notify: "Always notify",
  no_calendar: "Never add to calendar automatically",
  ignore: "Ignore completely",
};

const fmt = (iso) => (iso ? new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
}).format(new Date(iso)) : "");

// <input type="datetime-local"> values in Dubai time (UTC+4, no daylight saving).
const toLocalInput = (iso) => (iso ? new Date(new Date(iso).getTime() + 4 * 3600_000).toISOString().slice(0, 16) : "");
const fromLocalInput = (v) => (v ? new Date(`${v}:00+04:00`).toISOString() : null);

const STYLE = `
.ea { display: flex; flex-direction: column; gap: 14px; }
.ea-head { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; }
.ea-meta { color: #5b7376; font-size: 13px; }
.ea-tabs { display: flex; gap: 4px; border-bottom: 1px solid #dfe8e9; flex-wrap: wrap; }
.ea-tab { background: none; border: 0; padding: 8px 12px; cursor: pointer; color: #5b7376; font-size: 14px; border-bottom: 2px solid transparent; }
.ea-tab.on { color: var(--accent, #0d7d82); border-bottom-color: var(--accent, #0d7d82); font-weight: 600; }
.ea-list { display: flex; flex-direction: column; gap: 10px; }
.ea-card { border: 1px solid #dfe8e9; border-radius: 10px; padding: 12px 14px; background: #fff; display: flex; flex-direction: column; gap: 6px; }
.ea-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.ea-title { font-weight: 600; color: var(--ink, #0c2f34); }
.ea-chip { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--accent-weak, #e8f6f6); color: var(--accent, #0d7d82); }
.ea-chip.urgent, .ea-chip.phishing { background: #fdeceb; color: #b42318; }
.ea-chip.high { background: #fff4e5; color: #b54708; }
.ea-quote { font-size: 13px; color: #5b7376; border-left: 3px solid #dfe8e9; padding-left: 8px; font-style: italic; }
.ea-detail { font-size: 13px; color: #33494c; white-space: pre-wrap; }
.ea-edit { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; font-size: 13px; }
.ea-edit input, .ea-form input, .ea-form select { padding: 6px 8px; border: 1px solid #cfdcdd; border-radius: 6px; font: inherit; }
.ea-edit input[type=text] { flex: 1; min-width: 200px; }
.ea-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; align-items: end; }
.ea-form label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #33494c; }
.ea-form label.check { flex-direction: row; align-items: center; gap: 8px; }
.ea-empty { color: #5b7376; font-size: 14px; padding: 16px 0; }
.ea-notice { padding: 8px 12px; border-radius: 8px; font-size: 13px; }
.ea-notice.err { background: #fdeceb; color: #b42318; }
.ea-notice.ok { background: #e8f6f6; color: #0a636a; }
.ea-digest { white-space: pre-wrap; font-size: 14px; line-height: 1.5; }
.ea-link { background: none; border: 0; color: var(--accent, #0d7d82); cursor: pointer; padding: 0; font: inherit; }
`;

function Chip({ children, tone }) {
  return <span className={`ea-chip ${tone || ""}`}>{children}</span>;
}

function InsightCard({ item, onApply, onDismiss, busy }) {
  const isMeeting = item.kind === "meeting";
  const [title, setTitle] = useState(item.title);
  const [when, setWhen] = useState(toLocalInput(isMeeting ? item.starts_at : item.due_at));
  const canCalendar = item.status === "proposed" && CALENDAR_KINDS.includes(item.kind);
  return (
    <div className="ea-card">
      <div className="ea-row">
        <Chip tone={item.kind === "phishing" ? "phishing" : ""}>{KIND_LABEL[item.kind] || item.kind}</Chip>
        <Chip tone={item.priority}>{item.priority}</Chip>
        <span className="ea-meta">confidence {Math.round(Number(item.confidence) * 100)}% · {item.source === "ics" ? "calendar invite" : item.source}</span>
        <span className="ea-meta" style={{ marginLeft: "auto" }}>{fmt(item.created_at)}</span>
      </div>
      {canCalendar ? (
        <div className="ea-edit">
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label={isMeeting ? "Starts" : "Due"} />
        </div>
      ) : (
        <div className="ea-title">{item.title}</div>
      )}
      {!canCalendar && (item.starts_at || item.due_at) && (
        <div className="ea-meta">{isMeeting ? "Starts" : "Due"} {fmt(isMeeting ? item.starts_at : item.due_at)}</div>
      )}
      {item.location && <div className="ea-meta">Location: {item.location}</div>}
      {item.detail && <div className="ea-detail">{item.detail}</div>}
      {item.evidence && <div className="ea-quote">“{item.evidence}”</div>}
      {item.status === "applied" && <div className="ea-meta">In calendar ({item.applied_table})</div>}
      {(canCalendar || item.status === "notified") && (
        <div className="ea-row">
          {canCalendar && (
            <button className="btn btn-primary btn-sm" type="button" disabled={busy || ((item.kind === "meeting" || item.kind === "reminder") && !when)}
              onClick={() => onApply(item, { title, [isMeeting ? "starts_at" : "due_at"]: fromLocalInput(when) })}>
              Add to calendar
            </button>
          )}
          <button className="btn btn-sm" type="button" disabled={busy} onClick={() => onDismiss(item)}>Dismiss</button>
        </div>
      )}
    </div>
  );
}

export default function EmailAgentPanel({ crmClient }) {
  const ea = useMemo(() => crmClient.schema("email_agent"), [crmClient]);
  const [tab, setTab] = useState("review");
  const [status, setStatus] = useState(null);
  const [items, setItems] = useState([]);
  const [digests, setDigests] = useState([]);
  const [rules, setRules] = useState([]);
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [newRule, setNewRule] = useState({ match_type: "domain", pattern: "", action: "vip" });

  const call = useCallback(async (body) => {
    const { data, error: err } = await crmClient.functions.invoke("email-agent", { body });
    if (err) {
      let message = err.message;
      try { message = (await err.context.json()).error || message; } catch { /* keep message */ }
      throw new Error(message);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }, [crmClient]);

  const load = useCallback(async () => {
    setError("");
    try {
      const st = await call({ action: "status" });
      setStatus(st);
      setSettings(st.settings);
    } catch (e) {
      setError(e.message);
    }
    const filter = tab === "review" ? ["proposed"] : ["applied", "notified", "dismissed", "proposed"];
    const [ins, dig, rul] = await Promise.all([
      ea.from("insights").select("*").in("status", filter).order("created_at", { ascending: false }).limit(tab === "review" ? 100 : 200),
      ea.from("digests").select("*").order("digest_date", { ascending: false }).limit(14),
      ea.from("rules").select("*").order("created_at", { ascending: false }),
    ]);
    const firstError = ins.error || dig.error || rul.error;
    if (firstError) setError(firstError.message);
    setItems(ins.data || []);
    setDigests(dig.data || []);
    setRules(rul.data || []);
  }, [call, ea, tab]);

  useEffect(() => { load(); }, [load]);

  async function act(fn, ok) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      if (ok) setNotice(ok);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const runNow = () => act(async () => {
    const r = await call({ action: "run" });
    if (r.skipped) throw new Error(r.skipped);
    const s = r.stats || {};
    setNotice(`Checked ${s.pending || 0} new messages: ${s.calendar || 0} added to calendar, ${s.proposed || 0} to review, ${s.notifications || 0} notifications.`);
  });
  const apply = (item, edits) => act(() => call({ action: "apply", insight_id: item.id, ...edits }), `Added "${edits.title || item.title}" to the calendar.`);
  const dismiss = (item) => act(async () => {
    const { error: err } = await ea.from("insights").update({ status: "dismissed" }).eq("id", item.id);
    if (err) throw new Error(err.message);
  });
  const addRule = () => act(async () => {
    const pattern = newRule.pattern.trim().toLowerCase();
    if (!pattern) throw new Error("Enter a sender, domain or subject text.");
    const { data: auth } = await crmClient.auth.getUser();
    const { error: err } = await ea.from("rules").insert({ ...newRule, pattern, owner_user_id: auth.user.id });
    if (err) throw new Error(err.message);
    setNewRule({ ...newRule, pattern: "" });
  }, "Rule saved.");
  const removeRule = (id) => act(async () => {
    const { error: err } = await ea.from("rules").delete().eq("id", id);
    if (err) throw new Error(err.message);
  });
  const saveSettings = () => act(async () => {
    const { owner_user_id, enabled, auto_calendar, min_confidence, notify_priorities, follow_up_days, digest_hour } = settings;
    const { error: err } = await ea.from("settings")
      .update({ enabled, auto_calendar, min_confidence: Number(min_confidence), notify_priorities, follow_up_days: Number(follow_up_days), digest_hour: Number(digest_hour) })
      .eq("owner_user_id", owner_user_id);
    if (err) throw new Error(err.message);
  }, "Settings saved.");

  const last = status?.last_run;
  const tabs = [
    ["review", `Review${status?.proposed ? ` (${status.proposed})` : ""}`],
    ["activity", "Activity"],
    ["digest", "Digests"],
    ["rules", "Rules"],
    ["settings", "Settings"],
  ];

  return (
    <section className="ea" aria-label="Email Agent">
      <style>{STYLE}</style>
      <div className="ea-head">
        <div className="ea-meta">
          {last
            ? <>Last run {fmt(last.started_at)} ({last.trigger}){last.stats ? ` · ${last.stats.pending || 0} messages · ${last.stats.calendar || 0} to calendar · ${last.stats.notifications || 0} notifications` : ""}{last.errors?.length ? ` · ${last.errors.length} problem(s)` : ""}</>
            : "The agent has not run yet."}
          {status && !status.ai_configured && " · AI key missing"}
        </div>
        <button className="btn btn-primary" type="button" onClick={runNow} disabled={busy}>{busy ? "Working…" : "Run now"}</button>
      </div>
      {error && <p className="ea-notice err" role="alert">{error}</p>}
      {notice && <p className="ea-notice ok" role="status">{notice}</p>}
      {last?.errors?.length > 0 && tab === "activity" && (
        <div className="ea-notice err">{last.errors.slice(0, 5).map((e, i) => <div key={i}>{e}</div>)}</div>
      )}

      <div className="ea-tabs" role="tablist">
        {tabs.map(([key, label]) => (
          <button key={key} className={`ea-tab ${tab === key ? "on" : ""}`} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {(tab === "review" || tab === "activity") && (
        <div className="ea-list">
          {items.length === 0 && <p className="ea-empty">{tab === "review" ? "Nothing waiting for review." : "No activity yet."}</p>}
          {items.map((item) => (
            <InsightCard key={`${item.id}-${item.status}`} item={item} onApply={apply} onDismiss={dismiss} busy={busy} />
          ))}
        </div>
      )}

      {tab === "digest" && (
        <div className="ea-list">
          {digests.length === 0 && <p className="ea-empty">No digest yet. One is written each day after the digest hour.</p>}
          {digests.map((d) => (
            <div key={d.digest_date} className="ea-card">
              <div className="ea-title">{d.digest_date}</div>
              <div className="ea-digest">{d.body}</div>
            </div>
          ))}
        </div>
      )}

      {tab === "rules" && (
        <div className="ea-list">
          <div className="ea-card">
            <div className="ea-form">
              <label>Match
                <select value={newRule.match_type} onChange={(e) => setNewRule({ ...newRule, match_type: e.target.value })}>
                  <option value="domain">Sender domain</option>
                  <option value="sender">Sender address</option>
                  <option value="subject">Subject contains</option>
                </select>
              </label>
              <label>Value
                <input value={newRule.pattern} placeholder={newRule.match_type === "domain" ? "tax.gov.ae" : newRule.match_type === "sender" ? "name@client.ae" : "webinar"}
                  onChange={(e) => setNewRule({ ...newRule, pattern: e.target.value })} />
              </label>
              <label>Action
                <select value={newRule.action} onChange={(e) => setNewRule({ ...newRule, action: e.target.value })}>
                  {Object.entries(RULE_ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <button className="btn btn-primary" type="button" onClick={addRule} disabled={busy}>Add rule</button>
            </div>
          </div>
          {rules.length === 0 && <p className="ea-empty">No rules. Example: domain tax.gov.ae → VIP.</p>}
          {rules.map((r) => (
            <div key={r.id} className="ea-card">
              <div className="ea-row">
                <Chip>{r.match_type}</Chip>
                <span className="ea-title">{r.pattern}</span>
                <span className="ea-meta">{RULE_ACTIONS[r.action]}</span>
                <button className="ea-link" style={{ marginLeft: "auto" }} type="button" onClick={() => removeRule(r.id)} disabled={busy}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "settings" && (settings ? (
        <div className="ea-card">
          <div className="ea-form">
            <label className="check"><input type="checkbox" checked={settings.enabled} onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })} />Agent enabled</label>
            <label className="check"><input type="checkbox" checked={settings.auto_calendar} onChange={(e) => setSettings({ ...settings, auto_calendar: e.target.checked })} />Add confident items to the calendar automatically</label>
            <label>Minimum confidence for automatic calendar entries
              <input type="number" min="0" max="1" step="0.05" value={settings.min_confidence} onChange={(e) => setSettings({ ...settings, min_confidence: e.target.value })} />
            </label>
            <label>Follow-up alert after (days without reply)
              <input type="number" min="1" max="60" value={settings.follow_up_days} onChange={(e) => setSettings({ ...settings, follow_up_days: e.target.value })} />
            </label>
            <label>Daily digest hour (Dubai)
              <input type="number" min="0" max="23" value={settings.digest_hour} onChange={(e) => setSettings({ ...settings, digest_hour: e.target.value })} />
            </label>
            <fieldset style={{ border: 0, padding: 0, display: "flex", gap: 12, flexWrap: "wrap", fontSize: 13 }}>
              <legend style={{ marginBottom: 4 }}>Notify for priorities</legend>
              {["urgent", "high", "normal", "low"].map((p) => (
                <label key={p} className="check">
                  <input type="checkbox" checked={settings.notify_priorities.includes(p)}
                    onChange={(e) => setSettings({
                      ...settings,
                      notify_priorities: e.target.checked ? [...settings.notify_priorities, p] : settings.notify_priorities.filter((x) => x !== p),
                    })} />{p}
                </label>
              ))}
            </fieldset>
          </div>
          <div className="ea-row" style={{ marginTop: 10 }}>
            <button className="btn btn-primary" type="button" onClick={saveSettings} disabled={busy}>Save settings</button>
            <span className="ea-meta">Model: {status?.model}. The agent never sends, moves or deletes mail.</span>
          </div>
        </div>
      ) : <p className="ea-empty">Settings appear after the agent's first run.</p>)}
    </section>
  );
}
