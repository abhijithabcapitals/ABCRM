// The invoices of a case. They are made outside the CRM and recorded here by number, date and amount, with the file if there is one.
// A case moves on from Documentation once an invoice is recorded, or the invoice is waived with a reason. The client sees recorded invoices in the portal.
import { useState } from "react";
import { Button, DataTable, ErrorNote, FilePick, FormModal, fmtDate, today, useLoad } from "@banking/components/shared";
import { useSetup } from "../SetupContext";
import { caseInvoiceOverride, caseInvoices, invoiceRecord, openDocument, uploadFile } from "../../services/businessSetupApi";
import { money } from "@app/money";


export default function Invoices({ caseId, caseRow, onChanged }) {
  const { can } = useSetup();
  const list = useLoad(() => caseInvoices(caseId), [caseId]);
  const [adding, setAdding] = useState(false);
  const [waiving, setWaiving] = useState(false);
  const [scan, setScan] = useState(null);
  const [error, setError] = useState(null);
  const closed = ["Lost"].includes(caseRow?.stage);
  const hasQuote = !!caseRow?.docs?.quote;
  const done = async () => { await list.reload(); await onChanged?.(); };
  const canWaive = can("setup.payments.override") && hasQuote && !caseRow?.docs?.invoice && !["Lost", "Cancelled", "Completed"].includes(caseRow?.stage);
  return (
    <div>
      <ErrorNote message={list.error || error} onClose={error ? () => setError(null) : undefined} />
      {can("setup.payments.manage") && <div className="bk-actions bk-mb">
        <Button variant="primary" disabled={!caseRow?.client_id || closed} onClick={() => { setScan(null); setAdding(true); }}>+ Record invoice</Button>
        {canWaive && <Button onClick={() => setWaiving(true)}>Waive invoice</Button>}
        {!caseRow?.client_id && <small className="bk-muted">Link a client to this case before recording an invoice.</small>}
        {caseRow?.client_id && !closed && !caseRow?.docs?.quote_accepted && <small className="bk-muted">An invoice is recorded against the accepted quote.</small>}
      </div>}
      <DataTable rows={list.data || []} empty="No invoice recorded yet." columns={[
        { key: "invoice_number", label: "Invoice" }, { key: "issued_on", label: "Date", render: (i) => fmtDate(i.issued_on) },
        { key: "amount", label: "AED", right: true, render: (i) => money(i.amount) },
        { key: "x", label: "", render: (i) => (i.file_path ? <Button onClick={() => openDocument(i.file_path).catch((e) => setError(e.message))}>Open file</Button> : "No file") },
      ]} />
      {adding && <FormModal title="Record invoice" submitLabel="Record invoice" initial={{ invoice_date: today() }} onClose={() => setAdding(false)}
        note={<><span>Record an invoice made outside the CRM. It is shown to the client in the portal.</span> <FilePick label={scan ? scan.name : "Attach invoice file"} accept=".pdf,image/*" onFile={setScan} /></>}
        fields={[{ name: "invoice_number", label: "Invoice number", required: true }, { name: "invoice_date", label: "Invoice date", type: "date", required: true }, { name: "amount", label: "Amount (AED)", type: "number", required: true }]}
        onSubmit={async (v) => {
          const file_path = scan ? await uploadFile(caseRow.client_id, scan, "invoice") : null;
          await invoiceRecord({ ...v, case_id: caseId, file_path });
          await done();
        }} />}
      {waiving && <FormModal title="Waive invoice" submitLabel="Waive invoice" note="Marks Invoice as met without recording one, for an invoice made outside the CRM. This is logged with your reason."
        fields={[{ name: "reason", label: "Reason", type: "textarea", required: true, full: true }]} onClose={() => setWaiving(false)}
        onSubmit={async (v) => { await caseInvoiceOverride(caseId, v.reason); await done(); }} />}
    </div>
  );
}
