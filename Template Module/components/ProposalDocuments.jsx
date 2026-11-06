// Proposals already made: files, OneDrive, mail, the client's choice and the engagement letter.
import { useEffect, useRef, useState } from "react";
import { Badge, Button, DataTable, ErrorNote, Panel, fmtDate, fmtDateTime, useLoad } from "@banking/components/shared";
import { listDocuments, loadCatalogue, openStored, updateMail } from "../services/hubApi";
import { openWord, sendProposal } from "../services/proposalApi";
import { retryProposal, saveToOneDrive } from "../services/proposalGenerate";
import { oneDriveDeps, proposalDeps } from "../services/proposalDeps";
import { proposalAmount } from "../logic/proposalModel";
import ProposalLetterDialog, { ProposalChoiceDialog, fileLetter } from "./ProposalLetterDialog";
import { letterAction, proposalStage } from "../logic/proposalLetter";

const PROPOSAL = "AB Capital/Proposal";
const plain = (n) => Number(n || 0).toLocaleString("en-AE", { maximumFractionDigits: 2 });
const MailIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>;

export default function ProposalDocuments({ profile, settings, refresh }) {
  const docs = useLoad(() => listDocuments("Business Setup"), [refresh]);
  const catalogue = useLoad(loadCatalogue, []);
  const [mail, setMail] = useState(null); // { id, subject, body, doc }
  const [letterFor, setLetterFor] = useState(null);
  const [choiceFor, setChoiceFor] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null); // { ok, text, warnings }
  const panel = useRef(null);
  useEffect(() => { if (mail) panel.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }); }, [mail?.id]);

  const all = docs.data || [];
  const rows = all.filter((d) => d.doc_type === "quote" && d.library_template === PROPOSAL);
  const mailOf = (d) => all.find((x) => x.doc_type === "mail" && x.parent_id === d.id);
  const letterOf = (d) => all.find((x) => x.doc_type === "letter" && x.parent_id === d.id && x.status !== "rejected");
  // A letter the client rejected stays on its quote until a new letter replaces it.
  const rejectedLetterOf = (d) => all.find((x) => x.doc_type === "letter" && x.parent_id === d.id && x.status === "rejected");
  const run = async (key, fn) => { setBusy(key); setError(null); try { await fn(); } catch (e) { setError(e.message); } setBusy(null); };

  const openMail = (d) => { const m = mailOf(d); if (m) setMail({ id: m.id, subject: m.mail_subject, body: m.mail_body, doc: d }); };
  const saveNow = (d) => run(`od-${d.id}`, async () => {
    const path = await saveToOneDrive(d, oneDriveDeps);
    setNote(path ? { ok: true, text: `Saved to ${path}` } : { ok: false, text: "The Client Module is not running on this PC, so nothing was saved to OneDrive. Try again on the PC that runs it." });
    await docs.reload();
  });
  const retry = (d) => run(`retry-${d.id}`, async () => {
    const out = await retryProposal(d, proposalDeps, settings);
    if (out.error) throw new Error(`${d.document_number}: ${out.error}`);
    setNote({ ok: true, text: `${d.document_number} files were made.` });
    await docs.reload();
  });
  // Files an existing letter again under its own number; no new letter is made.
  const retryLetter = (l) => run(`letter-${l.id}`, async () => {
    await fileLetter(l, { settings, catalogue: catalogue.data, profile }, !!mailOf(l));
    setNote({ ok: true, text: `Letter ${l.document_number} file made.` });
    await docs.reload();
  });
  const saveDraft = () => run("mail-save", async () => { await updateMail(mail.id, mail.subject, mail.body); await docs.reload(); setNote({ ok: true, text: "Mail changes saved." }); });
  const copy = async () => { try { await navigator.clipboard.writeText(`${mail.subject}\n\n${mail.body}`); setNote({ ok: true, text: "Copied." }); } catch { setError("Could not copy here. Select the text and copy it."); } };

  // The recipient is shown before anything goes. A proposal already sent needs a second confirmation.
  const send = () => {
    const d = mail.doc, resend = !!d.mail_sent_at;
    const ask = resend
      ? `This proposal was already sent on ${fmtDateTime(d.mail_sent_at)} to ${d.mail_sent_to || d.contact_email}. Send it again to ${d.contact_email}?`
      : `Send proposal ${d.document_number} (PDF) to ${d.contact_email}?`;
    if (!window.confirm(ask)) return;
    run("send", async () => {
      await updateMail(mail.id, mail.subject, mail.body); // the stored draft is what goes
      const r = await sendProposal(d.id, resend);
      if (r && r.ok === false) throw new Error(r.error || "The mail was not sent.");
      setNote({ ok: !(r?.warnings || []).length, text: `Sent to ${d.contact_email}${r?.sent_at ? ` on ${fmtDateTime(r.sent_at)}` : ""}.`, warnings: r?.warnings || [] });
      await docs.reload();
      setMail(null);
    });
  };

  const cell = (d) => {
    const a = proposalAmount(d);
    return a ? `AED ${plain(a.total)} (${a.label})` : "–";
  };
  const context = { settings, catalogue: catalogue.data, profile };
  return (
    <>
      <Panel title="Proposals">
        <ErrorNote message={docs.error || error} onClose={error ? () => setError(null) : undefined} />
        {note && <div className={`bk-alert ${note.ok ? "bk-alert-ok" : "bk-alert-warn"}`}><strong>{note.text}</strong>{(note.warnings || []).length > 0 && <ul>{note.warnings.map((w, i) => <li key={i}>{String(w)}</li>)}</ul>}</div>}
        <DataTable search="Search…" rows={rows} empty="No proposals yet." columns={[
          { key: "document_number", label: "Ref" }, { key: "client_name", label: "Client" },
          { key: "total_amount", label: "Amount", right: true, render: cell }, { key: "created_at", label: "Date", render: (d) => fmtDate(d.created_at) },
          { key: "files", label: "Files", render: (d) => (d.storage_path
            ? <span className="bk-actions"><button type="button" className="bk-link" onClick={() => openStored(d.storage_path).catch((e) => setError(e.message))}>View</button>{d.word_path && <button type="button" className="bk-link" onClick={() => openWord(d.word_path).catch((e) => setError(e.message))}>Word</button>}</span>
            : <Button variant="primary" busy={busy === `retry-${d.id}`} onClick={() => retry(d)}>Retry</Button>) },
          { key: "od", label: "OneDrive", render: (d) => (d.onedrive_saved_at
            ? <Badge tone="good">Saved</Badge>
            : <span className="bk-actions"><Badge tone="warn">Not in OneDrive</Badge>{d.storage_path && d.word_path && <Button busy={busy === `od-${d.id}`} onClick={() => saveNow(d)}>Save now</Button>}</span>) },
          { key: "mail", label: "Mail", render: (d) => (!mailOf(d) ? "–" : <span className="bk-actions"><button type="button" className={`bk-mail-icon${mail?.id === mailOf(d).id ? " active" : ""}`} title={`Draft mail for ${d.document_number}`} aria-label={`Open draft mail for ${d.document_number}`} onClick={() => openMail(d)}><MailIcon /></button>{d.mail_sent_at && <small className="bk-muted">Sent {fmtDateTime(d.mail_sent_at)}</small>}</span>) },
          { key: "letter", label: "Engagement Letter", render: (d) => {
            // Issued: record the client's choice, then the client accepts (signed copy in the workspace, or the portal). The letter comes once accepted.
            const stage = proposalStage(d);
            if (stage === "closed") return "–";
            if (stage !== "letter") return (
              <span className="bk-actions">
                {(d.field_values?.proposal?.options || []).length > 1 && <Button variant={stage === "choose" ? "primary" : undefined} onClick={() => setChoiceFor(d)}>Record client&apos;s choice</Button>}
                <small className="bk-muted">{stage === "choose" ? "Record the option the client chose before it can be accepted." : "To accept: confirm the signed copy in the client's workspace (Quotes & Agreements), or the client accepts in the portal."}</small>
              </span>);
            const l = letterOf(d), act = letterAction(l);
            if (act === "done") return <span className="bk-actions"><Badge tone="good">Letter generated</Badge><button type="button" className="bk-link" onClick={() => openStored(l.storage_path).catch((e) => setError(e.message))}>View</button></span>;
            if (act === "retry") return <span className="bk-actions"><Badge tone="warn">{l.document_number} has no file</Badge><Button variant="primary" busy={busy === `letter-${l.id}`} onClick={() => retryLetter(l)}>Retry letter file</Button></span>;
            const rejected = rejectedLetterOf(d);
            return <span className="bk-actions">{rejected && <Badge tone="bad">{rejected.document_number} rejected</Badge>}<Button disabled={!d.storage_path} onClick={() => setLetterFor(d)}>{rejected ? "New Engagement Letter + Mail" : "Engagement Letter + Mail"}</Button></span>;
          } },
        ]} />
      </Panel>
      {mail && (
        <div ref={panel}>
          <Panel title={`Mail for proposal ${mail.doc.document_number}`} sub={`Goes to ${mail.doc.contact_email || "no email on file"} with the PDF attached. The Word file is never sent.${mail.doc.mail_sent_at ? ` Already sent ${fmtDateTime(mail.doc.mail_sent_at)}.` : ""}`}
            actions={<><Button onClick={copy}>Copy</Button><Button busy={busy === "mail-save"} onClick={saveDraft}>Save changes</Button><Button variant="primary" busy={busy === "send"} disabled={!mail.doc.storage_path || !mail.doc.contact_email} onClick={send}>{mail.doc.mail_sent_at ? "Resend" : "Send"}</Button><Button onClick={() => setMail(null)}>Close</Button></>}>
            <div className="bk-field bk-mb"><label htmlFor="pm-subj">Subject</label><input id="pm-subj" value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })} /></div>
            <div className="bk-field"><label htmlFor="pm-body">Message</label><textarea id="pm-body" rows={12} value={mail.body} onChange={(e) => setMail({ ...mail, body: e.target.value })} /></div>
          </Panel>
        </div>
      )}
      {choiceFor && <ProposalChoiceDialog quote={choiceFor} onClose={() => setChoiceFor(null)}
        onDone={async (text) => { await docs.reload(); setNote({ ok: true, text }); setChoiceFor(null); }} />}
      {letterFor && <ProposalLetterDialog quote={letterFor} context={context} onClose={() => setLetterFor(null)}
        onDone={async (text) => { await docs.reload(); if (text) { setNote({ ok: true, text }); setLetterFor(null); } }} />}
    </>
  );
}
