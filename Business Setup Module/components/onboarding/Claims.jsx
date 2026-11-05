// The client's "I have paid" claims on a case. A claim changes no balance until staff confirm it: Confirm opens the payment form with the claim's values
// (the payment then confirms the claim in the same step), Refuse needs a note the client can read. The proof of payment is opened through the staff document link.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { staffCall } from "@client-login/admin/ClientPortalAdmin";
import { claimList, claimRefuse } from "../../services/businessSetupApi";
import { CLAIM_TONE } from "../../logic/claims";
import { money } from "@app/money";

export default function Claims({ caseId, manage, onConfirm, onChanged, refreshKey = 0 }) {
  const list = useLoad(() => claimList(caseId), [caseId, refreshKey]);
  const [refusing, setRefusing] = useState(null);
  const [error, setError] = useState(null);
  const rows = list.data || [];
  const openProof = (c) => staffCall("staff_url", { id: c.proof_document_id }).then((r) => window.open(r.url, "_blank", "noopener")).catch((e) => setError(e.message));
  if (list.loading && !list.data) return <Spinner />;
  return (
    <div>
      <ErrorNote message={list.error || error} onClose={error ? () => setError(null) : undefined} />
      <DataTable rows={rows} empty="No payment claims from the client." columns={[
        { key: "created_at", label: "Claimed", render: (c) => fmtDate(c.created_at) }, { key: "invoice_number", label: "Invoice" },
        { key: "amount", label: "AED", right: true, render: (c) => money(c.amount) }, { key: "paid_on", label: "Paid on", render: (c) => fmtDate(c.paid_on) }, { key: "reference", label: "Reference" },
        { key: "status", label: "Status", render: (c) => <Badge tone={CLAIM_TONE[c.status]}>{c.status}</Badge> }, { key: "note", label: "Note" },
        { key: "x", label: "", render: (c) => (
          <span className="bk-actions">
            {c.proof_document_id && manage && <Button onClick={() => openProof(c)}>Open proof</Button>}
            {c.status === "Pending" && manage && <><Button variant="primary" onClick={() => onConfirm(c)}>Confirm</Button><Button onClick={() => setRefusing(c)}>Refuse</Button></>}
          </span>
        ) },
      ]} />
      {refusing && <FormModal title="Refuse the payment claim" submitLabel="Refuse" note="The client sees this note in the portal." fields={[{ name: "note", label: "Note for the client", type: "textarea", required: true, full: true }]}
        onClose={() => setRefusing(null)} onSubmit={async (v) => { await claimRefuse(refusing.id, v.note); await list.reload(); await onChanged?.(); }} />}
    </div>
  );
}
