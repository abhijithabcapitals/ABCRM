// Payments on one job. Payments are never edited: a mistake is fixed by a reversal. Each payment gets its receipt voucher.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, fmtDate, useAction } from "@banking/components/shared";
import { openStored } from "@template-hub/services/hubApi";
import { PAYMENT_METHODS, dubaiToday, paymentRowState } from "../logic/jobs";
import { addPayment, reversePayment } from "../services/jobsApi";
import { fileReceipt } from "../services/receipts";

const money = (n) => Number(n || 0).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PaymentsPanel({ job, onChange }) {
  const { error, setError, busy, act } = useAction(onChange);
  const [adding, setAdding] = useState(false);
  const [reversing, setReversing] = useState(null);
  const payments = job.payments || [];
  const hasFee = job.fee_amount != null || job.invoice_amount != null;

  // The receipt row carries the number; the payment row carries the figures the voucher shows.
  const createFile = (p) => fileReceipt({ receipt_id: p.receipt.id, receipt_number: p.receipt.receipt_number, amount: p.amount, paid_on: p.paid_on, method: p.method, reference: p.reference, note: p.note }, job);

  const record = async (v) => {
    const r = await addPayment({ job_id: job.id, amount: v.amount, paid_on: v.paid_on, method: v.method, reference: v.reference, note: v.note });
    try {
      await fileReceipt({ ...r, note: v.note }, job); // the function returns no note, so the form's note goes onto the voucher
    } catch (e) { setError(`Payment saved as ${r.receipt_number}, but the file was not created: ${e.message}`); }
    await onChange?.();
  };

  return (
    <div>
      <ErrorNote message={error} onClose={() => setError(null)} />
      <div className="bk-actions bk-mb">
        <Button variant="primary" disabled={!hasFee} onClick={() => setAdding(true)}>Record payment</Button>
        {!hasFee && <small className="bk-muted">Enter the fee before recording a payment.</small>}
      </div>
      <DataTable rows={payments} empty="No payments yet." columns={[
        { key: "paid_on", label: "Date", render: (p) => fmtDate(p.paid_on) },
        { key: "amount", label: "AED", right: true, render: (p) => money(p.amount) },
        { key: "method", label: "Method" },
        { key: "reference", label: "Reference" },
        { key: "receipt_number", label: "Receipt", render: (p) => p.receipt?.receipt_number || "–" },
        { key: "status", label: "Status", render: (p) => {
          const s = paymentRowState(p, payments);
          return s.reversal ? <Badge tone="warn">Reversal</Badge> : s.reversed ? <Badge tone="bad">Reversed</Badge> : <Badge tone="good">Recorded</Badge>;
        } },
        { key: "x", label: "", render: (p) => {
          const s = paymentRowState(p, payments);
          return (
            <span className="bk-actions">
              {p.receipt?.storage_path && <Button onClick={() => openStored(p.receipt.storage_path).catch((e) => setError(e.message))}>View</Button>}
              {p.receipt && !p.receipt.storage_path && <Button busy={busy} onClick={() => act(() => createFile(p))}>Create file</Button>}
              {s.canReverse && <Button onClick={() => setReversing(p)}>Reverse</Button>}
            </span>
          );
        } },
      ]} />
      {adding && (
        <FormModal title="Record payment" submitLabel="Record and issue receipt" initial={{ paid_on: dubaiToday(), method: "Bank transfer" }} onClose={() => setAdding(false)}
          note={`Balance now AED ${money(job.balance)}. A payment above the balance is refused.`}
          fields={[
            { name: "amount", label: "Amount (AED)", type: "number", required: true },
            { name: "paid_on", label: "Date", type: "date", required: true },
            { name: "method", label: "Method", type: "select", required: true, options: PAYMENT_METHODS },
            { name: "reference", label: "Reference" },
            { name: "note", label: "Note", full: true },
          ]}
          onSubmit={record} />
      )}
      {reversing && (
        <FormModal title={`Reverse ${reversing.receipt?.receipt_number || "payment"}`} submitLabel="Reverse" onClose={() => setReversing(null)}
          note="The payment and its receipt stay on record. The receipt shows as Reversed."
          fields={[{ name: "reason", label: "Reason", type: "textarea", required: true, full: true }]}
          onSubmit={async (v) => { await reversePayment(reversing.id, v.reason); await onChange?.(); }} />
      )}
    </div>
  );
}
