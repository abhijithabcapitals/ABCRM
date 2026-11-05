// The Accounting quotes and agreements made so far, with every next step: View, Word, OneDrive, mail and Send, accept an option,
// make the agreement, edit, approve and record the signed copy. After every action the list is read again from the server.
import { useEffect, useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FilePick, Modal, Panel, fmtDate, fmtDateTime, today, useLoad } from "@banking/components/shared";
import { listDocuments, openStored, updateMail } from "../services/hubApi";
import { acceptOption, canApprove as canApproveApi, openWord, recordSigned, sendDoc } from "../services/accountingApi";
import { accountingDeps, generateGuard } from "../services/accountingDeps";
import { approveAgreement, editAgreement, generateAgreement, retryDocument, saveToOneDrive } from "../services/accountingGenerate";
import { BASES, isAccountingAgreement, isAccountingQuote, registerLabel, totalsByBasis } from "../logic/accountingQuote";
import { agreementFromQuote } from "../logic/accountingAgreement";
import { docActions, docStatus } from "../logic/accountingUi";
import AccountingAgreementForm from "./AccountingAgreementForm";

const plain = (n) => Number(n || 0).toLocaleString("en-AE", { maximumFractionDigits: 2 });
const typeLabel = (d) => (isAccountingAgreement(d) ? "Agreement" : "Quote");
const printed = (key) => BASES.find((b) => b.key === key)?.printed || "";

// Radio list of the quote's options, each with its own totals. Nothing is added across options.
function AcceptOption({ doc, onSubmit, onClose }) {
  const options = doc.field_values?.quote?.options || [];
  const [pick, setPick] = useState(Number.isInteger(doc.field_values?.quote?.accepted_option) ? doc.field_values.quote.accepted_option : 0);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const problem = await onSubmit(pick);
    if (problem) { setError(problem); setBusy(false); }
  };
  return (
    <Modal title={`Accept an option on ${doc.document_number}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="bk-note">Choose the option the client accepted. The agreement starts from it.</p>
        <ErrorNote message={error} />
        {options.map((o, i) => (
          <label key={i} className="bk-inbox" style={{ display: "block", cursor: "pointer" }}>
            <input type="radio" name="accepted-option" checked={pick === i} onChange={() => setPick(i)} /> <strong>Option {i + 1}: {o.name}</strong>
            <div className="bk-muted">{totalsByBasis(o).map((t) => `AED ${plain(t.total)} ${printed(t.basis)}`).join(" · ") || "No fixed fee"}</div>
          </label>
        ))}
        <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>Accept option</Button></div>
      </form>
    </Modal>
  );
}

// The day the client signed, and the countersigned file.
function RecordSigned({ doc, onSubmit, onClose }) {
  const [date, setDate] = useState(today());
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!date) { setError("Enter the date the client signed."); return; }
    if (!file) { setError("Choose the countersigned file."); return; }
    setBusy(true); setError(null);
    const problem = await onSubmit(date, file);
    if (problem) { setError(problem); setBusy(false); }
  };
  return (
    <Modal title={`Record signed copy of ${doc.document_number}`} onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorNote message={error} />
        <div className="bk-field bk-mb"><label htmlFor="sg-date">Date the client signed</label><input id="sg-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="bk-field"><label>Countersigned file</label><FilePick label={file ? file.name : "Choose file"} onFile={setFile} accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" /></div>
        <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>Save signed copy</Button></div>
      </form>
    </Modal>
  );
}

export default function AccountingDocuments({ settings, packages, reloadKey }) {
  const docs = useLoad(() => listDocuments("Accounting"), []);
  const approver = useLoad(canApproveApi, []);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [mail, setMail] = useState(null);
  const [dialog, setDialog] = useState(null); // { kind: accept | agreement | edit | signed, doc, initial }
  useEffect(() => { if (reloadKey) docs.reload(); }, [reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = docs.data || [];
  const rows = all.filter((d) => isAccountingQuote(d) || isAccountingAgreement(d));
  const mailOf = (d) => all.find((x) => x.doc_type === "mail" && x.parent_id === d.id);
  const agreementOf = (q) => all.find((x) => isAccountingAgreement(x) && x.parent_id === q.id && x.status !== "rejected");
  const deps = () => accountingDeps(settings);

  // Runs one action. Nothing else starts while it runs; the list is read again afterwards.
  const run = async (key, fn) => {
    if (busy) return;
    setBusy(key); setError(null); setNote(null);
    try { await fn(); } catch (e) { setError(e.message); }
    try { await docs.reload(); } catch { /* the load error shows in the list */ }
    setBusy(null);
  };

  // Shows what a build produced. A row that was numbered but whose files failed stays in the list for Retry.
  const report = (r, what) => {
    if (r.error && r.doc) setError(`${r.doc.document_number}: ${r.error} Use Retry in the list.`);
    else if (r.error) setError(r.error);
    else setNote({ ok: !!r.onedrive || r.onedrive === undefined, text: `${what}${r.doc?.document_number ? ` ${r.doc.document_number}` : ""} done.${r.onedrive === null ? " Not in OneDrive: use Save now on a PC where the Client Module runs." : r.onedrive ? ` Saved to ${r.onedrive}` : ""}` });
  };

  const openAgreement = (q) => {
    const i = q.field_values?.quote?.accepted_option;
    const pkg = packages.find((p) => p.package_key === q.field_values?.quote?.options?.[i]?.package_key);
    try { setDialog({ kind: "agreement", doc: q, initial: agreementFromQuote(q, pkg, settings?.accounting_proposal_defaults) }); } catch (e) { setError(e.message); }
  };

  const submitAgreement = async (agreement) => {
    if (busy) return "Wait for the current action to finish.";
    setBusy("agreement"); setError(null); setNote(null);
    const r = await generateAgreement({ quoteId: dialog.doc.id, agreement, guard: generateGuard }, deps());
    try { await docs.reload(); } catch { /* shown by the list */ }
    setBusy(null);
    if (r.error && !r.doc) return r.error;
    setDialog(null); report(r, "Agreement");
    return null;
  };
  const submitEdit = async (agreement) => {
    if (busy) return "Wait for the current action to finish.";
    setBusy("edit"); setError(null); setNote(null);
    const r = await editAgreement(dialog.doc, agreement, deps());
    try { await docs.reload(); } catch { /* shown by the list */ }
    setBusy(null);
    if (r.error && !r.doc) return r.error;
    setDialog(null); report(r, "Agreement saved");
    return null;
  };
  const submitAccept = async (i) => {
    if (busy) return "Wait for the current action to finish.";
    setBusy("accept");
    try { await acceptOption(dialog.doc.id, i); } catch (e) { setBusy(null); return e.message; }
    try { await docs.reload(); } catch { /* shown by the list */ }
    setBusy(null); setDialog(null); setNote({ ok: true, text: `Option ${i + 1} accepted on ${dialog.doc.document_number}. You can now make the agreement.` });
    return null;
  };
  const submitSigned = async (date, file) => {
    if (busy) return "Wait for the current action to finish.";
    setBusy("signed");
    try { await recordSigned(dialog.doc.id, date, file); } catch (e) { setBusy(null); return e.message; }
    try { await docs.reload(); } catch { /* shown by the list */ }
    setBusy(null); setDialog(null); setNote({ ok: true, text: `Signed copy of ${dialog.doc.document_number} recorded.` });
    return null;
  };

  const openMail = (d) => { const m = mailOf(d); if (m) setMail({ id: m.id, subject: m.mail_subject || "", body: m.mail_body || "", docId: d.id }); };
  const mailDoc = mail ? all.find((d) => d.id === mail.docId) : null;
  const saveDraft = () => run("mail-save", async () => { await updateMail(mail.id, mail.subject, mail.body); setNote({ ok: true, text: "Mail changes saved." }); });
  // The recipient is the document's contact email; it is shown and confirmed before anything is sent.
  const send = (d) => {
    const resend = !!d.mail_sent_at;
    const to = d.contact_email;
    if (!to) { setError("This document has no contact email."); return; }
    if (!window.confirm(`${resend ? "Send again: " : ""}Send the PDF of ${d.document_number} to ${to}?`)) return;
    run("send", async () => { await updateMail(mail.id, mail.subject, mail.body); await sendDoc(d.id, resend); setNote({ ok: true, text: `${d.document_number} sent to ${to}.` }); });
  };

  const actionsCell = (d) => {
    const a = docActions(d, { canApprove: approver.data === true, hasAgreement: !isAccountingAgreement(d) && !!agreementOf(d), busy: !!busy });
    const off = a.busy;
    const key = (k) => `${k}-${d.id}`;
    return (
      <span className="bk-actions">
        {a.view && <button type="button" className="bk-link" onClick={() => openStored(d.storage_path).catch((e) => setError(e.message))}>View</button>}
        {a.word && <button type="button" className="bk-link" onClick={() => openWord(d.word_path).catch((e) => setError(e.message))}>Word</button>}
        {d.signed_path && <button type="button" className="bk-link" onClick={() => openStored(d.signed_path).catch((e) => setError(e.message))}>Signed copy</button>}
        {a.accept && <Button disabled={off} onClick={() => setDialog({ kind: "accept", doc: d })}>Accept option</Button>}
        {a.makeAgreement && <Button disabled={off} onClick={() => openAgreement(d)}>Agreement</Button>}
        {a.edit && <Button disabled={off} onClick={() => setDialog({ kind: "edit", doc: d, initial: d.field_values?.agreement })}>Edit</Button>}
        {a.approve && <Button variant="primary" disabled={off} busy={busy === key("approve")} onClick={() => run(key("approve"), async () => report(await approveAgreement(d, deps()), "Approval"))}>Approve</Button>}
        {a.retry && <Button disabled={off} busy={busy === key("retry")} onClick={() => run(key("retry"), async () => report(await retryDocument(d, deps(), { mail: !mailOf(d) }), "Files rebuilt for"))}>Retry</Button>}
        {a.recordSigned && !d.signed_path && <Button disabled={off} onClick={() => setDialog({ kind: "signed", doc: d })}>Record signed</Button>}
      </span>
    );
  };

  const oneDriveCell = (d) => {
    const a = docActions(d, { busy: !!busy });
    if (!d.storage_path) return "–";
    if (d.onedrive_path) return <Badge tone="good">In OneDrive</Badge>;
    return <span className="bk-actions"><Badge tone="warn">Not in OneDrive</Badge>{a.saveNow && <Button disabled={a.busy} busy={busy === `save-${d.id}`} onClick={() => run(`save-${d.id}`, async () => report(await saveToOneDrive(d, deps()), "Copy"))}>Save now</Button>}</span>;
  };

  const mailCell = (d) => {
    if (!mailOf(d)) return "–";
    return <span className="bk-actions"><button type="button" className="bk-link" onClick={() => openMail(d)}>Mail</button>{d.mail_sent_at && <Badge tone="good">Sent</Badge>}</span>;
  };

  return (
    <>
      <ErrorNote message={docs.error || error} onClose={error ? () => setError(null) : undefined} />
      {note && <div className={`bk-alert ${note.ok ? "bk-alert-ok" : "bk-alert-warn"}`}>{note.text}</div>}
      {mail && mailDoc && (() => {
        const a = docActions(mailDoc, { busy: !!busy });
        return (
          <Panel title={`Mail for ${typeLabel(mailDoc)} ${mailDoc.document_number}`} sub={`Sends the PDF only, to ${mailDoc.contact_email || "no email on file"}.${mailDoc.mail_sent_at ? ` Already sent ${fmtDateTime(mailDoc.mail_sent_at)} to ${mailDoc.mail_sent_to || "the client"}.` : ""}`}
            actions={<><Button disabled={a.busy} busy={busy === "mail-save"} onClick={saveDraft}>Save changes</Button>
              {a.send ? <Button variant="primary" disabled={a.busy || !mailDoc.contact_email} busy={busy === "send"} onClick={() => send(mailDoc)}>{a.resend ? "Resend" : "Send"}</Button> : <Button disabled>{a.awaitingApproval ? "Awaiting approval" : "No PDF yet"}</Button>}
              <Button onClick={() => setMail(null)}>Close</Button></>}>
            <div className="bk-field bk-mb"><label htmlFor="am-subj">Subject</label><input id="am-subj" value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })} /></div>
            <div className="bk-field"><label htmlFor="am-body">Message</label><textarea id="am-body" rows={10} value={mail.body} onChange={(e) => setMail({ ...mail, body: e.target.value })} /></div>
          </Panel>
        );
      })()}
      <Panel title="Quotes and agreements">
        <DataTable search="Search…" rows={rows} empty="Nothing generated yet." columns={[
          { key: "type", label: "Type", render: (d) => <Badge>{typeLabel(d)}</Badge> },
          { key: "document_number", label: "Ref" },
          { key: "client_name", label: "Client" },
          { key: "fee", label: "Fee", render: (d) => (d.field_values?.quote ? registerLabel(d) : "–") },
          { key: "created_at", label: "Date", render: (d) => fmtDate(d.created_at) },
          { key: "status", label: "Status", render: (d) => { const s = docStatus(d); return <Badge tone={s.tone}>{s.label}</Badge>; } },
          { key: "onedrive", label: "OneDrive", render: oneDriveCell },
          { key: "mail", label: "Mail", render: mailCell },
          { key: "actions", label: "Actions", render: actionsCell },
        ]} />
      </Panel>
      {dialog?.kind === "accept" && <AcceptOption doc={dialog.doc} onSubmit={submitAccept} onClose={() => setDialog(null)} />}
      {dialog?.kind === "agreement" && <AccountingAgreementForm title={`Agreement for ${dialog.doc.document_number}`} initial={dialog.initial} onSubmit={submitAgreement} onClose={() => setDialog(null)} />}
      {dialog?.kind === "edit" && <AccountingAgreementForm title={`Edit agreement ${dialog.doc.document_number}`} initial={dialog.initial} approved={!!dialog.doc.approved_at} onSubmit={submitEdit} onClose={() => setDialog(null)} />}
      {dialog?.kind === "signed" && <RecordSigned doc={dialog.doc} onSubmit={submitSigned} onClose={() => setDialog(null)} />}
    </>
  );
}
