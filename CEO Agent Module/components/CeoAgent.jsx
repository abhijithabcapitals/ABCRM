import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

// CEO Agent workspace, ported from Agent Module/11_Personal_Agent/CEO Agent.
// It talks ONLY to the CEO Agent's own Supabase project (schema "ceo"), never
// to the CRM database, and keeps its own sign-in separate from the CRM's.

let cachedClient = null;
function getClient(url, key) {
  if (!cachedClient || cachedClient.url !== url) {
    cachedClient = {
      url,
      client: createClient(url, key, {
        db: { schema: "ceo" },
        auth: { storageKey: "ceo-agent-auth", persistSession: true, autoRefreshToken: true },
      }),
    };
  }
  return cachedClient.client;
}

export default function CeoAgent({ supabaseUrl, publishableKey }) {
  if (!supabaseUrl || !publishableKey) return <SetupCard />;
  return <Workspace sb={getClient(supabaseUrl, publishableKey)} />;
}

function Workspace({ sb }) {
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
            <small>Private executive memory · separate from the CRM database</small>
          </span>
        </div>
        {user && (
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
  const [captures, setCaptures] = useState([]);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await sb
      .from("captures")
      .select("id, input_text, transcript, audio_path, status, created_at, error_message")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) { setLoadError(error.message); return; }
    setLoadError("");
    setCaptures(data || []);
  }, [sb]);

  useEffect(() => { load(); }, [load]);

  const fmt = useMemo(
    () => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }),
    [timezone],
  );

  return (
    <div className="ceo-grid">
      <Capture sb={sb} userId={userId} onSaved={load} />
      <section className="ceo-card">
        <div className="ceo-section-head">
          <div>
            <p className="ceo-eyebrow">RECENT CAPTURES</p>
            <h2>Your saved thoughts</h2>
          </div>
          <span className="ceo-count">{captures.length}</span>
        </div>
        {loadError ? (
          <p className="ceo-notice ceo-error" role="alert">Could not load saved captures: {loadError}</p>
        ) : !captures.length ? (
          <div className="ceo-empty">Your saved captures will appear here.</div>
        ) : (
          <ul className="ceo-list">
            {captures.map((c) => (
              <li key={c.id} className="ceo-row">
                <div className="ceo-row-copy">
                  <p>{c.input_text || c.transcript || (c.audio_path ? "Voice recording saved" : "Capture received")}</p>
                  <time dateTime={c.created_at}>{fmt.format(new Date(c.created_at))}</time>
                  {c.error_message && <small className="ceo-error-text">{c.error_message}</small>}
                </div>
                <span className={`ceo-status ceo-status-${c.status}`}>{c.status.replaceAll("_", " ")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Capture({ sb, userId, onSaved }) {
  const [mode, setMode] = useState("text");
  const [text, setText] = useState("");
  const [audioFile, setAudioFile] = useState(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const keyRef = useRef(crypto.randomUUID());

  useEffect(() => () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const resetKey = () => { keyRef.current = crypto.randomUUID(); };

  async function startRecording() {
    setError("");
    setStatus("");
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError("Voice recording is not supported by this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const ext = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm";
        setAudioFile(new File([blob], `voice-note.${ext}`, { type: blob.type || "audio/webm" }));
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setRecording(false);
      };
      recorder.start();
      setRecording(true);
      setAudioFile(null);
      setText("");
      resetKey();
    } catch (cause) {
      setError(`Could not start recording: ${cause?.message || cause}`);
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  async function save() {
    const body = text.trim();
    if (audioFile) {
      setError("Voice uploads are not enabled yet. Configure an audio retention policy and cleanup worker before storing recordings.");
      return;
    }
    if (!body) { setError("Add a note before saving."); return; }
    setBusy(true);
    setError("");
    setStatus("");
    const { error: insertError } = await sb
      .from("captures")
      .insert({ user_id: userId, idempotency_key: keyRef.current, input_text: body });
    let failure = insertError && insertError.code !== "23505" ? insertError : null;
    if (insertError?.code === "23505") {
      // Same submission already saved (retry after a network blip): confirm it exists.
      const { error: lookupError } = await sb
        .from("captures").select("id").eq("user_id", userId).eq("idempotency_key", keyRef.current).single();
      failure = lookupError;
    }
    setBusy(false);
    if (failure) { setError(`Could not save the capture: ${failure.message}`); return; }
    setText("");
    resetKey();
    setStatus("Capture saved. Structured extraction is not configured yet.");
    onSaved();
  }

  return (
    <section className="ceo-card" aria-labelledby="ceo-capture-heading">
      <div className="ceo-section-head">
        <div>
          <p className="ceo-eyebrow">QUICK CAPTURE</p>
          <h2 id="ceo-capture-heading">What's on your mind?</h2>
        </div>
        <div className="ceo-switch" role="group" aria-label="Capture type">
          <button type="button" aria-pressed={mode === "text"} className={mode === "text" ? "on" : ""} onClick={() => setMode("text")}>Write</button>
          <button type="button" aria-pressed={mode === "voice"} className={mode === "voice" ? "on" : ""} onClick={() => setMode("voice")}>Voice</button>
        </div>
      </div>

      {mode === "text" ? (
        <label className="ceo-label">Private note
          <textarea rows={6} maxLength={20000} value={text} placeholder="A decision, follow-up, idea or commitment…"
            onChange={(e) => { setText(e.target.value); resetKey(); setError(""); setStatus(""); }} />
        </label>
      ) : (
        <div className="ceo-voice">
          <p className="ceo-muted">Recording starts only when you press the button. It stays in this page and is not uploaded.</p>
          {!recording && !audioFile && (
            <button className="btn" type="button" onClick={startRecording}><span className="ceo-dot" /> Start recording</button>
          )}
          {recording && (
            <button className="btn" type="button" onClick={stopRecording}><span className="ceo-dot ceo-dot-live" /> Stop recording</button>
          )}
          {audioFile && (
            <div className="ceo-audio">
              <span>{audioFile.name} · {(audioFile.size / 1024).toFixed(0)} KB</span>
              <button className="ceo-text-btn" type="button" onClick={() => { setAudioFile(null); setStatus(""); resetKey(); }}>Remove</button>
            </div>
          )}
          <p className="ceo-note">Voice upload is locked until an audio-retention policy and cleanup worker are configured. Speech-to-text is not configured.</p>
        </div>
      )}

      <div className="ceo-actions">
        <span className="ceo-muted">{mode === "text" ? `${text.length}/20,000` : "Private by default"}</span>
        <button className="btn btn-primary" type="button" onClick={save}
          disabled={busy || recording || !text.trim() || Boolean(audioFile)}>
          {busy ? "Saving…" : "Save capture"}
        </button>
      </div>
      {status && <p className="ceo-notice ceo-ok" role="status">{status}</p>}
      {error && <p className="ceo-notice ceo-error" role="alert">{error}</p>}
    </section>
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
      .ceo-root { max-width: 1100px; }
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
