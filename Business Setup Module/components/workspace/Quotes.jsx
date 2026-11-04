// Each quote with its letter, and the handover to Accounts once its work is finished.
import { useState } from "react";
import { Badge, Button, ErrorNote, FilePick, FormModal, Panel, fmtDate, useAction, useLoad } from "@banking/components/shared";
import { createDocument, openStored } from "@template-hub/services/hubApi";
import { useSetup } from "../SetupContext";
import ZohoInvoicePanel from "../ZohoInvoicePanel";
import NewServiceFlow from "../NewServiceFlow";
import { acceptQuote, handoverState, rejectQuote, sendToAccounts, signLetter, uploadFile } from "../../services/businessSetupApi";
import { fileLetter, fileQuote } from "../../services/documents";
import { quoteTone } from "../../logic/statuses";
import { money } from "@app/money";


export default function Quotes({ w, clientId, reload }) {
  const { can } = useSetup();
  const [revising, setRevising] = useState(null);
  return (
    <div>
      {!w.quotes.length && <p className="bk-note">No quotes yet. Use + New Service on Overview.</p>}
      {w.quotes.map((q) => <Quote key={q.id} q={q} w={w} clientId={clientId} reload={reload} can={can} onRevise={() => setRevising(q)} />)}
      {revising && <NewServiceFlow w={w} clientId={clientId} revises={revising} onClose={() => setRevising(null)} onDone={async () => { setRevising(null); await reload(); }} />}
    </div>
  );
}

function Quote({ q, w, clientId, reload, can, onRevise }) {
  const letter = w.letters.find((l) => l.parent_id === q.id);
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
      <ul className="bk-list">{(q.lines || []).map((l, i) => <li key={i}>{l.description}: AED {money(l.amount)}</li>)}</ul>
      <div className="bk-actions bk-wrap">
        {q.storage_path ? <Button onClick={() => openStored(q.storage_path).catch((e) => setError(e.message))}>Open quote</Button>
          : quotes && <Button busy={busy} onClick={() => act(() => fileQuote(q))}>Create file</Button>}
        {quotes && q.status === "issued" && <>
          <Button variant="primary" busy={busy} onClick={() => act(async () => {
            const expired = q.valid_until && q.valid_until < new Date().toISOString().slice(0, 10);
            if (expired && !window.confirm(`This quote expired on ${fmtDate(q.valid_until)}. Accept it anyway?`)) return null;
            return acceptQuote(q.id, !!expired);
          })}>Mark accepted</Button>
          <Button onClick={() => setDialog("reject")}>Mark rejected</Button>
          <Button onClick={onRevise}>Revise</Button>
        </>}
        {quotes && q.status === "accepted" && !letter && <Button busy={busy} onClick={() => act(async () => { const doc = await createDocument({ doc_type: "letter", parent_id: q.id }); await fileLetter(doc); })}>Create engagement letter</Button>}
        {letter?.storage_path && <Button onClick={() => openStored(letter.storage_path).catch((e) => setError(e.message))}>Open letter {letter.document_number}</Button>}
        {quotes && letter && !letter.signed_at && <Button onClick={() => setDialog("sign")}>Record signing</Button>}
        {letter?.signed_at && <span className="bk-muted">Signed {fmtDate(letter.signed_at)}</span>}
      </div>
      {q.status === "accepted" && h && !held && (
        <div className="bk-mt">
          {h.ready ? <>
            <ZohoInvoicePanel />
            {Number(h.outstanding) > 0 && <p className="bk-note">AED {money(h.outstanding)} is still outstanding on this quote.</p>}
            {Number(h.net_paid) > 0 && w.services.filter((s) => s.quote_id === q.id).every((s) => s.status === "Cancelled") && <p className="bk-note">Every line is cancelled and AED {money(h.net_paid)} is still held.</p>}
            {can("setup.services.manage") && <Button variant="primary" onClick={() => setDialog("send")}>Send to Accounts</Button>}
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
