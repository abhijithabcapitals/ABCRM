// shared.jsx plus the communication history, used on leads and cases.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, Panel, fmtDateTime, fmtDate, useBanking, useLoad, useAction } from "./shared";
import { insertRow, openFile, run, table, updateRow, uploadFile } from "../services/bankingApi";
import { CHANNELS } from "../logic/constants";

export * from "./shared";

export function CommsList({ leadId, caseId, clientId }) {
  const { can, personOptions, personName } = useBanking();
  const comms = useLoad(() => {
    let q = table("banking_communications").select("*").order("occurred_at", { ascending: false }).limit(200);
    q = caseId ? q.eq("case_id", caseId) : q.eq("lead_id", leadId);
    return run(q);
  }, [leadId, caseId]);
  const [adding, setAdding] = useState(false);
  const { error, act } = useAction(comms.reload);
  const fields = [
    { name: "occurred_at", label: "Date and time", type: "datetime", required: true },
    { name: "channel", label: "Channel", type: "select", options: CHANNELS, required: true },
    { name: "contact_person", label: "Contact person" },
    { name: "assigned_to", label: "Assigned employee", type: "select", options: personOptions },
    { name: "summary", label: "Summary", type: "textarea", required: true, full: true },
    { name: "outcome", label: "Outcome" },
    { name: "next_action", label: "Next action" },
    { name: "follow_up_date", label: "Follow-up date", type: "date" },
  ];
  return (
    <Panel title="Follow-up and communication history" actions={can("comms.manage") && <Button variant="primary" onClick={() => setAdding(true)}>Log interaction</Button>}>
      <ErrorNote message={comms.error || error} />
      <DataTable rows={comms.data || []} empty="No interactions logged." columns={[
        { key: "occurred_at", label: "When", render: (r) => fmtDateTime(r.occurred_at) },
        { key: "channel", label: "Channel" },
        { key: "contact_person", label: "Contact" },
        { key: "summary", label: "Summary" },
        { key: "outcome", label: "Outcome" },
        { key: "next_action", label: "Next action" },
        { key: "assigned_to", label: "Employee", render: (r) => personName(r.assigned_to) },
        { key: "follow_up_date", label: "Follow-up", render: (r) => (r.follow_up_date ? <>{fmtDate(r.follow_up_date)} {r.follow_up_done ? <Badge tone="good">Done</Badge> : can("comms.manage") && <button type="button" className="bk-link" onClick={() => act(() => updateRow("banking_communications", r.id, { follow_up_done: true }))}>Mark done</button>}</> : "–") },
        { key: "attachment_path", label: "File", render: (r) => (r.attachment_path ? <button type="button" className="bk-link" onClick={() => act(() => openFile(r.attachment_path))}>Open</button> : "–") },
      ]} />
      {adding && (
        <FormModal wide title="Log interaction" fields={fields} initial={{ occurred_at: new Date().toISOString().slice(0, 16) }} onClose={() => setAdding(false)}
          onSubmit={async (v) => { await insertRow("banking_communications", { ...v, lead_id: leadId || null, case_id: caseId || null, client_id: clientId || null }); await comms.reload(); }} />
      )}
    </Panel>
  );
}

// Upload helper for an attachment field outside the document checklist.
export const uploadTo = (caseId, area, file) => uploadFile(caseId, area, file);
