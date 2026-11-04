import { useState } from "react";
import { Button, DataTable, ErrorNote, FormModal, PageHead, Panel, fmtDate, useAction, useLoad } from "@banking/components/shared";
import { listSettings, listStaff, removeStaff, saveSetting, saveStaff } from "../services/businessSetupApi";
import { useSetup } from "./SetupContext";
import Import from "./Import";

const ROLES = [["ADMIN", "Admin"], ["MANAGER", "Manager"], ["SALES_EXECUTIVE", "Sales executive"], ["DOCUMENT_EXECUTIVE", "Document executive"], ["FINANCE", "Finance"], ["BANKING_EXECUTIVE", "Banking executive"], ["READ_ONLY", "Read only"]];

export default function Settings() {
  const { can } = useSetup();
  const manage = can("setup.settings.manage");
  return (
    <div>
      <PageHead title="Settings" />
      {manage ? <Staff /> : <p className="bk-note">Only an administrator can change staff and settings. You can see the current values.</p>}
      <Values manage={manage} />
      {can("setup.import.manage") && <Import />}
    </div>
  );
}

// People who hold a Business Setup role. CRM admins always have full access and are not listed here.
function Staff() {
  const { people, personName } = useSetup();
  const staff = useLoad(() => listStaff(), []);
  const { error, busy, act } = useAction(() => staff.reload());
  const [edit, setEdit] = useState(null);
  const given = new Set((staff.data || []).map((s) => s.user_id));
  const rows = (staff.data || []).map((s) => ({ ...s, name: personName(s.user_id) }));
  const free = people.filter((p) => !given.has(p.id)).map((p) => ({ value: p.id, label: p.full_name || p.id }));
  return (
    <Panel title="Staff" sub="Each role starts with a set of rights, such as taking payments or seeing partner IDs." actions={<Button variant="primary" onClick={() => setEdit({ role: "READ_ONLY" })}>Add person</Button>}>
      <ErrorNote message={staff.error || error} />
      <DataTable rows={rows} search="Search staff…" empty="No one has been given a Business Setup role yet."
        columns={[{ key: "name", label: "Person" },
          { key: "role", label: "Role", render: (r) => <select aria-label={`Role of ${r.name}`} value={r.role} disabled={busy} onChange={(e) => act(() => saveStaff(r.user_id, e.target.value))}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select> },
          { key: "created_at", label: "Added", render: (r) => fmtDate(r.created_at) },
          { key: "x", label: "", render: (r) => <Button disabled={busy} onClick={() => act(() => removeStaff(r.user_id))}>Remove</Button> }]} />
      {edit && <FormModal title="Add person" initial={edit} onClose={() => setEdit(null)}
        fields={[{ name: "user_id", label: "Person", type: "select", options: free, required: true }, { name: "role", label: "Role", type: "select", options: ROLES.map(([value, label]) => ({ value, label })), required: true }]}
        onSubmit={async (v) => { await saveStaff(v.user_id, v.role); await staff.reload(); }} />}
    </Panel>
  );
}

// Simple key values. Later tasks give their own settings (reminders, mailbox, terms) a proper form.
function Values({ manage }) {
  const list = useLoad(() => listSettings(), []);
  const [edit, setEdit] = useState(null);
  return (
    <Panel title="Settings values" sub="Each value is JSON. Every change is kept in the audit trail." actions={manage && <Button variant="primary" onClick={() => setEdit({ key: "", text: "" })}>Add setting</Button>}>
      <ErrorNote message={list.error} />
      <DataTable rows={list.data || []} onRow={manage ? (r) => setEdit({ key: r.key, text: JSON.stringify(r.value, null, 2), existing: true }) : undefined} empty="No settings have been saved yet."
        columns={[{ key: "key", label: "Setting" }, { key: "value", label: "Value", render: (r) => <code className="bk-code">{JSON.stringify(r.value)}</code> }, { key: "updated_at", label: "Updated", render: (r) => fmtDate(r.updated_at) }]} />
      {edit && <FormModal wide title={edit.existing ? edit.key : "Add setting"} initial={edit} onClose={() => setEdit(null)}
        fields={[...(edit.existing ? [] : [{ name: "key", label: "Setting name", required: true }]), { name: "text", label: "Value (JSON)", type: "textarea", rows: 10, full: true, required: true }]}
        onSubmit={async (v) => {
          let parsed;
          try { parsed = JSON.parse(v.text); } catch { throw new Error("That is not valid JSON"); }
          await saveSetting(edit.existing ? edit.key : v.key, parsed);
          await list.reload();
        }} />}
    </Panel>
  );
}
