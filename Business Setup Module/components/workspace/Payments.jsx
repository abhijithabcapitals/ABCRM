// The ledger. Payments are never edited: a mistake is fixed by a reversal. Each payment gets its receipt voucher.
// On a case, a payment is recorded on the case: before the quote is accepted it is held as an advance, and it counts toward the quote once
// accepted. A case with no client yet gets its client first (the same checked step as Share link, without a login).
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, fmtDate, today, useAction } from "@banking/components/shared";
import { openStored } from "@template-hub/services/hubApi";
import { useSetup } from "../SetupContext";
import { addPayment, addRefund, caseLinkClientForPayment, casePaidOverride, reversePayment } from "../../services/businessSetupApi";
import { paymentLinkError, validAmount } from "../../logic/quoteMessage";
import { fileReceipt } from "../../services/documents";
import { money } from "@app/money";


export default function Payments({ w, reload, caseId = null, caseRow = null, onChanged }) {
  const { can } = useSetup();
  const manage = can("setup.payments.manage");
  const { error, setError, busy, act } = useAction(reload);
  const [adding, setAdding] = useState(false);
  const [reversing, setReversing] = useState(null);
  const [refunding, setRefunding] = useState(false);
  const [waiving, setWaiving] = useState(false);
  const quotes = w?.quotes || [];
  const payments = w?.payments || [];
  const accepted = quotes.filter((q) => q.status === "accepted");
  const reversed = new Set(payments.filter((p) => p.type === "Reversal").map((p) => p.reverses_id));
  const number = (id) => quotes.find((q) => q.id === id)?.document_number || "";
  const clientName = w?.client?.legal_name || caseRow?.client_name || caseRow?.lead_name || "";
  // What the case has net paid, from its payments (a refund or reversal takes away).
  const caseNet = payments.filter((p) => !caseId || p.case_id === caseId).reduce((n, p) => n + (p.type === "Payment" ? 1 : -1) * Number(p.amount || 0), 0);
  const done = async () => { await reload?.(); await onChanged?.(); };
  const canWaive = !!caseId && can("setup.payments.override") && caseRow?.docs?.quote && !caseRow.docs.paid && !["Lost", "Cancelled", "Completed"].includes(caseRow.stage);
  return (
    <div>
      <ErrorNote message={error} onClose={() => setError(null)} />
      {manage && <div className="bk-actions bk-mb">
        <Button variant="primary" disabled={!caseId && !accepted.length} onClick={() => setAdding(true)}>+ Record payment</Button>
        {w && <Button disabled={caseId ? !(caseNet > 0) : !accepted.some((q) => Number(q.balance?.net_paid) > 0)} onClick={() => setRefunding(true)}>Record refund</Button>}
        {canWaive && <Button onClick={() => setWaiving(true)}>Waive payment</Button>}
        {!caseId && !accepted.length && <small className="bk-muted">A payment needs an accepted quote.</small>}
        {caseId && !caseRow?.client_id && <small className="bk-muted">Recording a payment first creates the client from the lead details.</small>}</div>}
      {w && <DataTable rows={payments} empty="No payments yet." columns={[
        { key: "paid_on", label: "Date", render: (p) => fmtDate(p.paid_on) }, { key: "quote_id", label: "Quote", render: (p) => (p.quote_id ? number(p.quote_id) : "Advance") },
        { key: "type", label: "Type", render: (p) => <Badge tone={p.type === "Payment" ? (reversed.has(p.id) ? "bad" : "good") : "warn"}>{reversed.has(p.id) ? "Reversed" : p.type}</Badge> },
        { key: "amount", label: "AED", right: true, render: (p) => money(p.amount) }, { key: "method", label: "Method" }, { key: "reference", label: "Reference" }, { key: "receipt_number", label: "Receipt" },
        { key: "x", label: "", render: (p) => (
          <span className="bk-actions">
            {p.receipt_path && <Button onClick={() => openStored(p.receipt_path).catch((e) => setError(e.message))}>Open</Button>}
            {manage && p.receipt_id && !p.receipt_path && <Button busy={busy} onClick={() => act(() => fileReceipt(p, clientName, number(p.quote_id) || caseRow?.case_number || ""))}>Create file</Button>}
            {manage && p.type === "Payment" && !reversed.has(p.id) && <Button onClick={() => setReversing(p)}>Reverse</Button>}
          </span>
        ) },
      ]} />}
      {adding && <FormModal title="Record payment" submitLabel="Record and issue receipt" initial={{ quote_id: accepted[0]?.id, paid_on: today() }} onClose={() => setAdding(false)}
        note={caseId ? (accepted.length ? (can("setup.payments.override") ? "An amount above the balance needs a reason." : "An amount above the balance is refused.") : "No quote is accepted yet, so this is held as an advance and counts toward the quote once it is accepted.")
          : (can("setup.payments.override") ? "An amount above the balance needs a reason." : "An amount above the balance is refused.")}
        fields={[...(caseId ? [] : [{ name: "quote_id", label: "Quote", type: "select", required: true, options: accepted.map((q) => ({ value: q.id, label: `${q.document_number}: outstanding AED ${money(q.balance?.outstanding)}` })) }]),
          { name: "amount", label: "Amount (AED)", type: "number", required: true }, { name: "paid_on", label: "Date", type: "date", required: true },
          { name: "method", label: "Method", type: "select", options: ["Bank transfer", "Cash", "Cheque", "Card", "Other"] }, { name: "reference", label: "Reference" }, { name: "note", label: "Note", full: true },
          ...(can("setup.payments.override") && (!caseId || accepted.length) ? [{ name: "override_reason", label: "Reason, if above the balance", full: true }] : [])]}
        onSubmit={async (v) => {
          // A case with no client gets its client first. A client that already exists is not made twice: the error says so and the form stays open.
          if (caseId && !validAmount(v.amount)) throw new Error("Enter an amount above zero with at most two decimals");
          if (caseId && !caseRow?.client_id) {
            try { await caseLinkClientForPayment(caseId); } catch (e) { throw new Error(paymentLinkError(e.message, can("setup.leads.manage"))); }
          }
          const r = await addPayment(caseId ? { ...v, case_id: caseId } : v);
          try {
            await fileReceipt({ ...v, receipt_id: r.receipt_id, receipt_number: r.receipt_number }, clientName, number(v.quote_id) || accepted[0]?.document_number || caseRow?.case_number || "");
          } catch (e) { setError(`Payment saved as ${r.receipt_number}, but the file was not created: ${e.message}. Use Create file.`); }
          await done();
        }} />}
      {waiving && <FormModal title="Waive payment" submitLabel="Waive payment" note="Marks Paid as met without a payment. This is logged with your reason." fields={[{ name: "reason", label: "Reason", type: "textarea", required: true, full: true }]} onClose={() => setWaiving(false)}
        onSubmit={async (v) => { await casePaidOverride(caseId, v.reason); await done(); }} />}
      {refunding && <FormModal title="Record refund" submitLabel="Record refund" note={caseId ? `For money really returned to the client, up to AED ${money(caseNet)} paid on this case (an advance included). To undo a payment recorded by mistake, use Reverse.` : "For money really returned to the client. To undo a payment recorded by mistake, use Reverse."}
        initial={{ quote_id: accepted.find((q) => Number(q.balance?.net_paid) > 0)?.id }} onClose={() => setRefunding(false)}
        fields={[...(caseId ? [] : [{ name: "quote_id", label: "Quote", type: "select", required: true, options: accepted.filter((q) => Number(q.balance?.net_paid) > 0).map((q) => ({ value: q.id, label: `${q.document_number}: paid AED ${money(q.balance?.net_paid)}` })) }]),
          { name: "amount", label: "Amount (AED)", type: "number", required: true }, { name: "method", label: "Method", type: "select", options: ["Bank transfer", "Cash", "Cheque", "Card", "Other"] }, { name: "reference", label: "Reference" }, { name: "reason", label: "Reason", type: "textarea", required: true, full: true }]}
        onSubmit={async (v) => { await addRefund(caseId ? { ...v, case_id: caseId } : v); await done(); }} />}
      {reversing && <FormModal title={`Reverse ${reversing.receipt_number}`} submitLabel="Reverse" note="The payment and receipt stay on record. The receipt shows as Reversed." fields={[{ name: "reason", label: "Reason", type: "textarea", required: true, full: true }]} onClose={() => setReversing(null)}
        onSubmit={async (v) => { await reversePayment(reversing.id, v.reason); await done(); }} />}
    </div>
  );
}
