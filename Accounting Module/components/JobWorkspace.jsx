// One job: summary and status, file batches, new client steps, payments, invoice and history.
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, KeyVals, Modal, Panel, Spinner, fmtDate, fmtDateTime, useAction, useLoad } from "@banking/components/shared";
import { flagMissing } from "@banking/components/Attention";
import { profiles } from "@banking/services/bankingApi";
import ServiceDesk from "@template-hub/components/ServiceDesk";
import { RECEIPT_MODES, STALE_MESSAGE, WORK_STATUSES, assigneeText, dubaiToday, feeConflict, findLookupRow, hasUnreversedPayment, isStaleSave, needsRemarks, parseFileNames, sameClientName } from "../logic/jobs";
import { addBatch, clearInvoice, clientOptions, getJob, linkClient, linkDocument, setBatchSaved, setFee, setInvoice, setStatus } from "../services/jobsApi";
import { FollowUpLog } from "./FollowUps";
import JobForm from "./JobForm";
import PaymentsPanel from "./PaymentsPanel";

const money = (n) => (n == null ? "–" : Number(n).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const PAY_TONE = { Settled: "good", Overpaid: "bad", "Part paid": "warn", "No fee": "warn" };
const friendly = (message) => (isStaleSave(message) ? STALE_MESSAGE : message);

// Status and remarks. Remounted (key) whenever the job reloads, so the fields follow the saved values.
function StatusForm({ job, onSave, busy }) {
  const [status, setStatusValue] = useState(job.work_status);
  const [remarks, setRemarks] = useState(job.remarks ?? "");
  const submit = (e) => {
    e.preventDefault();
    if (needsRemarks(status) && !remarks.trim()) { flagMissing(["ws-remarks"]); return onSave(null, `${status} needs remarks saying why.`); }
    return onSave(status, remarks);
  };
  return (
    <form onSubmit={submit} className="bk-grid">
      <div className="bk-field">
        <label htmlFor="ws-status">Work status</label>
        <select id="ws-status" value={status} onChange={(e) => setStatusValue(e.target.value)}>{WORK_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
      </div>
      <div className="bk-field bk-full">
        <label htmlFor="ws-remarks">Remarks{needsRemarks(status) && <em> *</em>}</label>
        <textarea id="ws-remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        {needsRemarks(status) && <small>Say what is pending or why the client cancelled.</small>}
      </div>
      <div className="bk-field"><Button type="submit" variant="primary" busy={busy}>Save status</Button></div>
    </form>
  );
}

export default function JobWorkspace({ jobId, profile, onClose }) {
  const loaded = useLoad(() => getJob(jobId), [jobId]);
  const people = useLoad(profiles, []);
  const clients = useLoad(clientOptions, []).data || []; // linking and filling in still work by hand if this fails
  const { error, setError, busy, act } = useAction(loaded.reload);
  const [modal, setModal] = useState(null); // edit | fee | client | batch | quote | letter | invoice | clear
  const [pendingQuote, setPendingQuote] = useState(null);
  const [pendingOther, setPendingOther] = useState(null); // a document filed for another client
  const [notice, setNotice] = useState(null);
  const [stale, setStale] = useState(false);
  const job = loaded.data;
  const jobRef = useRef(null);
  jobRef.current = job;
  const nameById = useMemo(() => Object.fromEntries((people.data || []).map((p) => [p.id, p.full_name])), [people.data]);
  useEffect(() => { if (error && isStaleSave(error)) setStale(true); }, [error]);
  const run = act; // database refusals land in the error note; forms keep what was typed because they show their own errors

  if (!job) return <Modal title="Job" onClose={onClose} wide>{loaded.loading ? <Spinner /> : <ErrorNote message={loaded.error} />}</Modal>;

  const match = findLookupRow(clients, job.client_name);
  const master = clients.filter((c) => Number(c.rank) === 1 && c.ref);
  const done = job.work_status === "Completed";
  const diff = job.invoice_amount != null && job.fee_amount != null ? Number(job.invoice_amount) - Number(job.fee_amount) : null;

  // Details the quotation form starts from, taken from the client lookup when the name matches.
  const deskInitial = {
    client: job.client_name, service: job.service_name,
    ...Object.fromEntries(["contact", "email", "phone", "address", "license", "trn"].filter((k) => match?.[k]).map((k) => [k, match[k]])),
  };
  // Called by ServiceDesk once a quotation or letter is filed. A quote total that differs from the fee asks which to keep.
  const linkNow = (doc) => {
    const current = jobRef.current;
    if (doc.doc_type === "quote" && feeConflict(current, doc)) { setPendingQuote(doc); return; }
    run(() => linkDocument(current.id, doc.doc_type, doc.id));
  };
  // Called by ServiceDesk once a quotation or letter is filed. Another client's document asks first; a differing fee asks which to keep.
  const onDocument = (doc) => {
    if (!sameClientName(doc.client_name, jobRef.current.client_name)) { setPendingOther(doc); return; }
    linkNow(doc);
  };
  // Closing the fee question without choosing still links the quote, keeping the job fee.
  const settleQuote = async (useTotal) => {
    const d = pendingQuote;
    setPendingQuote(null);
    const ok = await run(() => linkDocument(job.id, "quote", d.id, useTotal));
    if (ok) setNotice(useTotal ? `Quotation ${d.document_number} linked and the job fee changed to the quotation total.` : `Quotation ${d.document_number} linked. The job fee was kept.`);
  };

  const checks = [
    ["Quotation", !!job.quote_id],
    ["Engagement letter", !!job.letter_id],
    ["Receipt", hasUnreversedPayment(job.payments)],
  ];
  const message = (error && friendly(error)) || loaded.error || people.error;

  return (
    <Modal title={`${job.job_number}: ${job.client_name}`} onClose={onClose} wide>
      <ErrorNote message={message} onClose={() => setError(null)} />

      {notice && <p className="bk-note">{notice} <Button onClick={() => setNotice(null)}>OK</Button></p>}
      {stale && <p className="bk-note">{STALE_MESSAGE} <Button onClick={() => { setStale(false); loaded.reload(); }}>Reload</Button></p>}
      <Panel title="Summary and status" actions={<><Button onClick={() => setModal("edit")}>Edit</Button><Button onClick={() => setModal("fee")}>{job.fee_amount == null ? "Set fee" : "Change fee"}</Button></>}>
        <KeyVals items={[
          ["Client", job.client_name], ["Service", job.service_name], ["Period", job.period_label], ["Due date", job.due_date ? fmtDate(job.due_date) : null],
          ["Assignees", assigneeText(job, nameById)], ["New client", job.is_new_client ? "Yes" : "No"],
          ["Fee (AED)", money(job.fee_amount)], ["Amount due (AED)", money(job.amount_due)], ["Paid (AED)", money(job.paid_total)], ["Balance (AED)", money(job.balance)],
          ["Payment status", <Badge tone={PAY_TONE[job.payment_status]}>{job.payment_status}</Badge>],
          ["Completed", job.completed_at ? fmtDateTime(job.completed_at) : null],
          ["Client record", job.client_id ? `Linked (${job.client_id})` : "Not linked"],
        ]} />
        <StatusForm key={job.updated_at} job={job} busy={busy} onSave={(status, remarks) => (status === null ? setError(remarks) : run(() => setStatus(job.id, status, remarks, job.updated_at)))} />
        {!job.client_id && (
          <div className="bk-actions bk-mb">
            <Button onClick={() => setModal("client")}>Link client</Button>
            <small className="bk-muted">Zoho needs a Client Master record, so link one before a Zoho invoice.</small>
          </div>
        )}
      </Panel>

      <Panel title="File batches" actions={<Button onClick={() => setModal("batch")}>Add batch</Button>}>
        <DataTable rows={job.batches} empty="No files recorded yet." columns={[
          { key: "received_on", label: "Received", render: (b) => fmtDate(b.received_on) },
          { key: "receipt_mode", label: "Mode", render: (b) => (b.mode_note ? `${b.receipt_mode}: ${b.mode_note}` : b.receipt_mode) },
          { key: "files", label: "Files", render: (b) => b.files.map((f) => f.file_name).join(", ") },
          { key: "saved_to_folder", label: "Saved to client folder", render: (b) => (
            <label className="bk-check"><input type="checkbox" checked={!!b.saved_to_folder} disabled={busy} onChange={(e) => run(() => setBatchSaved(b.id, e.target.checked))} /> {b.saved_to_folder ? fmtDate(b.saved_at) : "Not yet"}</label>
          ) },
        ]} />
      </Panel>

      <Panel title="Quotation and letter" sub="Each is saved on the job when it is created." actions={<>
        <Button onClick={() => setModal("quote")}>{job.quote_id ? "Generate quotation again" : "Generate quotation"}</Button>
        <Button onClick={() => setModal("letter")}>{job.letter_id ? "Generate letter again" : "Generate letter"}</Button>
      </>}>
        {job.is_new_client && (
          <>
            <p className="bk-note">New client steps. A checklist. It does not block any work.</p>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {checks.map(([label, ok]) => (
                <li key={label} className="bk-mb">
                  <Badge tone={ok ? "good" : "warn"}>{ok ? "Done" : "To do"}</Badge> {label}{" "}
                  {label === "Receipt" && !ok && <small className="bk-muted">Record a payment below to issue the receipt.</small>}
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      <Panel title="Payments"><PaymentsPanel job={job} onChange={loaded.reload} /></Panel>

      <Panel title="Invoice" actions={done && (job.invoice_number ? <Button onClick={() => setModal("clear")}>Clear invoice</Button> : <Button variant="primary" onClick={() => setModal("invoice")}>Record invoice</Button>)}>
        {!done && <p className="bk-note">An invoice can be recorded once the job is Completed.</p>}
        {job.invoice_number
          ? <KeyVals items={[["Invoice number", job.invoice_number], ["Invoice date", fmtDate(job.invoice_date)], ["Invoice amount (AED)", money(job.invoice_amount)], ["Fee (AED)", money(job.fee_amount)], ["Difference from fee (AED)", diff == null ? null : money(diff)]]} />
          : done && <p className="bk-note">No invoice recorded yet.</p>}
      </Panel>

      <FollowUpLog job={job} profile={profile} onChange={loaded.reload} />

      <Panel title="History">
        <DataTable rows={job.events} empty="No history." pageSize={10} columns={[
          { key: "created_at", label: "When", render: (e) => fmtDateTime(e.created_at) },
          { key: "event", label: "Event" },
          { key: "change", label: "Change", render: (e) => (e.from_value || e.to_value ? `${e.from_value ?? "–"} → ${e.to_value ?? "–"}` : "–") },
          { key: "remarks", label: "Remarks" },
          { key: "created_by", label: "By", render: (e) => nameById[e.created_by] || "–" },
        ]} />
      </Panel>

      {modal === "edit" && <JobForm job={job} onClose={() => setModal(null)} onSaved={async () => { setModal(null); await loaded.reload(); }} />}
      {modal === "fee" && (
        <FormModal title="Fee" initial={{ amount: job.fee_amount ?? "" }} onClose={() => setModal(null)} note="AED, including any VAT. The change is recorded in the history."
          fields={[{ name: "amount", label: "Fee (AED)", type: "number", required: true }]}
          onSubmit={async (v) => { await setFee(job.id, v.amount); await loaded.reload(); }} />
      )}
      {modal === "client" && (
        <FormModal title="Link client" initial={{ client: match && Number(match.rank) === 1 ? String(match.ref) : "" }} onClose={() => setModal(null)}
          note={master.length ? "Choose the Client Master record for this job." : "No Client Master records found. Add the client in Client Master first."}
          fields={[{ name: "client", label: "Client Master record", type: "select", required: true, options: master.map((c) => ({ value: String(c.ref), label: c.name })) }]}
          onSubmit={async (v) => { await linkClient(job.id, v.client); await loaded.reload(); }} />
      )}
      {modal === "batch" && (
        <FormModal title="Add file batch" submitLabel="Add batch" wide initial={{ received_on: dubaiToday(), receipt_mode: "Email" }} onClose={() => setModal(null)}
          fields={[
            { name: "received_on", label: "Date received", type: "date", required: true },
            { name: "receipt_mode", label: "Mode of receipt", type: "select", required: true, options: RECEIPT_MODES },
            { name: "mode_note", label: "Note (needed for Other)", help: "How the files arrived." },
            { name: "files", label: "File names", type: "textarea", rows: 5, required: true, full: true, help: "One file name per line." },
          ]}
          onSubmit={async (v) => {
            if (v.received_on > dubaiToday()) { flagMissing(["f-received_on"]); throw new Error("The date received cannot be in the future."); }
            if (v.receipt_mode === "Other" && !v.mode_note) { flagMissing(["f-mode_note"]); throw new Error("Other needs a note saying how the files arrived."); }
            const files = parseFileNames(v.files);
            if (!files.length) { flagMissing(["f-files"]); throw new Error("Add at least one file name."); }
            await addBatch({ job_id: job.id, received_on: v.received_on, receipt_mode: v.receipt_mode, mode_note: v.mode_note, files });
            await loaded.reload();
          }} />
      )}
      {(modal === "quote" || modal === "letter") && (
        <Modal title={modal === "quote" ? "Generate quotation" : "Generate engagement letter"} wide onClose={() => setModal(null)}>
          <p className="bk-note">{modal === "letter" ? "Pick the quotation in the list and generate its letter. It is saved on the job." : "The quotation is saved on the job when it is created."}</p>
          <ServiceDesk department={job.service_department} profile={profile} initial={deskInitial} onDocument={onDocument} />
        </Modal>
      )}
      {pendingOther && (
        <Modal title="Different client" onClose={() => setPendingOther(null)}>
          <p>{pendingOther.document_number} is for {pendingOther.client_name}. Link it to this job anyway?</p>
          <div className="bk-modal-actions">
            <Button onClick={() => setPendingOther(null)}>Do not link</Button>
            <Button variant="primary" onClick={() => { const d = pendingOther; setPendingOther(null); linkNow(d); }}>Link anyway</Button>
          </div>
        </Modal>
      )}
      {pendingQuote && (
        <Modal title="Which fee to keep?" onClose={() => settleQuote(false)}>
          <p>The job fee is AED {money(job.fee_amount)}. The quotation total is AED {money(pendingQuote.total_amount)}. Closing this keeps the job fee.</p>
          <div className="bk-modal-actions">
            <Button onClick={() => settleQuote(false)}>Keep job fee</Button>
            <Button variant="primary" onClick={() => settleQuote(true)}>Use quotation total</Button>
          </div>
        </Modal>
      )}
      {modal === "invoice" && (
        <FormModal title="Record invoice" submitLabel="Record invoice" initial={{ number: "", date: dubaiToday(), amount: job.fee_amount ?? "" }} onClose={() => setModal(null)}
          note={job.fee_amount == null ? "The job has no fee yet." : `The fee is AED ${money(job.fee_amount)}. A different amount is allowed and the difference is shown.`}
          fields={[
            { name: "number", label: "Zoho invoice number", required: true },
            { name: "date", label: "Invoice date", type: "date", required: true },
            { name: "amount", label: "Amount (AED)", type: "number", required: true },
          ]}
          onSubmit={async (v) => { await setInvoice(job.id, v.number, v.date, v.amount); await loaded.reload(); }} />
      )}
      {modal === "clear" && (
        <FormModal title="Clear invoice" submitLabel="Clear invoice" onClose={() => setModal(null)} note="The invoice is removed from the job and the history keeps the reason."
          fields={[{ name: "reason", label: "Reason", type: "textarea", required: true, full: true }]}
          onSubmit={async (v) => { await clearInvoice(job.id, v.reason); await loaded.reload(); }} />
      )}
    </Modal>
  );
}
