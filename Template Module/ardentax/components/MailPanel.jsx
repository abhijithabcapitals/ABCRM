// A document's email draft. It leaves only when a person clicks Send and then confirms what will go.
import { useEffect, useRef, useState } from "react";
import { Button, ErrorNote, Modal, fmtDateTime } from "@banking/components/shared";

const signatureText = (html) => new DOMParser().parseFromString(html || "", "text/html").body.textContent.replace(/\s+/g, " ").trim();
const fileOf = (path) => String(path || "").split("/").pop();

export default function MailPanel({ doc, api, onClose, onChanged }) {
  const [mail, setMail] = useState({ to: doc.mail_to || "", cc: doc.mail_cc || "", subject: doc.mail_subject || "", body: doc.mail_body || "", attachWord: !!doc.mail_attach_word });
  const [signature, setSignature] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [sentAt, setSentAt] = useState(doc.mail_sent_at || null);
  const sending = useRef(false);
  const set = (k) => (e) => setMail((m) => ({ ...m, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const pending = !doc.pdf_path;

  useEffect(() => {
    let live = true;
    api.mailSettings().then((s) => { if (live) setSignature(signatureText(s?.signature_html)); }).catch(() => {});
    return () => { live = false; };
  }, [api]);

  const save = async () => {
    setBusy("save"); setError(null); setNote(null);
    try { await api.updateMail(doc.id, mail); await onChanged(); setNote("Draft saved."); } catch (e) { setError(e.message); }
    setBusy(null);
  };
  const send = async () => {
    if (sending.current) return;
    sending.current = true;
    setBusy("send"); setError(null); setNote(null);
    try {
      await api.updateMail(doc.id, mail);
      const r = await api.sendMail(doc.id, !!sentAt);
      setSentAt(r.sent_at || new Date().toISOString());
      setNote(["Mail sent.", ...(r.warnings || [])].join(" "));
      await onChanged();
    } catch (e) { setError(e.message); }
    setConfirming(false);
    sending.current = false;
    setBusy(null);
  };

  const attachments = [fileOf(doc.pdf_path), ...(mail.attachWord ? [fileOf(doc.word_path)] : [])];
  return (
    <Modal title={`Email: ${doc.document_number}${doc.version > 1 ? ` v${doc.version}` : ""}`} onClose={onClose} wide>
      <ErrorNote message={error} />
      {note && <p className="bk-note">{note}</p>}
      {sentAt && <p className="bk-note">Sent on {fmtDateTime(sentAt)}.</p>}
      {pending && <p className="at-warn">This document's files are not ready. Use Generate again before sending.</p>}
      <div className="bk-grid">
        <div className="bk-field"><label htmlFor="at-m-to">To</label><input id="at-m-to" value={mail.to} onChange={set("to")} /></div>
        <div className="bk-field"><label htmlFor="at-m-cc">CC</label><input id="at-m-cc" value={mail.cc} onChange={set("cc")} /></div>
        <div className="bk-field at-wide"><label htmlFor="at-m-subject">Subject</label><input id="at-m-subject" value={mail.subject} onChange={set("subject")} /></div>
        <div className="bk-field at-wide"><label htmlFor="at-m-body">Email text</label><textarea id="at-m-body" rows={12} value={mail.body} onChange={set("body")} /></div>
      </div>
      <label className="at-check"><input type="checkbox" checked={mail.attachWord} onChange={set("attachWord")} /> Also attach the Word file</label>
      <p className="bk-muted"><small>Attached: {attachments.filter(Boolean).join(", ") || "nothing yet"}. Signature added when sent: {signature || "none"}.</small></p>
      <div className="at-actions at-go">
        <Button busy={busy === "save"} disabled={!!busy} onClick={save}>Save draft</Button>
        <Button variant="primary" disabled={!!busy || pending} onClick={() => setConfirming(true)}>{sentAt ? "Send again" : "Send"}</Button>
      </div>
      {confirming && (
        <Modal title={sentAt ? "Send this mail again?" : "Send this mail?"} onClose={() => setConfirming(false)}>
          {sentAt && <p className="at-warn">This mail was already sent on {fmtDateTime(sentAt)}.</p>}
          <dl className="at-totals at-confirm">
            <div><dt>From</dt><dd>bharat@ardentaxit.tax</dd></div>
            <div><dt>To</dt><dd>{mail.to || "–"}</dd></div>
            <div><dt>CC</dt><dd>{mail.cc || "–"}</dd></div>
            <div><dt>Subject</dt><dd>{mail.subject || "–"}</dd></div>
            <div><dt>Attachments</dt><dd>{attachments.join(", ")}</dd></div>
          </dl>
          <div className="at-actions at-go">
            <Button disabled={busy === "send"} onClick={() => setConfirming(false)}>Cancel</Button>
            <Button variant="primary" busy={busy === "send"} disabled={busy === "send"} onClick={send}>{sentAt ? "Yes, send again" : "Yes, send"}</Button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
