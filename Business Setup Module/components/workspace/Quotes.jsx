// Each quote with its letter, what the client decided on them, and the handover to Accounts once its work is finished.
import { useState } from "react";
import { Badge, Button, ErrorNote, FilePick, FormModal, Panel, fmtDate, useAction, useLoad } from "@banking/components/shared";
import { staffCall } from "@client-login/admin/ClientPortalAdmin";
import { createDocument, openStored } from "@template-hub/services/hubApi";
import { isProposal, isUndecidedProposal } from "@template-hub/logic/proposalModel";
import { useSetup } from "../SetupContext";
import ZohoPanel from "@integrations/components/ZohoPanel";
import NewServiceFlow from "../NewServiceFlow";
import { addStaffSignedCopy, caseDocuments, handoverState, listDecisions, listSigned, rejectQuote, sendToAccounts, signLetter, signedDecide, uploadFile } from "../../services/businessSetupApi";
import { currentLetter, lastDecision, letterHistory } from "../../logic/caseWorkspace";
import { fileLetter, fileQuote } from "../../services/documents";
import { quoteTone, zohoProps } from "../../logic/statuses";
import { money } from "@app/money";
import { supabase } from "@app/supabase";


export default function Quotes({ w, clientId, reload, caseId = null }) {
  const { can } = useSetup();
  const [revising, setRevising] = useState(null);
  const [copying, setCopying] = useState(null);
  const [adding, setAdding] = useState(false);
  // What the client decided (with the note on a rejection), and the case's earlier letters: a letter that was rejected or replaced leaves the workspace.
  const ids = [...w.quotes.map((q) => q.id), ...w.letters.map((l) => l.id)].join(",");
  const decisions = useLoad(() => listDecisions(ids ? ids.split(",") : []), [ids]);
  const docs = useLoad(() => (caseId ? caseDocuments(caseId) : Promise.resolve([])), [caseId, ids]);
  // One quote chain per case: while a quote is live (not rejected), the way to change it is Revise. The database refuses a second one with its own sentence.
  const live = w.quotes.some((q) => !["rejected", "superseded"].includes(q.status));
  return (
    <div>
      {caseId && can("setup.quotes.manage") && !live && <div className="bk-actions bk-mb"><Button variant="primary" onClick={() => setAdding(true)}>New quote</Button></div>}
      <ErrorNote message={decisions.error || docs.error} />
      {!w.quotes.length && <p className="bk-note">{caseId ? "No quote yet for this case." : "No quotes yet. Open a case to issue one."}</p>}
      {w.quotes.map((q) => <Quote key={q.id} q={q} w={w} clientId={clientId} reload={reload} can={can} decisions={decisions.data} onRevise={() => setRevising(q)} onCopy={() => setCopying(q)} />)}
      {caseId && letterHistory(docs.data).length > 0 && <LetterHistory rows={letterHistory(docs.data)} decisions={decisions.data} />}
      {adding && <NewServiceFlow w={w} clientId={clientId} caseId={caseId} onClose={() => setAdding(false)} onDone={async () => { setAdding(false); await reload(); }} />}
      {revising && <NewServiceFlow w={w} clientId={clientId} caseId={caseId} revises={revising} onClose={() => setRevising(null)} onDone={async () => { setRevising(null); await reload(); }} />}
      {copying && <NewServiceFlow w={w} clientId={clientId} caseId={caseId} from={copying} onClose={() => setCopying(null)} onDone={async () => { setCopying(null); await reload(); }} />}
    </div>
  );
}

// What the client decided on a document, with the note they wrote when they rejected it. Nothing when nobody has decided.
function Decision({ rows, doc, label }) {
  const d = lastDecision(rows, doc.id);
  if (!d) return null;
  return <p className={d.decision === "Rejected" ? "bk-note bk-overdue" : "bk-note"}>The client {d.decision.toLowerCase()} {label} on {fmtDate(d.created_at)}{d.source === "Staff" ? " (signed copy confirmed by staff)" : d.username ? ` as ${d.username}` : ""}.{d.note && <> Note: {d.note}</>}</p>;
}

// Letters that were rejected or replaced, kept for the record. A new letter replaces a rejected one, which then no longer belongs to the quote.
function LetterHistory({ rows, decisions }) {
  return (
    <Panel title="Earlier letters" sub="Rejected or replaced. The current letter is shown with its quote.">
      <ul className="bk-list">{rows.map((l) => (
        <li key={l.id}>{l.document_number} · {fmtDate(l.created_at)} <Badge tone="bad">{l.status === "superseded" ? "Replaced" : "Rejected"}</Badge>{l.status_reason && <> · {l.status_reason}</>}
          <Decision rows={decisions} doc={l} label="this letter" /></li>
      ))}</ul>
    </Panel>
  );
}

function Quote({ q, w, clientId, reload, can, decisions, onRevise, onCopy }) {
  const letter = currentLetter(w.letters, q.id);
  const rejectedLetter = (w.letters || []).find((l) => l.parent_id === q.id && l.status === "rejected");
  const quotes = can("setup.quotes.manage");
  const state = useLoad(() => (q.status === "accepted" ? handoverState(q.id) : Promise.resolve(null)), [q.id, q.status, w.services.length, w.payments.length]);
  const after = async () => { await reload(); await state.reload(); };
  const { error, setError, busy, act } = useAction(after);
  const [dialog, setDialog] = useState(null);
  const [scan, setScan] = useState(null);
  const h = state.data;
  const held = ["With Accounts", "Closed"].includes(h?.state);
  return (
    <Panel title={<>{q.document_number} <Badge tone={quoteTone(q.status)}>{q.status}</Badge>{h?.state && <> <Badge>{h.state}</Badge></>}</>}
      sub={`${fmtDate(q.created_at)} · AED ${money(q.total_amount)} · net paid ${money(q.balance?.net_paid)} · outstanding ${money(q.balance?.outstanding)}`}>
      <ErrorNote message={error || state.error} onClose={error ? () => setError(null) : undefined} />
      {h?.state === "Reverted" && <div className="bk-alert bk-alert-warn">Accounts reverted this quote: {h.remarks}</div>}
      <Decision rows={decisions} doc={q} label="this quote" />
      {isUndecidedProposal(q) && <p className="bk-note">Proposal with {q.field_values.proposal.options.length} options, none chosen yet.</p>}
      <ul className="bk-list">{(q.lines || []).map((l, i) => <li key={i}>{l.description}: AED {money(l.amount)}{l.scope && <div className="bk-muted">Scope: {l.scope}</div>}</li>)}</ul>
      {isUndecidedProposal(q) ? (quotes && q.status === "issued" && <p className="bk-note">Record the client&apos;s choice in Service Documents</p>) : <SignedCopy q={q} clientId={clientId} manage={quotes} after={after} setError={setError} />}
      <div className="bk-actions bk-wrap">
        {q.storage_path ? <Button onClick={() => openStored(q.storage_path).catch((e) => setError(e.message))}>Open quote</Button>
          : quotes && !q.library_template && <Button busy={busy} onClick={() => act(() => fileQuote(q))}>Create file</Button>}
        {quotes && q.status === "issued" && <>
          <Button onClick={() => setDialog("reject")}>Mark rejected</Button>
          {!q.library_template && <Button onClick={onRevise}>Revise</Button>}
        </>}
        {quotes && q.status === "rejected" && !isProposal(q) && <Button onClick={onCopy}>Revise</Button>}
        {quotes && q.status === "accepted" && !letter && (isProposal(q) ? <span className="bk-muted">Create the letter from Service Documents</span> : <Button busy={busy} onClick={() => act(async () => { const doc = await createDocument({ doc_type: "letter", parent_id: q.id }); await fileLetter(doc); })}>Create engagement letter</Button>)}
        {letter?.storage_path && <Button onClick={() => openStored(letter.storage_path).catch((e) => setError(e.message))}>Open letter {letter.document_number}</Button>}
        {quotes && letter && !letter.signed_at && <Button onClick={() => setDialog("sign")}>Record signing</Button>}
        {letter?.signed_at && <span className="bk-muted">Signed {fmtDate(letter.signed_at)}</span>}
      </div>
      {letter && <Decision rows={decisions} doc={letter} label="the letter" />}
      {rejectedLetter && <div className="bk-note bk-overdue">Letter {rejectedLetter.document_number} was rejected by the client. Create a new engagement letter to replace it.<Decision rows={decisions} doc={rejectedLetter} label="the letter" /></div>}
      {["issued", "accepted"].includes(q.status) && !isUndecidedProposal(q) && (
        <div className="bk-mt">
          <ZohoPanel key={`${q.id}:${clientId}`} supabase={supabase} department="business_setup" sourceTable="hub_documents" sourceId={q.id} clientId={clientId} publish={q.status === "accepted" ? { onPublished: () => { after().catch((e) => setError(e.message)); } } : undefined} {...zohoProps(q.status, { quotes, held, ready: !!h?.ready, known: !!h, invoiceRight: can("setup.services.manage") })} />
        </div>
      )}
      {q.status === "accepted" && h && !held && (
        <div className="bk-mt">
          {h.ready ? <>
            {Number(h.outstanding) > 0 && <p className="bk-note">AED {money(h.outstanding)} is still outstanding on this quote.</p>}
            {Number(h.net_paid) > 0 && w.services.filter((s) => s.quote_id === q.id).every((s) => s.status === "Cancelled") && <p className="bk-note">Every line is cancelled and AED {money(h.net_paid)} is still held.</p>}
            {can("setup.cases.approve") && <Button variant="primary" onClick={() => setDialog("send")}>Send to Accounts</Button>}
          </> : <p className="bk-note">To send to Accounts: {h.blockers.join(", ")}.</p>}
        </div>
      )}
      {dialog === "reject" && <FormModal title="Mark rejected" fields={[{ name: "reason", label: "Reason", type: "textarea", required: true, full: true }]} onClose={() => setDialog(null)} onSubmit={async (v) => { await rejectQuote(q.id, v.reason); await after(); }} />}
      {dialog === "send" && <FormModal title="Send to Accounts" submitLabel="Send" note="This quote, its services and payments cannot change while Accounts holds it." fields={[{ name: "remarks", label: "Remarks for Accounts", type: "textarea", full: true }]} onClose={() => setDialog(null)} onSubmit={async (v) => { await sendToAccounts(q.id, v.remarks); await after(); }} />}
      {dialog === "sign" && <FormModal title="Record signing" note={<FilePick label={scan ? scan.name : "Attach signed scan"} onFile={setScan} />} fields={[{ name: "date", label: "Signed on", type: "date", required: true }]} onClose={() => setDialog(null)}
        onSubmit={async (v) => { const path = scan ? await uploadFile(clientId, scan, "signed") : null; await signLetter(letter.id, v.date, path); await after(); }} />}
    </Panel>
  );
}

// The client signs the quote and uploads it in the portal (or staff add the file for them). Confirming it accepts the quote.
function SignedCopy({ q, clientId, manage, after, setError }) {
  const list = useLoad(() => listSigned(q.id), [q.id, q.status]);
  const { error, setError: setActionError, busy, act } = useAction(async () => { await list.reload(); await after(); });
  const [refusing, setRefusing] = useState(null);
  const rows = list.data || [];
  const waiting = rows.find((s) => s.status === "Uploaded");
  const open = async (s) => { try { window.open((await staffCall("staff_signed_url", { id: s.id })).url, "_blank", "noopener"); } catch (e) { setError(e.message); } };
  const confirm = (s) => act(async () => {
    const expired = q.valid_until && q.valid_until < new Date().toISOString().slice(0, 10);
    if (expired && !window.confirm(`This quote expired on ${fmtDate(q.valid_until)}. Accept it anyway?`)) return null;
    return signedDecide(s.id, true, null, !!expired);
  });
  if (!rows.length && !(manage && q.status === "issued")) return null;
  return (
    <div className="bk-mt">
      <strong>Signed copy</strong>
      <ErrorNote message={list.error || error} onClose={error ? () => setActionError(null) : undefined} />
      {!rows.length && <p className="bk-note">None yet. The client can accept in the portal, or add a signed file here.</p>}
      <ul className="bk-list">{rows.map((s) => (
        <li key={s.id}>{s.source} · {fmtDate(s.created_at)} <Badge tone={s.status === "Confirmed" ? "good" : s.status === "Refused" ? "bad" : "warn"}>{s.status === "Uploaded" ? "Waiting for review" : s.status}</Badge>
          {s.note && <> · {s.note}</>} {s.storage_path && manage && <Button onClick={() => open(s)}>Open</Button>}
          {manage && s.status === "Uploaded" && <> <Button variant="primary" busy={busy} onClick={() => confirm(s)}>Confirm and accept</Button> <Button onClick={() => setRefusing(s)}>Refuse</Button></>}</li>
      ))}</ul>
      {manage && q.status === "issued" && !waiting && <FilePick label="Add signed copy" accept=".pdf,image/*" busy={busy} onFile={(f) => act(() => addStaffSignedCopy(q.id, clientId, f))} />}
      {refusing && <FormModal title="Refuse the signed copy" submitLabel="Refuse" note="The client sees this note in the portal and can upload again." fields={[{ name: "note", label: "Note for the client", type: "textarea", required: true, full: true }]}
        onClose={() => setRefusing(null)} onSubmit={async (v) => { await signedDecide(refusing.id, false, v.note); await list.reload(); await after(); }} />}
    </div>
  );
}
