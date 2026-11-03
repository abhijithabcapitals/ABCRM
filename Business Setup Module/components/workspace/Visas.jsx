// Visas held under this client. Staff correct dates here: old records may be stale, and the Dashboard's expiries read this list.
import { useState } from "react";
import { Button, DataTable, FormModal, fmtDate } from "@banking/components/shared";
import { useSetup } from "../SetupContext";
import { saveVisa } from "../../services/businessSetupApi";

const FIELDS = [
  { name: "person_name", label: "Name", required: true }, { name: "occupation", label: "Occupation" }, { name: "issue_date", label: "Issue date", type: "date" },
  { name: "expiry_date", label: "Expiry date", type: "date" }, { name: "status", label: "Status", help: "A status with Cancelled or Resigned drops off the expiry list." },
];

export default function Visas({ w, clientId, reload }) {
  const { can } = useSetup();
  const manage = can("setup.services.manage");
  const [edit, setEdit] = useState(null);
  return (
    <div>
      {manage && <div className="bk-actions bk-mb"><Button variant="primary" onClick={() => setEdit({ status: "Active" })}>+ Visa</Button></div>}
      <DataTable rows={w.visas} search="Search name…" empty="No visas recorded." onRow={manage ? (v) => setEdit(v) : undefined} columns={[
        { key: "person_name", label: "Name" }, { key: "occupation", label: "Occupation" }, { key: "issue_date", label: "Issued", render: (v) => fmtDate(v.issue_date) },
        { key: "expiry_date", label: "Expires", render: (v) => fmtDate(v.expiry_date) }, { key: "status", label: "Status" }, { key: "source", label: "From" },
      ]} />
      {edit && <FormModal title={edit.id ? "Edit visa" : "Add visa"} fields={FIELDS} initial={edit} onClose={() => setEdit(null)} onSubmit={async (v) => { await saveVisa({ ...v, id: edit.id, client_id: clientId }); await reload(); }} />}
    </div>
  );
}
