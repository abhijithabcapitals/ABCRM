import { useEffect, useState } from "react";
import {
  callLeadSources, fetchLatestPlatformReplyDraft, fetchMyEmailSignatures, savePlatformReplyDraft,
} from "../logic/businessDevelopmentData";

// The chosen signature is kept as the last block of the reply text, so the saved draft is exactly what is sent.
const signatureText = (signature) => signature.body_text.trim();
const endsWithSignature = (text, signature) => !!signature && text.trimEnd().endsWith(signatureText(signature));
const stripSignature = (text, signature) => (endsWithSignature(text, signature)
  ? text.trimEnd().slice(0, -signatureText(signature).length).trimEnd()
  : text);
const appendSignature = (text, signature) => `${text.trimEnd()}${text.trim() ? "\n\n" : ""}${signatureText(signature)}`;

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
  const [instructions, setInstructions] = useState("");
  const [appliedRedraft, setAppliedRedraft] = useState(null);
  const [signatures, setSignatures] = useState([]);
  const [signatureId, setSignatureId] = useState("");
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
      fetchMyEmailSignatures(),
    ]).then(([threadResult, draftResult, signatureResult]) => {
      if (!active) return;
      if (threadResult.error) setThreadError(threadResult.error.message);
      else setThread(threadResult.data);
      const mySignatures = signatureResult.error ? [] : signatureResult.data || [];
      setSignatures(mySignatures);
      if (signatureResult.error) setError(`Could not load your signatures: ${signatureResult.error.message}`);
      if (draftResult.error) setError(`Could not load your saved draft: ${draftResult.error.message}`);
      else if (draftResult.data) {
        const savedText = draftResult.data.body_text || "";
        setDraftId(draftResult.data.id);
        setBody(savedText);
        setDraftSaved(true);
        const used = mySignatures.find((signature) => endsWithSignature(savedText, signature));
        if (used) setSignatureId(used.id);
      } else {
        const preferred = mySignatures.find((signature) => signature.is_default);
        if (preferred) {
          setSignatureId(preferred.id);
          setBody(appendSignature("", preferred));
        }
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
    const { data, error: saveError } = await savePlatformReplyDraft(prospect.id, draftId, body);
    setBusy("");
    if (saveError) {
      setError(saveError.message);
      return null;
    }
    setDraftId(data.draft.id);
    setDraftSaved(true);
    if (data.warning) setError(data.warning);
    onSaved();
    return data.draft;
  }

  // Redrafting again rewrites the user's original text, not the previous rewrite, so each click gives a fresh alternative.
  async function generateRedraft() {
    // The signature is taken off before the rewrite and put back after it, so the AI never changes it.
    const source = appliedRedraft && body === appliedRedraft.text ? appliedRedraft.original : body;
    const message = stripSignature(source, selectedSignature);
    if (!message.trim()) {
      setError("Write a reply before asking for a redraft.");
      return;
    }
    setBusy("redraft");
    setError("");
    const { data, error: redraftError } = await callLeadSources("redraft_reply", {
      prospect_id: prospect.id, body_text: message, instructions,
    });
    setBusy("");
    if (redraftError) {
      setError(redraftError.message);
      return;
    }
    const rewritten = endsWithSignature(source, selectedSignature) ? appendSignature(data.body_text, selectedSignature) : data.body_text;
    setBody(rewritten);
    setAppliedRedraft({ original: source, text: rewritten });
    setDraftSaved(false);
  }

  function chooseSignature(id) {
    const next = signatures.find((signature) => signature.id === id) || null;
    setBody((current) => {
      const withoutOld = stripSignature(current, selectedSignature);
      return next ? appendSignature(withoutOld, next) : withoutOld;
    });
    setSignatureId(id);
    setAppliedRedraft(null);
    setDraftSaved(false);
  }

  function undoRedraft() {
    setBody(appliedRedraft.original);
    setAppliedRedraft(null);
    setDraftSaved(false);
  }

  const showUndo = appliedRedraft && body === appliedRedraft.text;
  const selectedSignature = signatures.find((signature) => signature.id === signatureId) || null;
  const signed = endsWithSignature(body, selectedSignature);
  const hasMessage = !!stripSignature(body, selectedSignature).trim();
  const sendBlockedReason = !selectedSignature ? "Choose a signature first."
    : !signed ? "The selected signature must stay at the end of the reply."
      : !hasMessage ? "Write a reply above your signature." : "";

  async function prepareSend() {
    if (sendBlockedReason) {
      setError(sendBlockedReason);
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
              if (appliedRedraft && event.target.value !== appliedRedraft.text) setAppliedRedraft(null);
            }}
            placeholder="Write your reply…"
          />
          <input
            className="bd-mailbox-redraft-instructions"
            aria-label="Redraft instructions"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            maxLength={2000}
            placeholder="Optional redraft instructions, e.g. warmer and concise, suggest a call next week"
          />
          <div className="bd-mailbox-signature">
            <label>Signature
              <select value={signatureId} onChange={(event) => chooseSignature(event.target.value)} disabled={!!busy}>
                <option value="">{signatures.length ? "Choose a signature…" : "No signatures yet"}</option>
                {signatures.map((signature) => <option key={signature.id} value={signature.id}>{signature.name}</option>)}
              </select>
            </label>
            {selectedSignature?.logo_url && <img src={selectedSignature.logo_url} alt="" title="Logo preview. Explee sends plain-text replies, so the logo is not included in the email." />}
            {!signatures.length && <span>Add one in Profile › Mail (click your name at the bottom of the sidebar).</span>}
            {selectedSignature && !signed && <span className="bd-mailbox-signature-warn">Signature edited or removed. Choose it again to re-add it.</span>}
          </div>
          <div className="bd-mailbox-compose-footer">
            <span>{draftSaved ? "Draft saved" : "Unsaved changes"} · {body.length.toLocaleString("en-GB")} / 10,000</span>
            <div>
              <button type="button" className="bd-button bd-button-secondary" onClick={saveDraft} disabled={!!busy}>
                {busy === "save" ? "Saving…" : draftSaved ? "Save changes" : "Save draft"}
              </button>
              <button type="button" className="bd-button bd-button-secondary" onClick={generateRedraft} disabled={!!busy || !body.trim()}
                title="Sends your text and the recent conversation to OpenRouter for a rewrite. Nothing is sent to the prospect.">
                {busy === "redraft" ? "Redrafting…" : showUndo ? "Redraft again" : "Redraft with AI"}
              </button>
              {showUndo && (
                <button type="button" className="bd-button bd-button-secondary" onClick={undoRedraft} disabled={!!busy}>
                  Undo
                </button>
              )}
              <button type="button" className="bd-button bd-button-primary" onClick={prepareSend} title={sendBlockedReason || undefined}
                disabled={!!busy || !!sendBlockedReason || !prospect.email || thread?.can_reply === false}>
                {busy === "prepare" ? "Preparing…" : "Send"}
              </button>
            </div>
          </div>
        </section>
      </aside>

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
