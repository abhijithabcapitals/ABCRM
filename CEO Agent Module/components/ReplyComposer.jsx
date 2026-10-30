import { useEffect, useState } from "react";

// Reply composer for one Inbox conversation, with the same flow as the Business
// Development reply mailer: save draft, AI redraft with instructions and undo,
// signature picker, and sending only after a one-time confirmation code. Mail is
// sent from the conversation's own mailbox by the ceo-mail-reply Edge Function.

// The chosen signature is kept as the last block of the reply text, so the saved draft is exactly what is sent.
const signatureText = (signature) => signature.body_text.trim();
const endsWithSignature = (text, signature) => !!signature && text.trimEnd().endsWith(signatureText(signature));
const stripSignature = (text, signature) => (endsWithSignature(text, signature)
  ? text.trimEnd().slice(0, -signatureText(signature).length).trimEnd()
  : text);
const appendSignature = (text, signature) => `${text.trimEnd()}${text.trim() ? "\n\n" : ""}${signatureText(signature)}`;
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
        .select("id, user_id, name, body_text, logo_url, is_default, owner:profiles(full_name, email)").order("created_at"),
      sb.auth.getSession(),
    ]).then(([context, signatureResult, sessionResult]) => {
      if (!active) return;
      const mySignatures = signatureResult.error ? [] : shapeSharedSignatures(signatureResult.data || [], sessionResult?.data?.session?.user?.id);
      setSignatures(mySignatures);
      if (signatureResult.error) setError(`Could not load your signatures: ${signatureResult.error.message}`);
      if (context.error) { setError(context.error.message); return; }
      const { mailbox: box, defaults, draft, agent_draft: agentDraft } = context.data;
      setMailbox(box);
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
  const sendBlockedReason = !mailbox?.can_send ? `Sending is not set up for ${mailbox?.address || "this mailbox"}.`
    : !to.trim() ? "Add at least one recipient."
      : !selectedSignature ? "Choose a signature first."
        : !signed ? "The selected signature must stay at the end of the reply."
          : !hasMessage ? "Write a reply above your signature." : "";

  function edited() {
    setDraftSaved(false);
    setNotice("");
  }

  async function saveDraft() {
    if (body.length > 10000) {
      setError("Reply must be 10,000 characters or fewer.");
      return null;
    }
    setBusy("save");
    setError("");
    const { data, error: saveError } = await call("save_draft", {
      thread_id: thread.id, draft_id: draftId || undefined, to, cc, subject, body_text: body,
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
    const draft = await saveDraft();
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

  if (loading) return <section className="ceo-reply"><p className="ceo-muted">Preparing reply…</p></section>;

  return (
    <section className="ceo-reply" aria-label="Reply composer">
      <ReplyStyles />
      <div className="ceo-reply-head">
        <b>Reply from {mailbox?.address || "this mailbox"}</b>
        <span>{draftSaved ? "Draft saved" : "Unsaved changes"}</span>
      </div>
      <label className="ceo-reply-field">To
        <input value={to} onChange={(e) => { setTo(e.target.value); edited(); }} disabled={!!busy} placeholder="name@example.com" />
      </label>
      <label className="ceo-reply-field">Cc
        <span className="ceo-reply-inline">
          <input value={cc} onChange={(e) => { setCc(e.target.value); edited(); }} disabled={!!busy} placeholder="Optional, separate with commas" />
          {replyAllCc.length > 0 && <button type="button" className="ceo-text-btn" onClick={replyAll} disabled={!!busy}>Reply all</button>}
        </span>
      </label>
      <label className="ceo-reply-field">Subject
        <input value={subject} maxLength={1000} onChange={(e) => { setSubject(e.target.value); edited(); }} disabled={!!busy} />
      </label>
      <textarea
        aria-label="Reply message"
        maxLength={10000}
        value={body}
        onChange={(event) => {
          setBody(event.target.value);
          edited();
          if (appliedRedraft && event.target.value !== appliedRedraft.text) setAppliedRedraft(null);
        }}
        placeholder="Write your reply…"
      />
      <input
        className="ceo-reply-instructions"
        aria-label="Redraft instructions"
        value={instructions}
        onChange={(event) => setInstructions(event.target.value)}
        maxLength={2000}
        placeholder="Optional redraft instructions, e.g. warmer and concise, suggest a call next week"
      />
      <div className="ceo-reply-signature">
        <label>Signature
          <select value={signatureId} onChange={(event) => chooseSignature(event.target.value)} disabled={!!busy}>
            <option value="">{signatures.length ? "Choose a signature…" : "No signatures yet"}</option>
            {signatures.map((signature) => <option key={signature.id} value={signature.id}>{signature.label || signature.name}</option>)}
          </select>
        </label>
        {selectedSignature?.logo_url && <img src={selectedSignature.logo_url} alt="" title="This logo is added below the text in the sent email." />}
        {!signatures.length && <span>Add one in Profile › Mail (click your name at the bottom of the sidebar).</span>}
        {selectedSignature && !signed && <span className="ceo-reply-warn">Signature edited or removed. Choose it again to re-add it.</span>}
      </div>
      {notice && <p className="ceo-notice ceo-ok" role="status">{notice}</p>}
      {error && !sendConfirmation && !sendSuccess && <p className="ceo-notice ceo-error" role="alert">{error}</p>}
      <div className="ceo-reply-footer">
        <span>{body.length.toLocaleString("en-GB")} / 10,000</span>
        <div>
          <button type="button" className="ceo-text-btn" onClick={discardDraft} disabled={!!busy}>{draftId ? "Discard" : "Close"}</button>
          <button type="button" className="ceo-reply-btn" onClick={saveDraft} disabled={!!busy}>
            {busy === "save" ? "Saving…" : draftSaved ? "Save changes" : "Save draft"}
          </button>
          <button type="button" className="ceo-reply-btn" onClick={generateRedraft} disabled={!!busy || !body.trim()}
            title="Sends your text and the recent conversation to OpenRouter for a rewrite. Nothing is emailed.">
            {busy === "redraft" ? "Redrafting…" : showUndo ? "Redraft again" : "Redraft with AI"}
          </button>
          {showUndo && <button type="button" className="ceo-reply-btn" onClick={undoRedraft} disabled={!!busy}>Undo</button>}
          <button type="button" className="btn btn-primary" onClick={prepareSend} title={sendBlockedReason || undefined}
            disabled={!!busy || !!sendBlockedReason}>
            {busy === "prepare" ? "Preparing…" : "Send"}
          </button>
        </div>
      </div>

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
              <dt>From</dt><dd>{sendConfirmation?.from || mailbox?.address}</dd>
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
                <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
              ) : <>
                <button type="button" className="ceo-reply-btn" onClick={() => setSendConfirmation(null)} disabled={!!busy}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={sendReply}
                  disabled={!!busy || verificationCode !== sendConfirmation?.confirmation_code}>
                  {busy === "send" ? "Sending…" : "Send reply"}
                </button>
              </>}
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}

function ReplyStyles() {
  return (
    <style>{`
      .ceo-reply { display: grid; gap: 8px; padding: 12px; background: #f8fafc; border: 1px solid #dbe3e8; border-radius: 10px; }
      .ceo-reply-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 13px; color: #1f2a30; }
      .ceo-reply-head span { font-size: 11.5px; color: #6b7280; }
      .ceo-reply-field { display: grid; gap: 3px; font-size: 11.5px; font-weight: 600; color: #4b5563; }
      .ceo-reply-field input, .ceo-reply-instructions, .ceo-reply-signature select { font: inherit; font-size: 13px; font-weight: 400; padding: 7px 9px; border: 1px solid #d1d5db; border-radius: 7px; background: #fff; min-width: 0; }
      .ceo-reply-inline { display: flex; gap: 8px; align-items: center; }
      .ceo-reply-inline input { flex: 1; }
      .ceo-reply textarea { min-height: 180px; resize: vertical; font: inherit; font-size: 13px; line-height: 1.5; padding: 9px; border: 1px solid #d1d5db; border-radius: 7px; }
      .ceo-reply-signature { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; font-size: 12px; color: #6b7280; }
      .ceo-reply-signature label { display: flex; align-items: center; gap: 8px; font-weight: 600; color: #4b5563; }
      .ceo-reply-signature img { max-height: 40px; max-width: 160px; border-radius: 4px; }
      .ceo-reply-warn { color: #b45309; }
      .ceo-reply-footer { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; font-size: 11.5px; color: #6b7280; }
      .ceo-reply-footer > div { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .ceo-reply-btn { font: inherit; font-size: 13px; padding: 7px 12px; border: 1px solid #d1d5db; border-radius: 8px; background: #fff; color: #1f2a30; cursor: pointer; }
      .ceo-reply-btn:disabled { opacity: .6; cursor: default; }
      .ceo-reply-modal-backdrop { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 16px; background: rgba(15, 23, 42, .45); }
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
    `}</style>
  );
}
