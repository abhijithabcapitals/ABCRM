// A document's email draft. It leaves only when a person clicks Send and then confirms what will go.
// Signing is optional: an Ardentax approver may tick "Sign before sending"; a signed document goes as its signed copy unless the
// sender picks the unsigned one. onSign(doc) signs through the shared step and returns { error } or the signing.
import { useEffect, useRef, useState } from "react";
import { Badge, Button, ErrorNote, Modal, fmtDate, fmtDateTime } from "@banking/components/shared";
import { attachmentNames, initialCopy, sendPlan, signState, signStatus } from "../logic/signingUi.js";

const signatureText = (html) => new DOMParser().parseFromString(html || "", "text/html").body.textContent.replace(/\s+/g, " ").trim();
const BANNER_PATH = "ArdentTax (ASP)/assets/banner.png";

export default function MailPanel({ doc, api, canSign = false, onSign, onClose, onChanged }) {
  const [mail, setMail] = useState({ to: doc.mail_to || "", cc: doc.mail_cc || "", subject: doc.mail_subject || "", body: doc.mail_body || "", attachWord: !!doc.mail_attach_word });
  const [signature, setSignature] = useState("");
  const [banner, setBanner] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [sentAt, setSentAt] = useState(doc.mail_sent_at || null);
  const sending = useRef(false);
  const set = (k) => (e) => setMail((m) => ({ ...m, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const pending = !doc.pdf_path;
  const liveId = doc.signing?.live?.id || null;
  const [copy, setCopy] = useState(() => initialCopy(doc.signing));
  // A signing made or withdrawn while the panel is open starts the choice again.
  useEffect(() => { setCopy(initialCopy(doc.signing)); }, [liveId]); // eslint-disable-line react-hooks/exhaustive-deps
  const state = signState(doc, { canSign, signing: doc.signing });
  const plan = sendPlan(state, copy);
  const status = signStatus(doc.signing, fmtDate);

  useEffect(() => {
    let live = true;
    api.mailSettings().then((s) => { if (live) setSignature(signatureText(s?.signature_html)); }).catch(() => {});
    api.signedUrl(BANNER_PATH).then((url) => { if (live) setBanner(url); }).catch(() => {});
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
      // Sign before sending signs first; a refused signing sends nothing. A signing that worked stays, even if the send then fails.
      if (plan.signFirst) {
        const s = await onSign(doc);
        if (s?.error) throw new Error(`Not sent. Signing failed: ${s.error}`);
      }
      const r = await api.sendMail(doc.id, !!sentAt, { signed: plan.signed });
      setSentAt(r.sent_at || new Date().toISOString());
      setNote([plan.signed ? "Mail sent with the signed copy." : "Mail sent.", ...(r.warnings || [])].join(" "));
      await onChanged();
    } catch (e) {
      setError(e.message);
      try { await onChanged(); } catch { /* the list shows its own error */ }
    }
    setConfirming(false);
    sending.current = false;
    setBusy(null);
  };

  const attachments = attachmentNames(doc, { attachWord: mail.attachWord, signed: plan.signed });
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
      <div className="at-check"><span>Ardentax signature: </span><Badge tone={status.tone}>{status.label}</Badge></div>
      {state.chooseCopy && (
        <div className="at-check">
          <label><input type="radio" name="at-m-copy" checked={copy.copy === "signed"} onChange={() => setCopy({ ...copy, copy: "signed" })} /> Signed copy</label>{" "}
          <label><input type="radio" name="at-m-copy" checked={copy.copy === "unsigned"} onChange={() => setCopy({ ...copy, copy: "unsigned" })} /> Unsigned copy</label>
        </div>
      )}
      {state.signFirst && (
        <label className="at-check"><input type="checkbox" checked={copy.signFirst} onChange={(e) => setCopy({ ...copy, signFirst: e.target.checked })} /> Sign before sending <small className="bk-muted">(adds the Ardentax signature, then sends the signed copy)</small></label>
      )}
      <p className="bk-muted"><small>Attached: {attachments.filter(Boolean).join(", ") || "nothing yet"}. Added below the text when sent:</small></p>
      <div className="at-signature">
        {signature && <p>{signature}</p>}
        {banner && <img src={banner} alt="Ardentax email signature" />}
      </div>
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
            {plan.signFirst && <div><dt>Signature</dt><dd>Signed by you before sending</dd></div>}
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
