import { useEffect, useState } from "react";
import { callLeadSources, fetchLatestPlatformReplyDraft } from "../logic/businessDevelopmentData";

const mailDate = (value) => value ? new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Dubai", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
}).format(new Date(value)) : "";

export default function LeadMailboxPane({ prospect, onClose, onSaved, onSent }) {
  const [thread, setThread] = useState(null);
  const [threadError, setThreadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [draftId, setDraftId] = useState("");
  const [body, setBody] = useState("");
  const [draftSaved, setDraftSaved] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [redraftOpen, setRedraftOpen] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [redraft, setRedraft] = useState("");
  const [sendConfirmation, setSendConfirmation] = useState(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [sendSuccess, setSendSuccess] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setThreadError("");
    Promise.all([
      callLeadSources("thread", { prospect_id: prospect.id }),
      fetchLatestPlatformReplyDraft(prospect.id),
    ]).then(([threadResult, draftResult]) => {
      if (!active) return;
      if (threadResult.error) setThreadError(threadResult.error.message);
      else setThread(threadResult.data);
      if (draftResult.error) setError(`Could not load your saved draft: ${draftResult.error.message}`);
      else if (draftResult.data) {
        setDraftId(draftResult.data.id);
        setBody(draftResult.data.body_text || "");
        setDraftSaved(true);
      }
    }).catch((loadError) => {
      if (active) setThreadError(loadError.message || "Could not load the email conversation.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [prospect.id]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  async function saveDraft() {
    if (body.length > 10000) {
      setError("Reply must be 10,000 characters or fewer.");
      return null;
    }
    setBusy("save");
    setError("");
    const { data, error: saveError } = await callLeadSources("save_draft", {
      prospect_id: prospect.id, draft_id: draftId || undefined, body_text: body,
    });
    setBusy("");
    if (saveError) {
      setError(saveError.message);
      return null;
    }
    setDraftId(data.draft.id);
    setDraftSaved(true);
    onSaved();
    return data.draft;
  }

  async function generateRedraft() {
    const draft = await saveDraft();
    if (!draft) return;
    setBusy("redraft");
    setError("");
    const { data, error: redraftError } = await callLeadSources("redraft_reply", {
      prospect_id: prospect.id, draft_id: draft.id, instructions,
    });
    setBusy("");
    if (redraftError) {
      setError(redraftError.message);
      return;
    }
    setRedraft(data.body_text);
  }

  async function prepareSend() {
    if (!body.trim()) {
      setError("Write a reply before sending.");
      return;
    }
    const draft = await saveDraft();
    if (!draft) return;
    setBusy("prepare");
    setError("");
    const { data, error: prepareError } = await callLeadSources("prepare_send", { draft_id: draft.id });
    setBusy("");
    if (prepareError) {
      setError(prepareError.message);
      return;
    }
    setVerificationCode("");
    setSendConfirmation(data);
  }

  async function sendReply() {
    if (!sendConfirmation || verificationCode !== sendConfirmation.confirmation_code) return;
    setBusy("send");
    setError("");
    const { data, error: sendError } = await callLeadSources("send_draft", {
      draft_id: draftId, confirm: "SEND", verification_code: verificationCode,
    });
    setBusy("");
    if (sendError) {
      setError(sendError.message);
      return;
    }
    setSendConfirmation(null);
    setSendSuccess(true);
    if (data?.warning) setError(data.warning);
    onSent();
  }

  const messages = thread?.messages || [];
  const subject = [...messages].reverse().find((message) => message.type !== "sent" && message.subject)?.subject
    || messages.find((message) => message.subject)?.subject
    || `Re: ${prospect.campaign_name || "Your enquiry"}`;

  return (
    <div className="bd-mailbox-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <aside className="bd-mailbox-pane" role="dialog" aria-modal="true" aria-labelledby="bd-mailbox-title">
        <header className="bd-mailbox-header">
          <div>
            <span className="bd-mailbox-eyebrow">Explee conversation{draftSaved && !sendSuccess ? " · Draft saved" : ""}</span>
            <h2 id="bd-mailbox-title">{prospect.name || "Prospect"}</h2>
            <p>{prospect.email || "No email address"}</p>
          </div>
          <button type="button" className="bd-mailbox-close" onClick={onClose} aria-label="Close mailbox">×</button>
        </header>

        <div className="bd-mailbox-subject"><span>Subject</span><strong>{subject}</strong></div>

        <div className="bd-mailbox-thread" aria-label="Email conversation">
          {loading && <div className="bd-mailbox-loading"><span className="bd-spinner" /> Loading conversation…</div>}
          {threadError && <p className="bd-inline-error">{threadError}</p>}
          {!loading && !threadError && !messages.length && <p className="bd-mailbox-empty">No messages were returned for this conversation.</p>}
          {messages.map((message, index) => {
            const sent = message.type === "sent";
            return (
              <article className={`bd-mailbox-message ${sent ? "outbound" : ""}`} key={message.id || `${message.ts || "message"}-${index}`}>
                <div className="bd-mailbox-message-meta">
                  <strong>{sent ? "You" : message.from_name || prospect.name || "Prospect"}</strong>
                  <span>{mailDate(message.ts)}</span>
                </div>
                <small>{sent ? `To: ${message.to_email || prospect.email}` : `From: ${message.from_email || prospect.email}`}</small>
                {message.subject && <b className="bd-mailbox-message-subject">{message.subject}</b>}
                <p>{message.body_text || "(This message has no text body.)"}</p>
              </article>
            );
          })}
        </div>

        {thread?.can_reply === false && (
          <p className="bd-mailbox-blocked">{thread.reply_blocked_reason || "Replies are not available for this conversation."}</p>
        )}
        {error && <p className="bd-inline-error bd-mailbox-error" role="alert">{error}</p>}

        <section className="bd-mailbox-composer" aria-label="Reply composer">
          <div className="bd-mailbox-compose-to"><b>To</b><span>{prospect.name ? `${prospect.name} · ` : ""}{prospect.email || "No email address"}</span></div>
          <textarea
            aria-label="Reply message"
            maxLength={10000}
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
              setDraftSaved(false);
            }}
            placeholder="Write your reply…"
          />
          <div className="bd-mailbox-compose-footer">
            <span>{draftSaved ? "Draft saved" : "Unsaved changes"} · {body.length.toLocaleString("en-GB")} / 10,000</span>
            <div>
              <button type="button" className="bd-button bd-button-secondary" onClick={saveDraft} disabled={!!busy}>
                {busy === "save" ? "Saving…" : draftSaved ? "Save changes" : "Save draft"}
              </button>
              <button type="button" className="bd-button bd-button-secondary" onClick={() => { setRedraft(""); setRedraftOpen(true); }} disabled={!!busy || !body.trim()}>
                Redraft with AI
              </button>
              <button type="button" className="bd-button bd-button-primary" onClick={prepareSend}
                disabled={!!busy || !body.trim() || !prospect.email || thread?.can_reply === false}>
                {busy === "prepare" ? "Preparing…" : "Send"}
              </button>
            </div>
          </div>
        </section>
      </aside>

      {redraftOpen && (
        <div className="bd-mailbox-modal-backdrop">
          <section className="bd-mailbox-modal" role="dialog" aria-modal="true" aria-labelledby="bd-redraft-title">
            <header><div><h3 id="bd-redraft-title">Redraft reply</h3><p>OpenRouter will rewrite your entire reply using the conversation for context.</p></div>
              <button type="button" className="bd-mailbox-close" onClick={() => setRedraftOpen(false)} aria-label="Close redraft">×</button></header>
            <label className="bd-mailbox-field">How should the reply read?
              <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} maxLength={2000}
                placeholder="For example: Make it warmer and concise, and suggest a call next week." />
            </label>
            <p className="bd-mailbox-privacy">Your draft and conversation are sent to OpenRouter only when you choose Redraft. Nothing is sent to the prospect.</p>
            {redraft && <label className="bd-mailbox-field">AI rewrite — review and edit before using
              <textarea className="bd-mailbox-redraft-output" value={redraft} onChange={(event) => setRedraft(event.target.value)} maxLength={10000} />
            </label>}
            <footer>
              <button type="button" className="bd-button bd-button-secondary" onClick={() => setRedraftOpen(false)}>Cancel</button>
              {redraft && <button type="button" className="bd-button bd-button-secondary" onClick={() => { setBody(redraft); setRedraftOpen(false); }}>Use this rewrite</button>}
              <button type="button" className="bd-button bd-button-primary" onClick={generateRedraft} disabled={!!busy}>
                {busy === "redraft" ? "Redrafting…" : "Redraft with OpenRouter"}
              </button>
            </footer>
          </section>
        </div>
      )}

      {(sendConfirmation || sendSuccess) && (
        <div className="bd-mailbox-modal-backdrop">
          <section className="bd-mailbox-modal bd-mailbox-send-modal" role="dialog" aria-modal="true" aria-labelledby="bd-send-title">
            <header><div><h3 id="bd-send-title">{sendSuccess ? "Reply sent" : "Confirm sending reply"}</h3>
              <p>{sendSuccess ? "Your message was sent successfully." : "Review the recipient and enter the one-time code to send this email."}</p></div>
              {!sendSuccess && <button type="button" className="bd-mailbox-close" onClick={() => setSendConfirmation(null)} aria-label="Cancel send">×</button>}
            </header>
            <div className="bd-mailbox-recipient">
              <span>Sending mail to</span>
              <strong>{sendConfirmation?.recipient_name || prospect.name || "Prospect"}</strong>
              <span>{sendConfirmation?.recipient_email || prospect.email}</span>
            </div>
            {sendConfirmation && !sendSuccess && <>
              <div className="bd-mailbox-send-preview"><b>Message preview</b><p>{body}</p></div>
              <p className="bd-mailbox-code-label">Human verification code — enter this code to confirm</p>
              <div className="bd-mailbox-code">{sendConfirmation.confirmation_code}</div>
              <label className="bd-mailbox-field">Enter the 6-digit code
                <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={verificationCode}
                  onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
              </label>
              <small className="bd-mailbox-expiry">Code expires at {mailDate(sendConfirmation.expires_at)} Dubai time. No email is sent until you click Send reply below.</small>
            </>}
            {sendSuccess && <p className="bd-mailbox-sent-note">Sent to {sendConfirmation?.recipient_name || prospect.name || prospect.email}.</p>}
            {error && <p className="bd-inline-error" role="alert">{error}</p>}
            <footer>
              {sendSuccess ? (
                <button type="button" className="bd-button bd-button-primary" onClick={onClose}>Done</button>
              ) : <>
                <button type="button" className="bd-button bd-button-secondary" onClick={() => setSendConfirmation(null)} disabled={!!busy}>Cancel</button>
                <button type="button" className="bd-button bd-button-primary" onClick={sendReply}
                  disabled={!!busy || verificationCode !== sendConfirmation?.confirmation_code}>
                  {busy === "send" ? "Sending…" : "Send reply"}
                </button>
              </>}
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
