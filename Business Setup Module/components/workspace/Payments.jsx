// The ledger. Payments are never edited: a mistake is fixed by a reversal. Each payment gets its receipt voucher.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, fmtDate, today, useAction } from "@banking/components/shared";
import { openStored } from "@template-hub/services/hubApi";
import { useSetup } from "../SetupContext";
import { addPayment, addRefund, reversePayment } from "../../services/businessSetupApi";
import { fileReceipt } from "../../services/documents";

const money = (n) => Number(n || 0).toLocaleString("en-AE", { maximumFractionDigits: 2 });

export default function Payments({ w, reload }) {
  const { can } = useSetup();
  const manage = can("setup.payments.manage");
  const { error, setError, busy, act } = useAction(reload);
  const [adding, setAdding] = useState(false);
  const [reversing, setReversing] = useState(null);
  const [refunding, setRefunding] = useState(false);
  const accepted = w.quotes.filter((q) => q.status === "accepted");
  const reversed = new Set(w.payments.filter((p) => p.type === "Reversal").map((p) => p.reverses_id));
  const number = (id) => w.quotes.find((q) => q.id === id)?.document_number || "";
  return (
    <div>
      <ErrorNote message={error} onClose={() => setError(null)} />
      {manage && <div className="bk-actions bk-mb"><Button variant="primary" disabled={!accepted.length} onClick={() => setAdding(true)}>+ Record payment</Button><Button disabled={!accepted.some((q) => Number(q.balance?.net_paid) > 0)} onClick={() => setRefunding(true)}>Record refund</Button>{!accepted.length && <small className="bk-muted">A payment needs an accepted quote.</small>}</div>}
      <DataTable rows={w.payments} empty="No payments yet." columns={[
        { key: "paid_on", label: "Date", render: (p) => fmtDate(p.paid_on) }, { key: "quote_id", label: "Quote", render: (p) => number(p.quote_id) },
        { key: "type", label: "Type", render: (p) => <Badge tone={p.type === "Payment" ? (reversed.has(p.id) ? "bad" : "good") : "warn"}>{reversed.has(p.id) ? "Reversed" : p.type}</Badge> },
        { key: "amount", label: "AED", right: true, render: (p) => money(p.amount) }, { key: "method", label: "Method" }, { key: "reference", label: "Reference" }, { key: "receipt_number", label: "Receipt" },
        { key: "x", label: "", render: (p) => (
          <span className="bk-actions">
            {p.receipt_path && <Button onClick={() => openStored(p.receipt_path).catch((e) => setError(e.message))}>Open</Button>}
            {manage && p.receipt_id && !p.receipt_path && <Button busy={busy} onClick={() => act(() => fileReceipt(p, w.client.legal_name, number(p.quote_id)))}>Create file</Button>}
            {manage && p.type === "Payment" && !reversed.has(p.id) && <Button onClick={() => setReversing(p)}>Reverse</Button>}
          </span>
        ) },
      ]} />
      {adding && <FormModal title="Record payment" submitLabel="Record and issue receipt" initial={{ quote_id: accepted[0]?.id, paid_on: today() }} onClose={() => setAdding(false)}
        note={can("setup.payments.override") ? "An amount above the balance needs a reason." : "An amount above the balance is refused."}
        fields={[{ name: "quote_id", label: "Quote", type: "select", required: true, options: accepted.map((q) => ({ value: q.id, label: `${q.document_number}: outstanding AED ${money(q.balance?.outstanding)}` })) },
          { name: "amount", label: "Amount (AED)", type: "number", required: true }, { name: "paid_on", label: "Date", type: "date", required: true },
          { name: "method", label: "Method", type: "select", options: ["Bank transfer", "Cash", "Cheque", "Card", "Other"] }, { name: "reference", label: "Reference" }, { name: "note", label: "Note", full: true },
          ...(can("setup.payments.override") ? [{ name: "override_reason", label: "Reason, if above the balance", full: true }] : [])]}
        onSubmit={async (v) => {
          const r = await addPayment(v);
          try {
            await fileReceipt({ ...v, receipt_id: r.receipt_id, receipt_number: r.receipt_number }, w.client.legal_name, number(v.quote_id));
          } catch (e) { setError(`Payment saved as ${r.receipt_number}, but the file was not created: ${e.message}. Use Create file.`); }
          await reload();
        }} />}
      {refunding && <FormModal title="Record refund" submitLabel="Record refund" note="For money really returned to the client. To undo a payment recorded by mistake, use Reverse." initial={{ quote_id: accepted.find((q) => Number(q.balance?.net_paid) > 0)?.id }} onClose={() => setRefunding(false)}
        fields={[{ name: "quote_id", label: "Quote", type: "select", required: true, options: accepted.filter((q) => Number(q.balance?.net_paid) > 0).map((q) => ({ value: q.id, label: `${q.document_number}: paid AED ${money(q.balance?.net_paid)}` })) },
          { name: "amount", label: "Amount (AED)", type: "number", required: true }, { name: "method", label: "Method", type: "select", options: ["Bank transfer", "Cash", "Cheque", "Card", "Other"] }, { name: "reference", label: "Reference" }, { name: "reason", label: "Reason", type: "textarea", required: true, full: true }]}
        onSubmit={async (v) => { await addRefund(v); await reload(); }} />}
      {reversing && <FormModal title={`Reverse ${reversing.receipt_number}`} submitLabel="Reverse" note="The payment and receipt stay on record. The receipt shows as Reversed." fields={[{ name: "reason", label: "Reason", type: "textarea", required: true, full: true }]} onClose={() => setReversing(null)}
        onSubmit={async (v) => { await reversePayment(reversing.id, v.reason); await reload(); }} />}
    </div>
  );
}
