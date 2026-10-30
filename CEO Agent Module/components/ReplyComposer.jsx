import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Reply composer for one Inbox conversation, with the same flow as the Business
// Development reply mailer: save draft, AI redraft with instructions and undo,
// signature picker, and sending only after a one-time confirmation code. Mail is
// sent by the ceo-mail-reply Edge Function, from the mailbox the chosen signature
// names, or else from the conversation's own mailbox.

// The chosen signature is kept as the last block of the reply text, so the saved draft is exactly what is sent.
const signatureText = (signature) => signature.body_text.trim();
const endsWithSignature = (text, signature) => !!signature && text.trimEnd().endsWith(signatureText(signature));
const stripSignature = (text, signature) => (endsWithSignature(text, signature)
  ? text.trimEnd().slice(0, -signatureText(signature).length).trimEnd()
  : text);
// Five blank lines above the signature give room to write; prepareSend tidies them to one before sending.
const DRAFT_GAP = "\n".repeat(6);
const appendSignature = (text, signature) => `${text.trimEnd()}${DRAFT_GAP}${signatureText(signature)}`;
const finalReply = (text, signature) => `${stripSignature(text, signature).trim()}\n\n${signatureText(signature)}`;
const listText = (list) => (list || []).join(", ");

// Signatures are shared across the organization: the user's own come first, another person's are
// labelled with their name, and only the user's own default is selected automatically.
function shapeSharedSignatures(rows, userId) {
  return rows
    .map((s) => {
      const mine = s.user_id === userId;
      const owner = s.owner?.full_name || s.owner?.email || "a colleague";
      return { ...s, mine, is_default: mine && s.is_default, label: mine ? s.name : `${s.name} (shared by ${owner})` };
    })
    .sort((a, b) => Number(b.mine) - Number(a.mine));
}

export default function ReplyComposer({ sb, thread, when, onClose, onSent }) {
  const [loading, setLoading] = useState(true);
  const [mailbox, setMailbox] = useState(null);
  const [senders, setSenders] = useState([]);
  const [replyAllCc, setReplyAllCc] = useState([]);
  const [draftId, setDraftId] = useState("");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [draftedBy, setDraftedBy] = useState("person");
  const [draftSaved, setDraftSaved] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [instructions, setInstructions] = useState("");
  const [appliedRedraft, setAppliedRedraft] = useState(null);
  const [signatures, setSignatures] = useState([]);
  const [signatureId, setSignatureId] = useState("");
  const [sendConfirmation, setSendConfirmation] = useState(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [sendSuccess, setSendSuccess] = useState(false);
  const [view, setView] = useState("normal"); // normal | minimized | maximized
  const [showCc, setShowCc] = useState(false);
  const [showAi, setShowAi] = useState(false);

  async function call(action, payload) {
    const { data, error: fnError } = await sb.functions.invoke("ceo-mail-reply", { body: { action, ...payload } });
    if (fnError) {
      let message = fnError.message;
      try { message = (await fnError.context?.json())?.error || message; } catch { /* keep the generic message */ }
      return { error: { message } };
    }
    if (data?.error) return { error: { message: data.error } };
    return { data };
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      call("context", { thread_id: thread.id }),
      // The organization's shared Profile › Mail signatures, as in the Business Development composer (public schema).
      sb.schema("public").from("email_signatures")
        .select("id, user_id, name, body_text, logo_url, is_default, sender_mailbox_address, owner:profiles(full_name, email)").order("created_at"),
      sb.auth.getSession(),
    ]).then(([context, signatureResult, sessionResult]) => {
      if (!active) return;
      const mySignatures = signatureResult.error ? [] : shapeSharedSignatures(signatureResult.data || [], sessionResult?.data?.session?.user?.id);
      setSignatures(mySignatures);
      if (signatureResult.error) setError(`Could not load your signatures: ${signatureResult.error.message}`);
      if (context.error) { setError(context.error.message); return; }
      const { mailbox: box, senders: sendable, defaults, draft, agent_draft: agentDraft } = context.data;
      setMailbox(box);
      setSenders(sendable || []);
      setReplyAllCc(defaults.reply_all_cc || []);
      if (draft) {
        setDraftId(draft.id);
        setTo(listText(draft.to_addresses));
        setCc(listText(draft.cc_addresses));
        setSubject(draft.subject);
        setBody(draft.body_text || "");
        setDraftedBy(draft.drafted_by);
        setDraftSaved(true);
        const used = mySignatures.find((signature) => signature.id === draft.signature_id && endsWithSignature(draft.body_text || "", signature));
        if (used) setSignatureId(used.id);
        if (draft.status === "failed") setError(`The last send attempt failed: ${draft.error || "unknown error"}. Review and send again.`);
        return;
      }
      setTo(listText(agentDraft?.to_address ? [agentDraft.to_address] : defaults.to));
      setSubject(agentDraft?.subject || defaults.subject);
      const preferred = mySignatures.find((signature) => signature.is_default);
      const start = agentDraft?.body || "";
      if (agentDraft) {
        setDraftedBy("ceo_agent");
        setNotice("Loaded the reply the CEO Agent drafted for this conversation. Review it before sending.");
      }
      if (preferred) {
        setSignatureId(preferred.id);
        setBody(endsWithSignature(start, preferred) ? start : appendSignature(start, preferred));
      } else {
        setBody(start);
      }
    }).catch((loadError) => {
      if (active) setError(loadError.message || "Could not prepare the reply.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.id]);

  const selectedSignature = signatures.find((signature) => signature.id === signatureId) || null;
  const showUndo = appliedRedraft && body === appliedRedraft.text;
  const signed = endsWithSignature(body, selectedSignature);
  const hasMessage = !!stripSignature(body, selectedSignature).trim();
  const fromAddress = selectedSignature?.sender_mailbox_address || mailbox?.address;
  const canSend = selectedSignature?.sender_mailbox_address ? senders.includes(fromAddress) : mailbox?.can_send;
  const sendBlockedReason = !canSend ? `Sending is not set up for ${fromAddress || "this mailbox"}.`
    : !to.trim() ? "Add at least one recipient."
      : !selectedSignature ? "Choose a signature first."
        : !signed ? "The selected signature must stay at the end of the reply."
          : !hasMessage ? "Write a reply above your signature." : "";

  function edited() {
    setDraftSaved(false);
    setNotice("");
  }

  async function saveDraft(text) {
    const content = typeof text === "string" ? text : body; // a button click passes an event
    if (content.length > 10000) {
      setError("Reply must be 10,000 characters or fewer.");
      return null;
    }
    setBusy("save");
    setError("");
    const { data, error: saveError } = await call("save_draft", {
      thread_id: thread.id, draft_id: draftId || undefined, to, cc, subject, body_text: content,
      signature_id: signatureId || null, drafted_by: draftedBy,
    });
    setBusy("");
    if (saveError) {
      setError(saveError.message);
      return null;
    }
    setDraftId(data.draft.id);
    setDraftSaved(true);
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
    const { data, error: redraftError } = await call("redraft_reply", { thread_id: thread.id, body_text: message, instructions });
    setBusy("");
    if (redraftError) {
      setError(redraftError.message);
      return;
    }
    const rewritten = endsWithSignature(source, selectedSignature) ? appendSignature(data.body_text, selectedSignature) : data.body_text;
    setBody(rewritten);
    setAppliedRedraft({ original: source, text: rewritten });
    edited();
  }

  function chooseSignature(id) {
    const next = signatures.find((signature) => signature.id === id) || null;
    setBody((current) => {
      const withoutOld = stripSignature(current, selectedSignature);
      return next ? appendSignature(withoutOld, next) : withoutOld;
    });
    setSignatureId(id);
    setAppliedRedraft(null);
    edited();
  }

  function undoRedraft() {
    setBody(appliedRedraft.original);
    setAppliedRedraft(null);
    edited();
  }

  function replyAll() {
    const current = cc.split(/[,;\s]+/).filter(Boolean);
    setCc(listText([...new Set([...current, ...replyAllCc])]));
    edited();
  }

  async function discardDraft() {
    if (!window.confirm("Discard this reply draft?")) return;
    if (draftId) {
      setBusy("discard");
      const { error: discardError } = await call("discard_draft", { draft_id: draftId });
      setBusy("");
      if (discardError) { setError(discardError.message); return; }
    }
    onClose();
  }

  async function prepareSend() {
    if (sendBlockedReason) {
      setError(sendBlockedReason);
      return;
    }
    const finalText = finalReply(body, selectedSignature);
    setBody(finalText);
    const draft = await saveDraft(finalText);
    if (!draft) return;
    setBusy("prepare");
    setError("");
    const { data, error: prepareError } = await call("prepare_send", { draft_id: draft.id });
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
    const { data, error: sendError } = await call("send_draft", { draft_id: draftId, confirm: "SEND", verification_code: verificationCode });
    setBusy("");
    if (sendError) {
      setError(sendError.message);
      return;
    }
    setSendSuccess(true);
    if (data?.warning) setError(data.warning);
    onSent?.();
  }

  // The composer is a Gmail-style window docked at the bottom right of the screen. It is
  // rendered into <body> so it stays fixed while the conversation behind it scrolls.
  const ccVisible = showCc || !!cc.trim();
  const portal = (content) => createPortal(<><ReplyStyles />{content}</>, document.body);
  const toggleMinimized = () => setView((v) => (v === "minimized" ? "normal" : "minimized"));
  const toggleMaximized = () => setView((v) => (v === "maximized" ? "normal" : "maximized"));
  const header = (
    <header className="ceo-compose-head" onClick={view === "minimized" ? toggleMinimized : undefined}>
      <b>{subject || "Reply"}</b>
      {draftSaved && view !== "minimized" && <span className="ceo-compose-state">Draft saved</span>}
      <span className="ceo-compose-ctrls">
        <button type="button" title={view === "minimized" ? "Restore" : "Minimise"} aria-label={view === "minimized" ? "Restore" : "Minimise"}
          onClick={(e) => { e.stopPropagation(); toggleMinimized(); }}>{view === "minimized" ? "▴" : "—"}</button>
        <button type="button" title={view === "maximized" ? "Exit full screen" : "Full screen"} aria-label="Full screen"
          onClick={(e) => { e.stopPropagation(); toggleMaximized(); }}>⤢</button>
        <button type="button" title="Close" aria-label="Close" onClick={(e) => { e.stopPropagation(); onClose(); }} disabled={!!busy}>✕</button>
      </span>
    </header>
  );

  if (loading) {
    return portal(
      <section className="ceo-compose ceo-compose-normal" role="dialog" aria-label="Reply">
        {header}
        <p className="ceo-compose-loading">Preparing reply…</p>
      </section>,
    );
  }

  return portal(<>
    {view === "maximized" && <div className="ceo-compose-scrim" onMouseDown={() => setView("normal")} />}
    <section className={`ceo-compose ceo-compose-${view}`} role="dialog" aria-label="Reply">
      {header}
      {view !== "minimized" && <>
        <div className="ceo-compose-row ceo-compose-from"><span>From</span><b>{fromAddress || "this mailbox"}</b></div>
        <div className="ceo-compose-row">
          <span>To</span>
          <input value={to} onChange={(e) => { setTo(e.target.value); edited(); }} disabled={!!busy} aria-label="To" />
          {!ccVisible && <button type="button" className="ceo-compose-link" onClick={() => setShowCc(true)}>Cc</button>}
          {replyAllCc.length > 0 && <button type="button" className="ceo-compose-link" onClick={() => { setShowCc(true); replyAll(); }} disabled={!!busy}>Reply all</button>}
        </div>
        {ccVisible && (
          <div className="ceo-compose-row">
            <span>Cc</span>
            <input value={cc} onChange={(e) => { setCc(e.target.value); edited(); }} disabled={!!busy} aria-label="Cc" />
          </div>
        )}
        <div className="ceo-compose-row">
          <input value={subject} maxLength={1000} onChange={(e) => { setSubject(e.target.value); edited(); }} disabled={!!busy}
            placeholder="Subject" aria-label="Subject" />
        </div>
        <textarea
          className="ceo-compose-body"
          aria-label="Reply message"
          maxLength={10000}
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            edited();
            if (appliedRedraft && event.target.value !== appliedRedraft.text) setAppliedRedraft(null);
          }}
        />
        {selectedSignature?.logo_url && (
          <div className="ceo-compose-logo"><img src={selectedSignature.logo_url} alt="" title="This logo is added below the text in the sent email." /></div>
        )}
        {(notice || (error && !sendConfirmation && !sendSuccess) || (selectedSignature && !signed) || !signatures.length) && (
          <div className="ceo-compose-notes">
            {notice && <p className="ceo-compose-ok" role="status">{notice}</p>}
            {error && !sendConfirmation && !sendSuccess && <p className="ceo-compose-err" role="alert">{error}</p>}
            {selectedSignature && !signed && <p className="ceo-compose-warn">Signature edited or removed. Choose it again to re-add it.</p>}
            {!signatures.length && <p className="ceo-compose-warn">No signatures yet. Add one in Profile › Mail.</p>}
          </div>
        )}
        {showAi && (
          <div className="ceo-compose-ai">
            <input value={instructions} onChange={(event) => setInstructions(event.target.value)} maxLength={2000} aria-label="Redraft instructions"
              placeholder="Optional: warmer and concise, suggest a call next week…" />
            <button type="button" className="ceo-compose-pill" onClick={generateRedraft} disabled={!!busy || !body.trim()}
              title="Sends your text and the recent conversation to OpenRouter for a rewrite. Nothing is emailed.">
              {busy === "redraft" ? "Redrafting…" : showUndo ? "Redraft again" : "Redraft"}
            </button>
            {showUndo && <button type="button" className="ceo-compose-pill" onClick={undoRedraft} disabled={!!busy}>Undo</button>}
          </div>
        )}
        <footer className="ceo-compose-foot">
          <button type="button" className="ceo-compose-send" onClick={prepareSend} title={sendBlockedReason || undefined}
            disabled={!!busy || !!sendBlockedReason}>
            {busy === "prepare" ? "Preparing…" : "Send"}
          </button>
          <button type="button" className={`ceo-compose-tool ${showAi ? "on" : ""}`} onClick={() => setShowAi((s) => !s)}
            title="Redraft with AI" aria-pressed={showAi}>✦ AI</button>
          <select className="ceo-compose-sig" value={signatureId} onChange={(event) => chooseSignature(event.target.value)} disabled={!!busy}
            aria-label="Signature" title="Signature">
            <option value="">{signatures.length ? "✍ Signature…" : "No signatures"}</option>
            {signatures.map((signature) => <option key={signature.id} value={signature.id}>{signature.label || signature.name}</option>)}
          </select>
          <button type="button" className="ceo-compose-tool" onClick={saveDraft} disabled={!!busy} title="Save draft">
            {busy === "save" ? "Saving…" : "Save"}
          </button>
          <span className="ceo-compose-count">{body.length.toLocaleString("en-GB")}/10,000</span>
          <button type="button" className="ceo-compose-trash" onClick={discardDraft} disabled={!!busy}
            title={draftId ? "Discard draft" : "Close"} aria-label={draftId ? "Discard draft" : "Close"}>🗑</button>
        </footer>
      </>}
    </section>

    {(sendConfirmation || sendSuccess) && (
      <div className="ceo-reply-modal-backdrop">
        <section className="ceo-reply-modal" role="dialog" aria-modal="true" aria-labelledby="ceo-send-title">
          <header>
            <div>
              <h3 id="ceo-send-title">{sendSuccess ? "Reply sent" : "Confirm sending reply"}</h3>
              <p>{sendSuccess ? "Your message was sent." : "Review the recipients and enter the one-time code to send this email."}</p>
            </div>
            {!sendSuccess && <button type="button" className="ceo-text-btn" onClick={() => setSendConfirmation(null)} aria-label="Cancel send">✕</button>}
          </header>
          <dl className="ceo-reply-recipients">
            <dt>From</dt><dd>{sendConfirmation?.from || fromAddress}</dd>
            <dt>To</dt><dd>{listText(sendConfirmation?.to) || to}</dd>
            {(sendConfirmation?.cc?.length > 0) && <><dt>Cc</dt><dd>{listText(sendConfirmation.cc)}</dd></>}
            <dt>Subject</dt><dd>{sendConfirmation?.subject || subject}</dd>
          </dl>
          {sendConfirmation && !sendSuccess && <>
            <div className="ceo-reply-preview"><b>Message preview</b><pre>{body}</pre></div>
            <p className="ceo-reply-code-label">Human verification code — enter this code to confirm</p>
            <div className="ceo-reply-code">{sendConfirmation.confirmation_code}</div>
            <label className="ceo-reply-field">Enter the 6-digit code
              <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
            </label>
            <small className="ceo-muted">Code expires at {when(sendConfirmation.expires_at)}. No email is sent until you click Send reply below.</small>
          </>}
          {error && <p className="ceo-notice ceo-error" role="alert">{error}</p>}
          <footer>
            {sendSuccess ? (
              <button type="button" className="ceo-compose-send" onClick={onClose}>Done</button>
            ) : <>
              <button type="button" className="ceo-compose-pill" onClick={() => setSendConfirmation(null)} disabled={!!busy}>Cancel</button>
              <button type="button" className="ceo-compose-send" onClick={sendReply}
                disabled={!!busy || verificationCode !== sendConfirmation?.confirmation_code}>
                {busy === "send" ? "Sending…" : "Send reply"}
              </button>
            </>}
          </footer>
        </section>
      </div>
    )}
  </>);
}

function ReplyStyles() {
  return (
    <style>{`
      .ceo-compose { position: fixed; z-index: 1004; right: 24px; bottom: 0; width: min(560px, calc(100vw - 16px)); height: min(620px, calc(100vh - 32px)); display: flex; flex-direction: column; background: #fff; border-radius: 12px 12px 0 0; box-shadow: 0 8px 40px rgba(15, 23, 42, .32); font-size: 14px; color: #1f1f1f; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
      .ceo-compose-minimized { width: min(320px, calc(100vw - 16px)); height: auto; }
      .ceo-compose-maximized { inset: 5vh 8vw; width: auto; height: auto; border-radius: 12px; }
      .ceo-compose-scrim { position: fixed; inset: 0; z-index: 1003; background: rgba(15, 23, 42, .4); }
      .ceo-compose-head { display: flex; align-items: center; gap: 10px; padding: 10px 12px 10px 16px; background: #f2f6fc; }
      .ceo-compose-minimized .ceo-compose-head { cursor: pointer; }
      .ceo-compose-head b { flex: 1; min-width: 0; font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ceo-compose-state { font-size: 11.5px; color: #5f6368; }
      .ceo-compose-ctrls { display: flex; gap: 2px; }
      .ceo-compose-ctrls button { width: 28px; height: 28px; border: 0; border-radius: 6px; background: none; color: #444; cursor: pointer; font-size: 14px; }
      .ceo-compose-ctrls button:hover { background: rgba(0,0,0,.07); }
      .ceo-compose-loading { margin: 0; padding: 16px; color: #5f6368; font-size: 13px; }
      .ceo-compose-row { display: flex; align-items: center; gap: 8px; margin: 0 16px; padding: 7px 0; border-bottom: 1px solid #e8eaed; }
      .ceo-compose-row > span { color: #5f6368; font-size: 13.5px; }
      .ceo-compose-row input { flex: 1; min-width: 0; border: 0; outline: 0; font: inherit; font-size: 14px; padding: 2px 0; background: transparent; }
      .ceo-compose-from b { font-weight: 500; font-size: 13.5px; }
      .ceo-compose-link { border: 0; background: none; color: #444; font: inherit; font-size: 13.5px; cursor: pointer; padding: 0 2px; }
      .ceo-compose-link:hover { text-decoration: underline; }
      .ceo-compose-body { flex: 1; min-height: 120px; margin: 0; padding: 12px 16px; border: 0; outline: 0; resize: none; font: inherit; font-size: 14px; line-height: 1.55; }
      .ceo-compose-maximized .ceo-compose-body { font-size: 15px; }
      .ceo-compose-logo { padding: 0 16px 6px; }
      .ceo-compose-logo img { max-height: 54px; max-width: 220px; border-radius: 4px; }
      .ceo-compose-notes { display: grid; gap: 4px; padding: 0 16px 6px; font-size: 12px; }
      .ceo-compose-notes p { margin: 0; padding: 5px 8px; border-radius: 6px; }
      .ceo-compose-ok { background: #ecfdf5; color: #047857; }
      .ceo-compose-err { background: #fef2f2; color: #b91c1c; }
      .ceo-compose-warn { background: #fffbeb; color: #b45309; }
      .ceo-compose-ai { display: flex; gap: 6px; align-items: center; margin: 0 16px 6px; padding: 6px; background: #f2f6fc; border-radius: 10px; }
      .ceo-compose-ai input { flex: 1; min-width: 0; font: inherit; font-size: 13px; padding: 6px 9px; border: 1px solid #dadce0; border-radius: 8px; background: #fff; }
      .ceo-compose-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 10px 14px 12px 16px; }
      .ceo-compose-send { border: 0; border-radius: 999px; background: #0b57d0; color: #fff; font: inherit; font-size: 14px; font-weight: 600; padding: 9px 24px; cursor: pointer; }
      .ceo-compose-send:hover { background: #0a4cb8; }
      .ceo-compose-send:disabled { background: #a8c7fa; cursor: default; }
      .ceo-compose-tool, .ceo-compose-pill { border: 1px solid transparent; border-radius: 999px; background: none; color: #444; font: inherit; font-size: 13px; padding: 6px 10px; cursor: pointer; }
      .ceo-compose-tool:hover, .ceo-compose-tool.on { background: #e8f0fe; color: #0b57d0; }
      .ceo-compose-pill { border-color: #dadce0; background: #fff; }
      .ceo-compose-tool:disabled, .ceo-compose-pill:disabled { opacity: .55; cursor: default; }
      .ceo-compose-sig { max-width: 170px; font: inherit; font-size: 13px; padding: 5px 8px; border: 1px solid #dadce0; border-radius: 999px; background: #fff; color: #444; }
      .ceo-compose-count { margin-left: auto; font-size: 11.5px; color: #80868b; }
      .ceo-compose-trash { border: 0; background: none; font-size: 16px; padding: 6px; border-radius: 6px; cursor: pointer; }
      .ceo-compose-trash:hover { background: rgba(0,0,0,.07); }
      .ceo-reply-field { display: grid; gap: 3px; font-size: 11.5px; font-weight: 600; color: #4b5563; }
      .ceo-reply-field input { font: inherit; font-size: 13px; font-weight: 400; padding: 7px 9px; border: 1px solid #d1d5db; border-radius: 7px; background: #fff; }
      .ceo-reply-modal-backdrop { position: fixed; inset: 0; z-index: 1006; display: grid; place-items: center; padding: 16px; background: rgba(15, 23, 42, .45); }
      .ceo-reply-modal { width: min(560px, 100%); max-height: calc(100vh - 32px); overflow: auto; display: grid; gap: 12px; padding: 18px; background: #fff; border-radius: 12px; box-shadow: 0 20px 50px rgba(0,0,0,.25); }
      .ceo-reply-modal header { display: flex; justify-content: space-between; gap: 12px; }
      .ceo-reply-modal h3 { margin: 0; font-size: 16px; color: #1f2a30; }
      .ceo-reply-modal header p { margin: 4px 0 0; font-size: 12.5px; color: #6b7280; }
      .ceo-reply-modal footer { display: flex; justify-content: flex-end; gap: 8px; }
      .ceo-reply-recipients { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; font-size: 13px; }
      .ceo-reply-recipients dt { font-weight: 600; color: #4b5563; }
      .ceo-reply-recipients dd { margin: 0; overflow-wrap: anywhere; }
      .ceo-reply-preview { display: grid; gap: 4px; font-size: 12px; }
      .ceo-reply-preview pre { margin: 0; max-height: 200px; overflow: auto; white-space: pre-wrap; font: inherit; font-size: 12.5px; padding: 8px; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 7px; }
      .ceo-reply-code-label { margin: 0; font-size: 12px; font-weight: 600; color: #4b5563; }
      .ceo-reply-code { font-size: 26px; font-weight: 700; letter-spacing: 6px; color: #0b6b70; }
      @media (max-width: 640px) { .ceo-compose { right: 8px; } .ceo-compose-maximized { inset: 8px; } }
    `}</style>
  );
}
