// Actions every case page shares: answer a pending reassignment request, and mark a case lost.
import { useState } from "react";
import { Badge, Button, FormModal, useAction } from "@banking/components/shared";
import { useSetup } from "./SetupContext";
import { caseLost, reassignRespond } from "../services/businessSetupApi";

// Shows the pending request on a case, with Approve and Refuse for a holder of setup.cases.approve.
export function ReassignActions({ c, onChanged, onError }) {
  const { can, personName } = useSetup();
  const { busy, act } = useAction(onChanged);
  const [refusing, setRefusing] = useState(false);
  if (!c.reassign) return null;
  return (
    <span className="bk-actions bk-wrap" onClick={(e) => e.stopPropagation()}>
      <Badge tone="warn">Reassign to {c.reassign.to_name || personName(c.reassign.to_user)}</Badge>
      {can("setup.cases.approve") && <>
        <Button busy={busy} onClick={() => act(() => reassignRespond(c.reassign.id, true, null))}>Approve</Button>
        <Button onClick={() => setRefusing(true)}>Refuse</Button>
      </>}
      {refusing && <FormModal title={`Refuse reassignment of ${c.case_number}`} submitLabel="Refuse" onClose={() => setRefusing(false)}
        fields={[{ name: "note", label: "Note", type: "textarea", full: true }]} onSubmit={async (v) => { await reassignRespond(c.reassign.id, false, v.note || null); await onChanged(); }} />}
    </span>
  );
}

// The Mark lost dialog. The database says why a case cannot be closed.
export function LostDialog({ c, onClose, onDone }) {
  return (
    <FormModal title={`Mark ${c.case_number} lost`} submitLabel="Mark lost" note="A case with a payment or an accepted quote, or one already in service, cannot be marked lost." onClose={onClose}
      fields={[{ name: "reason", label: "Reason", type: "textarea", required: true, full: true }]} onSubmit={async (v) => { await caseLost(c.id, v.reason); await onDone(); }} />
  );
}
