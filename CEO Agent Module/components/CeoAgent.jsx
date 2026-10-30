import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CalendarPanel from "@calendar";
import InboxPanel, { useInboxAlerts } from "./InboxPanel.jsx";

// The CEO workspace and Email Base use the CRM Supabase project and CRM sign-in.
export default function CeoAgent({ crmClient }) {
  const shared = useMemo(
    () => crmClient && {
      auth: crmClient.auth,
      functions: crmClient.functions,
      storage: crmClient.storage,
      from: (table) => crmClient.schema("ceo").from(table),
      schema: (schema) => crmClient.schema(schema),
    },
    [crmClient],
  );
  if (shared) return <Workspace sb={shared} sharedSession />;
  return <SetupCard />;
}

function Workspace({ sb, sharedSession = false }) {
  const [phase, setPhase] = useState("loading"); // loading | signin | mfa | ready | error
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");

  const evaluate = useCallback(async () => {
    setError("");
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { setUser(null); setPhase("signin"); return; }
    setUser(session.user);
    const { data: prof, error: profErr } = await sb
      .from("profiles").select("display_name, timezone, require_mfa").maybeSingle();
    if (profErr) { setError(`Could not load your CEO profile: ${profErr.message}`); setPhase("error"); return; }
    setProfile(prof);
    if (prof?.require_mfa) {
      const [{ data: aal, error: aalErr }, { data: factors, error: fErr }] = await Promise.all([
        sb.auth.mfa.getAuthenticatorAssuranceLevel(),
        sb.auth.mfa.listFactors(),
      ]);
      if (aalErr || fErr) { setError(`Could not verify MFA status: ${(aalErr || fErr).message}`); setPhase("error"); return; }
      const verified = factors.totp.some((f) => f.status === "verified");
      if (!verified || aal.currentLevel !== "aal2") { setPhase("mfa"); return; }
    }
    setPhase("ready");
  }, [sb]);

  useEffect(() => {
    evaluate();
    const { data: sub } = sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") { setUser(null); setPhase("signin"); }
    });
    return () => sub.subscription.unsubscribe();
  }, [sb, evaluate]);

  async function signOut() {
    await sb.auth.signOut();
  }

  return (
    <div className="ceo-root">
      <Styles />
      <div className="ceo-top">
        <div className="ceo-brand">
          <span className="ceo-mark">CI</span>
          <span>
            <strong>CEO Intelligence</strong>
            <small>Private executive memory · only you can see your captures</small>
          </span>
        </div>
        {user && !sharedSession && (
          <div className="ceo-account">
            <span>{profile?.display_name || user.email}</span>
            <button className="ceo-text-btn" type="button" onClick={signOut}>Sign out</button>
          </div>
        )}
      </div>

      {phase === "loading" && <p className="ceo-muted">Loading…</p>}
      {phase === "error" && <p className="ceo-notice ceo-error" role="alert">{error}</p>}
      {phase === "signin" && <SignIn sb={sb} onDone={evaluate} />}
      {phase === "mfa" && <Mfa sb={sb} onDone={evaluate} />}
      {phase === "ready" && (
        profile
          ? <Ready sb={sb} userId={user.id} timezone={profile.timezone || "Asia/Dubai"} />
          : <p className="ceo-notice ceo-error" role="alert">
              Your account is not provisioned for this workspace yet. Ask the project administrator to
              create your CEO profile in <code>ceo.profiles</code>.
            </p>
      )}

      <p className="ceo-foot">Captures are private to your signed-in CEO account. No external actions are enabled.</p>
    </div>
  );
}

function SignIn({ sb, onDone }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error: err } = await sb.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setPassword("");
    onDone();
  }

  return (
    <section className="ceo-card ceo-narrow">
      <p className="ceo-eyebrow">SECURE SIGN IN</p>
      <h2>Welcome back.</h2>
      <p className="ceo-muted">Access is invite-only and uses the CEO Agent's own account, not your CRM login.</p>
      <form className="ceo-form" onSubmit={submit}>
        <label>Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="ceo-notice ceo-error" role="alert">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </section>
  );
}

function Mfa({ sb, onDone }) {
  const [factor, setFactor] = useState(null);
  const [enrollment, setEnrollment] = useState(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error: err } = await sb.auth.mfa.listFactors();
      if (!active) return;
      if (err) { setError(err.message); return; }
      const verified = data.totp.find((f) => f.status === "verified");
      if (verified) { setFactor(verified); return; }
      const pending = data.all.find((f) => f.factor_type === "totp" && f.status === "unverified");
      if (pending) {
        setError("An unfinished authenticator setup exists. Remove it in Supabase Auth or ask an administrator to reset it before continuing.");
        return;
      }
      const { data: enrolled, error: enrollErr } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "CEO Intelligence" });
      if (!active) return;
      if (enrollErr) { setError(enrollErr.message); return; }
      setEnrollment({ id: enrolled.id, qrCode: enrolled.totp.qr_code, secret: enrolled.totp.secret });
    })();
    return () => { active = false; };
  }, [sb]);

  async function verify(e) {
    e.preventDefault();
    const factorId = enrollment?.id ?? factor?.id;
    if (!factorId) { setError("No authenticator factor is available."); return; }
    setBusy(true);
    setError("");
    const { data: challenge, error: cErr } = await sb.auth.mfa.challenge({ factorId });
    if (cErr) { setBusy(false); setError(cErr.message); return; }
    const { error: vErr } = await sb.auth.mfa.verify({ factorId, challengeId: challenge.id, code: code.replace(/\s/g, "") });
    setBusy(false);
    if (vErr) { setError(vErr.message); return; }
    onDone();
  }

  return (
    <section className="ceo-card ceo-narrow">
      <p className="ceo-eyebrow">MULTI-FACTOR AUTHENTICATION</p>
      <h2>Verify it's you.</h2>
      {enrollment ? (
        <>
          <p className="ceo-muted">Scan this QR code with an authenticator app, then enter its six-digit code to finish setup.</p>
          <img className="ceo-qr" src={enrollment.qrCode} alt="Authenticator setup QR code" />
          <p className="ceo-note">Manual setup key: <code>{enrollment.secret}</code></p>
        </>
      ) : (
        <p className="ceo-muted">Enter the current six-digit code from your authenticator app.</p>
      )}
      <form className="ceo-form" onSubmit={verify}>
        <label>Authenticator code
          <input inputMode="numeric" autoComplete="one-time-code" maxLength={8} pattern="[0-9 ]{6,8}" value={code}
            onChange={(e) => setCode(e.target.value)} required />
        </label>
        {error && <p className="ceo-notice ceo-error" role="alert">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy || (!factor && !enrollment)}>
          {busy ? "Verifying…" : enrollment ? "Enable authenticator" : "Verify and continue"}
        </button>
      </form>
    </section>
  );
}

function Ready({ sb, userId, timezone }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [view, setView] = useState("overview");
  const inbox = useInboxAlerts(sb);
  return (
    <div className="ceo-split">
      <Chat sb={sb} userId={userId} onChanged={() => setRefreshKey((k) => k + 1)} />
      <div className="ceo-right">
        <div className="ceo-switch ceo-view-switch" role="tablist" aria-label="Dashboard view">
          <button type="button" role="tab" aria-selected={view === "overview"} className={view === "overview" ? "on" : ""}
            onClick={() => setView("overview")}>Overview</button>
          <button type="button" role="tab" aria-selected={view === "calendar"} className={view === "calendar" ? "on" : ""}
            onClick={() => setView("calendar")}>Calendar</button>
          <button type="button" role="tab" aria-selected={view === "inbox"} className={view === "inbox" ? "on" : ""}
            onClick={() => setView("inbox")}>Inbox{inbox.unread > 0 && <span className="ceo-badge">{inbox.unread}</span>}</button>
        </div>
        {view === "overview" && <Dashboard sb={sb} timezone={timezone} refreshKey={refreshKey} />}
        {view === "calendar" && (
          <CalendarView sb={sb} userId={userId} timezone={timezone} refreshKey={refreshKey}
            onChanged={() => setRefreshKey((k) => k + 1)} />
        )}
        {view === "inbox" && (
          <InboxPanel sb={sb} timezone={timezone} userId={userId} refreshKey={refreshKey}
            onChanged={() => { inbox.refresh(); setRefreshKey((k) => k + 1); }} />
        )}
      </div>
    </div>
  );
}

const CALENDAR_KINDS = {
  meeting: { label: "Meeting", color: "#0d7d82", hasEnd: true },
  reminder: { label: "Reminder", color: "#d97706" },
  task: { label: "Task due", color: "#9ca3af" },
};

const RECORD_TABLE = { meeting: "meetings", task: "tasks" };

// Meetings, reminders and task due dates in the shared Calendar Module.
// Edits write straight to the ceo tables (row-level security limits them to the owner).
function CalendarView({ sb, userId, timezone, refreshKey, onChanged }) {
  const [range, setRange] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!range) return;
    setLoading(true);
    const [meetings, reminders, tasks] = await Promise.all([
      sb.from("meetings").select("id, record_id, title, starts_at, ends_at, summary").gte("starts_at", range.from).lt("starts_at", range.to).order("starts_at"),
      sb.from("reminders").select("id, title, body, scheduled_at").eq("delivery_status", "scheduled").gte("scheduled_at", range.from).lt("scheduled_at", range.to).order("scheduled_at"),
      sb.from("tasks").select("id, record_id, title, description, due_at, status, priority").not("status", "in", "(done,cancelled)").gte("due_at", range.from).lt("due_at", range.to).order("due_at"),
    ]);
    setLoading(false);
    const firstError = [meetings, reminders, tasks].find((r) => r.error)?.error;
    if (firstError) { setError(firstError.message); return; }
    setError("");
    setEvents([
      ...(meetings.data || []).map((r) => ({ id: `m-${r.id}`, rowId: r.id, recordId: r.record_id, kind: "meeting", title: r.title,
        start: r.starts_at, end: r.ends_at, notes: r.summary, subtitle: r.summary || "Meeting" })),
      ...(reminders.data || []).map((r) => ({ id: `r-${r.id}`, rowId: r.id, kind: "reminder", title: r.title,
        start: r.scheduled_at, notes: r.body, subtitle: r.body || "Reminder" })),
      ...(tasks.data || []).map((r) => ({ id: `t-${r.id}`, rowId: r.id, recordId: r.record_id, kind: "task", title: r.title,
        start: r.due_at, notes: r.description, subtitle: `Task due${r.priority !== "normal" ? ` · ${r.priority}` : ""}` })),
    ]);
  }, [sb, range]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const check = ({ error: err }) => { if (err) throw new Error(err.message); };

  async function save(draft, original) {
    const { kind, title, notes, start, end } = draft;
    const fields = {
      meeting: { title, starts_at: start, ends_at: end, summary: notes },
      reminder: { title, body: notes, scheduled_at: start },
      task: { title, description: notes, due_at: start },
    }[kind];
    if (original) {
      if (kind === "reminder") check(await sb.from("reminders").update(fields).eq("id", original.rowId));
      else {
        check(await sb.from(RECORD_TABLE[kind]).update(fields).eq("id", original.rowId));
        check(await sb.from("records").update({ title, summary: notes }).eq("id", original.recordId));
      }
    } else if (kind === "reminder") {
      check(await sb.from("reminders").insert({ user_id: userId, timezone, channel: "in_app", ...fields }));
    } else {
      const { data: rec, error: recErr } = await sb.from("records")
        .insert({ user_id: userId, record_type: kind, title, summary: notes, attributes: { source: "calendar" } }).select("id").single();
      if (recErr) throw new Error(recErr.message);
      const extra = kind === "meeting" ? { timezone, source: "calendar" } : {};
      const res = await sb.from(RECORD_TABLE[kind]).insert({ user_id: userId, record_id: rec.id, ...fields, ...extra });
      if (res.error) {
        await sb.from("records").delete().eq("id", rec.id);
        throw new Error(res.error.message);
      }
    }
    await load();
    onChanged?.();
  }

  async function remove(event) {
    // Meetings and tasks hang off a record; deleting the record deletes them too.
    if (event.kind === "reminder") check(await sb.from("reminders").delete().eq("id", event.rowId));
    else check(await sb.from("records").delete().eq("id", event.recordId));
    await load();
    onChanged?.();
  }

  return (
    <CalendarPanel
      title="Calendar"
      events={events}
      kinds={CALENDAR_KINDS}
      timezone={timezone}
      loading={loading}
      error={error ? `Could not load the calendar: ${error}` : ""}
      emptyText="Nothing coming up. Use + New or tell the agent about a meeting."
      onRangeChange={setRange}
      onSave={save}
      onDelete={remove}
    />
  );
}

const SUGGESTIONS = [
  "What's on my plate this week?",
  "Find the latest emails about the Q4 audit",
  "Meeting with the Ardentax team tomorrow at 11:00 about the Q4 audit",
  "Remind me on Sunday at 09:00 to review the VAT filings",
  "We decided to hire two more tax specialists",
];

function chatStorageKey(userId) {
  return `ceo-chat-${userId}`;
}

function Chat({ sb, userId, onChanged }) {
  const [messages, setMessages] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(chatStorageKey(userId)) || "[]"); } catch { return []; }
  });
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef(null);
  const keyRef = useRef(crypto.randomUUID());
  // Saved conversations (ceo.chat_threads / ceo.chat_messages).
  const [threadId, setThreadId] = useState(() => {
    try { return sessionStorage.getItem(`${chatStorageKey(userId)}-thread`) || null; } catch { return null; }
  });
  const [showHistory, setShowHistory] = useState(false);
  const [threads, setThreads] = useState(null);
  const [historyError, setHistoryError] = useState("");
  // Talk mode: browser speech-to-text in, spoken reply out.
  const Recognition = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const spokenRef = useRef(false);

  useEffect(() => () => { recognitionRef.current?.abort(); window.speechSynthesis?.cancel(); }, []);

  useEffect(() => {
    try { sessionStorage.setItem(chatStorageKey(userId), JSON.stringify(messages.slice(-60))); } catch { /* storage off */ }
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, userId]);

  useEffect(() => {
    try {
      const k = `${chatStorageKey(userId)}-thread`;
      if (threadId) sessionStorage.setItem(k, threadId); else sessionStorage.removeItem(k);
    } catch { /* storage off */ }
  }, [threadId, userId]);

  async function openHistory() {
    setShowHistory(true);
    setHistoryError("");
    const { data, error: err } = await sb.from("chat_threads").select("id, title, updated_at").order("updated_at", { ascending: false }).limit(100);
    if (err) { setHistoryError(err.message); return; }
    setThreads(data || []);
  }

  async function openThread(id) {
    setHistoryError("");
    const { data, error: err } = await sb.from("chat_messages").select("role, content, saved").eq("thread_id", id).order("created_at").limit(500);
    if (err) { setHistoryError(err.message); return; }
    setMessages((data || []).map((m) => ({ role: m.role, content: m.content, saved: m.saved || [] })));
    setThreadId(id);
    setShowHistory(false);
    setError("");
  }

  async function deleteThread(id) {
    if (!window.confirm("Delete this conversation? The items it saved stay on the dashboard.")) return;
    const { error: err } = await sb.from("chat_threads").delete().eq("id", id);
    if (err) { setHistoryError(err.message); return; }
    setThreads((list) => (list || []).filter((t) => t.id !== id));
    if (id === threadId) { setThreadId(null); setMessages([]); }
  }

  function speak(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text.replace(/[*_#`]/g, "")));
  }

  function toggleTalk() {
    if (listening) { recognitionRef.current?.stop(); return; }
    window.speechSynthesis?.cancel();
    setError("");
    const rec = new Recognition();
    rec.lang = navigator.language || "en-GB";
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      setInput((finalText + interim).trim());
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed") setError("Microphone access was blocked. Allow it in the browser's address bar to talk.");
      else if (e.error !== "no-speech" && e.error !== "aborted") setError(`Voice input failed: ${e.error}`);
    };
    rec.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      if (finalText.trim()) { spokenRef.current = true; send(finalText); }
    };
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }

  async function send(text) {
    const content = (text ?? input).trim();
    if (!content || sending) return;
    const next = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setError("");
    setSending(true);
    const { data, error: fnError } = await sb.functions.invoke("ceo-agent", {
      body: { messages: next.map(({ role, content: c }) => ({ role, content: c })), idempotencyKey: keyRef.current, threadId },
    });
    setSending(false);
    let message = data?.error;
    if (fnError) {
      try { message = (await fnError.context?.json())?.error || fnError.message; } catch { message = fnError.message; }
    }
    const wasSpoken = spokenRef.current;
    spokenRef.current = false;
    if (message || !data?.reply) {
      setError(message || "No reply came back. Try again.");
      return;
    }
    keyRef.current = crypto.randomUUID();
    if (data.threadId) setThreadId(data.threadId);
    setMessages([...next, { role: "assistant", content: data.reply, saved: data.saved || [] }]);
    if (wasSpoken) speak(data.reply);
    if (data.changed) onChanged();
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  function clearChat() {
    setMessages([]);
    setThreadId(null);
    setShowHistory(false);
    setError("");
  }

  const historyDate = (v) => new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Dubai",
  }).format(new Date(v));

  return (
    <section className="ceo-chat" aria-label="Chat with the CEO Agent">
      <div className="ceo-chat-head">
        <div>
          <strong>CEO Agent</strong>
          <small>Ask about your saved items and synced emails, or request an unsent reply draft.</small>
        </div>
        <div className="ceo-chat-actions">
          <button className="ceo-text-btn" type="button" onClick={() => (showHistory ? setShowHistory(false) : openHistory())}>
            {showHistory ? "Back to chat" : "History"}
          </button>
          {(messages.length > 0 || showHistory) && <button className="ceo-text-btn" type="button" onClick={clearChat}>New chat</button>}
        </div>
      </div>

      {showHistory ? (
        <div className="ceo-chat-list ceo-history" aria-label="Past conversations">
          {historyError && <p className="ceo-notice ceo-error" role="alert">{historyError}</p>}
          {threads === null && !historyError && <p className="ceo-muted">Loading conversations…</p>}
          {threads?.length === 0 && <p className="ceo-panel-empty">No saved conversations yet. Chats are saved from now on.</p>}
          {threads?.map((t) => (
            <div key={t.id} className={`ceo-thread ${t.id === threadId ? "on" : ""}`}>
              <button type="button" className="ceo-thread-open" onClick={() => openThread(t.id)}>
                <b>{t.title}</b>
                <span>{historyDate(t.updated_at)}</span>
              </button>
              <button type="button" className="ceo-text-btn ceo-thread-del" onClick={() => deleteThread(t.id)} aria-label={`Delete ${t.title}`}>Delete</button>
            </div>
          ))}
        </div>
      ) : (
      <div className="ceo-chat-list" ref={listRef} aria-live="polite">
        {messages.length === 0 && (
          <div className="ceo-chat-empty">
            <p className="ceo-chat-hello">How can I help today?</p>
            <div className="ceo-chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="ceo-chip" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`ceo-msg ${m.role === "user" ? "ceo-msg-user" : "ceo-msg-bot"}`}>
            <div className="ceo-msg-body">{m.content}</div>
            {m.saved?.length > 0 && (
              <div className="ceo-saved">
                {m.saved.map((s) => (
                  <span key={s.id} className="ceo-saved-pill">Saved {s.type}: {s.title}</span>
                ))}
              </div>
            )}
          </div>
        ))}
        {sending && <div className="ceo-msg ceo-msg-bot"><div className="ceo-msg-body ceo-typing">Thinking…</div></div>}
        {error && <p className="ceo-notice ceo-error" role="alert">{error}</p>}
      </div>
      )}

      <form className="ceo-chat-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          maxLength={8000}
          placeholder={listening ? "Listening… speak now" : "Message the CEO Agent…"}
          aria-label="Message the CEO Agent"
        />
        {Recognition && (
          <button
            className={`ceo-talk-btn${listening ? " ceo-talk-on" : ""}`}
            type="button"
            onClick={toggleTalk}
            disabled={sending}
            aria-pressed={listening}
            title={listening ? "Stop listening" : "Talk to the CEO Agent"}
          >
            <span className="ceo-talk-dot" aria-hidden="true" />{listening ? "Stop" : "Talk"}
          </button>
        )}
        <button className="btn btn-primary" type="submit" disabled={sending || listening || !input.trim()}>Send</button>
      </form>
      <p className="ceo-chat-note">
        Private to you. Messages go to the AI model (DeepSeek via OpenRouter) to reply; nothing else leaves the CRM.
        {Recognition && " Talk uses your browser's speech recognition, which may process audio on the browser maker's servers."}
      </p>
    </section>
  );
}

function Dashboard({ sb, timezone, refreshKey }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const now = new Date();
    const weekAhead = new Date(now.getTime() + 7 * 864e5).toISOString();
    const [meetings, reminders, tasks, decisions, risks, ideas, people, captures] = await Promise.all([
      sb.from("meetings").select("id, title, starts_at, ends_at, summary").gte("starts_at", now.toISOString()).order("starts_at").limit(8),
      sb.from("reminders").select("id, title, body, scheduled_at").eq("delivery_status", "scheduled").order("scheduled_at").limit(8),
      sb.from("tasks").select("id, title, priority, due_at, status").not("status", "in", "(done,cancelled)").order("due_at", { nullsFirst: false }).limit(12),
      sb.from("decisions").select("id, decision_text, decided_at").eq("status", "active").order("decided_at", { ascending: false }).limit(6),
      sb.from("risks").select("id, likelihood, impact, mitigation, records(title)").in("status", ["open", "mitigating"]).limit(6),
      sb.from("ideas").select("id, status, records(title)").in("status", ["captured", "evaluating"]).order("created_at", { ascending: false }).limit(6),
      sb.from("people").select("id", { count: "exact", head: true }),
      sb.from("captures").select("id", { count: "exact", head: true }),
    ]);
    const firstError = [meetings, reminders, tasks, decisions, risks, ideas].find((r) => r.error)?.error;
    if (firstError) { setError(firstError.message); return; }
    setError("");
    const overdue = (tasks.data || []).filter((t) => t.due_at && t.due_at < now.toISOString()).length;
    const meetingsWeek = (meetings.data || []).filter((m) => m.starts_at <= weekAhead).length;
    setData({
      meetings: meetings.data || [], reminders: reminders.data || [], tasks: tasks.data || [],
      decisions: decisions.data || [], risks: risks.data || [], ideas: ideas.data || [],
      stats: { overdue, meetingsWeek, people: people.count || 0, captures: captures.count || 0 },
    });
  }, [sb]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const fmt = useMemo(() => new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }), [timezone]);
  const when = (v) => (v ? fmt.format(new Date(v)) : "No date");

  async function completeTask(id) {
    const { error: err } = await sb.from("tasks").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", id);
    if (err) setError(err.message); else load();
  }

  if (error) return <section className="ceo-dash"><p className="ceo-notice ceo-error" role="alert">Could not load the dashboard: {error}</p></section>;
  if (!data) return <section className="ceo-dash"><p className="ceo-muted">Loading dashboard…</p></section>;

  const nowIso = new Date().toISOString();
  return (
    <section className="ceo-dash" aria-label="CEO dashboard">
      <div className="ceo-stats">
        <Stat label="Meetings this week" value={data.stats.meetingsWeek} />
        <Stat label="Open tasks" value={data.tasks.length} />
        <Stat label="Overdue" value={data.stats.overdue} tone={data.stats.overdue ? "red" : ""} />
        <Stat label="Reminders" value={data.reminders.length} />
      </div>

      <div className="ceo-panels">
        <Panel title="Upcoming meetings" empty="No meetings scheduled. Tell the agent about one.">
          {data.meetings.map((m) => (
            <li key={m.id}><b>{m.title}</b><span>{when(m.starts_at)}{m.ends_at ? ` – ${fmt.format(new Date(m.ends_at)).slice(-5)}` : ""}</span>
              {m.summary && <small>{m.summary}</small>}</li>
          ))}
        </Panel>
        <Panel title="Reminders" empty="No reminders set.">
          {data.reminders.map((r) => (
            <li key={r.id}><b>{r.title}</b><span>{when(r.scheduled_at)}</span>{r.body && <small>{r.body}</small>}</li>
          ))}
        </Panel>
        <Panel title="Open tasks" empty="No open tasks.">
          {data.tasks.map((t) => (
            <li key={t.id} className="ceo-task">
              <input type="checkbox" aria-label={`Mark ${t.title} done`} onChange={() => completeTask(t.id)} />
              <div>
                <b>{t.title}</b>
                <span className={t.due_at && t.due_at < nowIso ? "ceo-late" : ""}>
                  {t.due_at ? `Due ${when(t.due_at)}` : "No due date"}{t.priority !== "normal" ? ` · ${t.priority}` : ""}
                </span>
              </div>
            </li>
          ))}
        </Panel>
        <Panel title="Recent decisions" empty="No decisions recorded.">
          {data.decisions.map((d) => (<li key={d.id}><b>{d.decision_text}</b><span>{when(d.decided_at)}</span></li>))}
        </Panel>
        <Panel title="Ideas" empty="No ideas captured.">
          {data.ideas.map((i) => (<li key={i.id}><b>{i.records?.title || "Idea"}</b><span>{i.status}</span></li>))}
        </Panel>
        <Panel title="Open risks" empty="No open risks.">
          {data.risks.map((r) => (
            <li key={r.id}><b>{r.records?.title || "Risk"}</b>
              <span>{r.likelihood && r.impact ? `Likelihood ${r.likelihood}/5 · Impact ${r.impact}/5` : "Not rated"}</span>
              {r.mitigation && <small>{r.mitigation}</small>}</li>
          ))}
        </Panel>
      </div>
      <p className="ceo-chat-note">{data.stats.people} people · {data.stats.captures} notes in memory</p>
    </section>
  );
}

function Stat({ label, value, tone = "" }) {
  return (
    <div className={`ceo-stat ${tone ? `ceo-stat-${tone}` : ""}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

function Panel({ title, empty, children }) {
  const items = Array.isArray(children) ? children : [children];
  const has = items.some(Boolean) && items.flat().length > 0;
  return (
    <div className="ceo-panel">
      <h3>{title}</h3>
      {has ? <ul>{children}</ul> : <p className="ceo-panel-empty">{empty}</p>}
    </div>
  );
}

function SetupCard() {
  return (
    <div className="ceo-root">
      <Styles />
      <section className="ceo-card ceo-narrow">
        <div className="ceo-brand"><span className="ceo-mark">CI</span><span><strong>CEO Intelligence</strong>
          <small>Private executive memory</small></span></div>
        <p className="ceo-eyebrow" style={{ marginTop: 16 }}>NOT CONNECTED YET</p>
        <h2>Connect the CEO Agent's own Supabase project.</h2>
        <p className="ceo-muted">
          By design this workspace keeps its data in a separate Supabase project, not the CRM database.
        </p>
        <ol className="ceo-steps">
          <li>Create a dedicated Supabase project (choose the region after reviewing UAE data-residency needs).</li>
          <li>Apply <code>Agent Module/11_Personal_Agent/CEO Agent/supabase/migrations/202610290001_initial_ceo_schema.sql</code>.</li>
          <li>Add <code>ceo</code> to Settings → Data API → Exposed schemas, and keep public sign-ups off.</li>
          <li>Invite the owner in Auth, then insert their row in <code>ceo.profiles</code> (see that folder's <code>CONFIGURATION.md</code>).</li>
          <li>Set <code>VITE_CEO_SUPABASE_URL</code> and <code>VITE_CEO_SUPABASE_PUBLISHABLE_KEY</code> in the Main Module <code>.env</code> and as GitHub repository secrets, then redeploy.</li>
        </ol>
      </section>
    </div>
  );
}

function Styles() {
  return (
    <style>{`
      .ceo-root { max-width: 1500px; }
      .ceo-split { display: grid; grid-template-columns: minmax(340px, 5fr) minmax(0, 7fr); gap: 16px; align-items: start; }
      .ceo-chat { position: sticky; top: 12px; display: flex; flex-direction: column; height: calc(100vh - 190px); min-height: 480px;
        background: #fff; border: 1px solid #e8e8e8; border-radius: 10px; overflow: hidden; }
      .ceo-chat-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; padding: 12px 16px; border-bottom: 1px solid #f0f0f0; }
      .ceo-chat-head strong { font-size: 14px; }
      .ceo-chat-head small { display: block; color: #6b7280; font-size: 12px; margin-top: 2px; }
      .ceo-chat-actions { display: flex; gap: 12px; flex-shrink: 0; }
      .ceo-history { gap: 4px; }
      .ceo-thread { display: flex; align-items: center; gap: 8px; border-radius: 8px; padding: 2px 6px 2px 0; }
      .ceo-thread:hover, .ceo-thread.on { background: #f3f4f6; }
      .ceo-thread-open { flex: 1; min-width: 0; display: grid; gap: 2px; text-align: left; background: none; border: none; padding: 8px 10px; cursor: pointer; font: inherit; }
      .ceo-thread-open b { font-size: 13px; font-weight: 500; color: #1f2a30; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ceo-thread-open span { font-size: 11.5px; color: #9ca3af; }
      .ceo-thread-del { font-size: 12px; color: #9ca3af; }
      .ceo-thread-del:hover { color: #b91c1c; }
      .ceo-chat-list { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
      .ceo-chat-empty { margin: auto 0; text-align: center; }
      .ceo-chat-hello { font-size: 20px; font-weight: 600; color: #1f2a30; margin: 0 0 14px; }
      .ceo-chips { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
      .ceo-chip { background: #f7f7f6; border: 1px solid #e5e7eb; border-radius: 16px; padding: 7px 12px; font-size: 12.5px; color: #374151; cursor: pointer; text-align: left; }
      .ceo-chip:hover { background: #eef2f1; }
      .ceo-msg { display: flex; flex-direction: column; max-width: 88%; }
      .ceo-msg-user { align-self: flex-end; align-items: flex-end; }
      .ceo-msg-bot { align-self: flex-start; }
      .ceo-msg-body { padding: 9px 13px; border-radius: 14px; font-size: 13.5px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
      .ceo-msg-user .ceo-msg-body { background: #1f3a4d; color: #fff; border-bottom-right-radius: 4px; }
      .ceo-msg-bot .ceo-msg-body { background: #f3f4f6; color: #1f2a30; border-bottom-left-radius: 4px; }
      .ceo-typing { color: #9ca3af !important; }
      .ceo-saved { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 5px; }
      .ceo-saved-pill { font-size: 11px; background: #dcfce7; color: #15803d; border-radius: 10px; padding: 2px 8px; }
      .ceo-chat-form { display: flex; gap: 8px; align-items: flex-end; padding: 10px 12px; border-top: 1px solid #f0f0f0; }
      .ceo-chat-form textarea { flex: 1; resize: none; font: inherit; font-size: 13.5px; padding: 9px 11px; border: 1px solid #d1d5db; border-radius: 10px; }
      .ceo-chat-note { font-size: 11px; color: #9ca3af; margin: 0; padding: 0 12px 10px; }
      .ceo-talk-btn { display: inline-flex; align-items: center; gap: 6px; height: 38px; padding: 0 13px; border: 1px solid #d1d5db; border-radius: 10px; background: #fff; color: #1f3a4d; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
      .ceo-talk-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .ceo-talk-dot { width: 9px; height: 9px; border-radius: 50%; background: #0f766e; }
      .ceo-talk-on { border-color: #fca5a5; background: #fef2f2; color: #b91c1c; }
      .ceo-talk-on .ceo-talk-dot { background: #dc2626; animation: ceo-pulse 1s ease-in-out infinite; }
      @keyframes ceo-pulse { 50% { opacity: 0.3; } }
      .ceo-dash { display: grid; gap: 14px; }
      .ceo-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
      .ceo-stat { background: #fff; border: 1px solid #e8e8e8; border-radius: 10px; padding: 12px 14px; }
      .ceo-stat b { display: block; font-size: 24px; font-weight: 600; color: #1f2a30; }
      .ceo-stat span { font-size: 12px; color: #6b7280; }
      .ceo-stat-red b { color: #b91c1c; }
      .ceo-panels { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .ceo-badge { display: inline-block; min-width: 17px; margin-left: 6px; padding: 0 5px; border-radius: 9px; background: #dc2626; color: #fff; font-size: 10.5px; font-weight: 700; line-height: 17px; text-align: center; }
      .ceo-panel { background: #fff; border: 1px solid #e8e8e8; border-radius: 10px; padding: 14px 16px; min-height: 120px; }
      .ceo-panel h3 { font-size: 12px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: #6b7280; margin: 0 0 8px; }
      .ceo-panel ul { list-style: none; margin: 0; padding: 0; display: grid; }
      .ceo-panel li { padding: 7px 0; border-top: 1px solid #f3f4f6; display: grid; gap: 2px; }
      .ceo-panel li:first-child { border-top: none; }
      .ceo-panel li b { font-size: 13px; font-weight: 500; color: #1f2a30; }
      .ceo-panel li span { font-size: 12px; color: #6b7280; }
      .ceo-panel li small { font-size: 12px; color: #9ca3af; }
      .ceo-panel .ceo-task { grid-template-columns: auto 1fr; gap: 8px; align-items: start; }
      .ceo-panel .ceo-task input { margin-top: 3px; }
      .ceo-late { color: #b91c1c !important; font-weight: 600; }
      .ceo-panel-empty { font-size: 12.5px; color: #9ca3af; margin: 8px 0 0; }
      .ceo-right { display: grid; gap: 12px; min-width: 0; }
      .ceo-view-switch { justify-self: start; }
      @media (max-width: 1100px) { .ceo-split { grid-template-columns: 1fr; } .ceo-chat { position: static; height: 560px; } }
      @media (max-width: 640px) { .ceo-stats, .ceo-panels { grid-template-columns: repeat(2, minmax(0, 1fr)); } .ceo-panels { grid-template-columns: 1fr; } }
      .ceo-top { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
      .ceo-brand { display: flex; align-items: center; gap: 10px; }
      .ceo-brand small { display: block; color: #6b7280; font-size: 12px; font-weight: 400; }
      .ceo-mark { width: 34px; height: 34px; border-radius: 8px; background: #1f3a4d; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; }
      .ceo-account { display: flex; align-items: center; gap: 10px; font-size: 13px; color: #374151; }
      .ceo-text-btn { background: none; border: none; color: var(--accent, #0d7d82); cursor: pointer; font-size: 13px; padding: 0; }
      .ceo-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
      .ceo-card { background: #fff; border: 1px solid #e8e8e8; border-radius: 10px; padding: 18px; }
      .ceo-card h2 { font-size: 17px; margin: 2px 0 8px; }
      .ceo-narrow { max-width: 480px; }
      .ceo-eyebrow { font-size: 11px; letter-spacing: 0.08em; color: #6b7280; font-weight: 700; margin: 0; }
      .ceo-muted { color: #6b7280; font-size: 13px; line-height: 1.5; }
      .ceo-note { color: #9ca3af; font-size: 12px; line-height: 1.5; }
      .ceo-form { display: grid; gap: 12px; margin-top: 8px; }
      .ceo-form label, .ceo-label { display: grid; gap: 5px; font-size: 12.5px; font-weight: 600; color: #374151; }
      .ceo-form input, .ceo-label textarea { font: inherit; font-size: 13.5px; font-weight: 400; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 6px; }
      .ceo-label textarea { resize: vertical; }
      .ceo-section-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 10px; }
      .ceo-switch { display: inline-flex; border: 1px solid #e5e7eb; border-radius: 7px; overflow: hidden; }
      .ceo-switch button { background: #fff; border: none; padding: 6px 12px; font-size: 12.5px; cursor: pointer; color: #6b7280; }
      .ceo-switch button.on { background: #1f3a4d; color: #fff; }
      .ceo-voice { display: grid; gap: 10px; justify-items: start; }
      .ceo-dot { display: inline-block; width: 9px; height: 9px; border-radius: 9px; background: #b91c1c; margin-right: 6px; }
      .ceo-dot-live { animation: ceo-pulse 1s infinite; }
      @keyframes ceo-pulse { 50% { opacity: 0.3; } }
      .ceo-audio { display: flex; gap: 12px; align-items: center; font-size: 13px; }
      .ceo-actions { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; gap: 10px; }
      .ceo-notice { font-size: 13px; border-radius: 7px; padding: 9px 12px; margin: 10px 0 0; }
      .ceo-error { background: #fee2e2; color: #b91c1c; }
      .ceo-ok { background: #dcfce7; color: #15803d; }
      .ceo-count { background: #f3f4f6; border-radius: 20px; padding: 2px 10px; font-size: 12px; font-weight: 600; }
      .ceo-empty { color: #9ca3af; font-size: 13px; padding: 24px 0; text-align: center; }
      .ceo-list { list-style: none; margin: 0; padding: 0; display: grid; }
      .ceo-row { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-top: 1px solid #f3f4f6; }
      .ceo-row-copy p { margin: 0 0 3px; font-size: 13.5px; white-space: pre-wrap; overflow-wrap: anywhere; }
      .ceo-row-copy time { font-size: 11.5px; color: #9ca3af; }
      .ceo-error-text { display: block; color: #b91c1c; font-size: 12px; }
      .ceo-status { align-self: flex-start; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 20px; background: #f3f4f6; color: #4b5563; white-space: nowrap; text-transform: capitalize; }
      .ceo-status-completed, .ceo-status-saved { background: #dcfce7; color: #15803d; }
      .ceo-status-failed { background: #fee2e2; color: #b91c1c; }
      .ceo-status-accepted { background: #e0f2fe; color: #075985; }
      .ceo-qr { width: 180px; height: 180px; display: block; margin: 8px 0; }
      .ceo-steps { font-size: 13px; color: #374151; line-height: 1.6; padding-left: 18px; }
      .ceo-steps code, .ceo-muted code { font-size: 12px; }
      .ceo-foot { color: #9ca3af; font-size: 12px; margin-top: 16px; }
      @media (max-width: 900px) { .ceo-grid { grid-template-columns: 1fr; } }
    `}</style>
  );
}
