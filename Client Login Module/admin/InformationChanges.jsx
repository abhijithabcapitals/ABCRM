// Clients > Client Inputs > Information Changes: details a client asked to change on their own record.
// Nothing reaches the CRM until a member of staff validates it. Values are shown as plain text.
import { useState } from "react";
import "@banking/components/banking.css";
import { Badge, Button, DataTable, ErrorNote, FormModal, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { rpc } from "@banking/services/bankingApi";
import { FIELDS } from "../logic/fields.js";

const VIEWS = [["pending", "Waiting"], ["in_review", "In review"], ["validated", "Validated"], ["rejected", "Rejected"]];
const LABEL = { pending: "Waiting", in_review: "In review", validated: "Validated", rejected: "Rejected" };
const TONE = { pending: "warn", in_review: "warn", validated: "good", rejected: "bad" };

const fieldOf = (key) => FIELDS.find((f) => f.key === key);
const fieldLabel = (key) => fieldOf(key)?.label || key;
const showValue = (key, v) => (v == null || v === "" ? "Not on file" : fieldOf(key)?.type === "date" ? fmtDate(v) : String(v));

export default function InformationChanges() {
  const list = useLoad(() => rpc("client_changes_list"), []);
  const people = useLoad(() => rpc("client_changes_assignees"), []);
  const [view, setView] = useState("pending");
  const [modal, setModal] = useState(null); // { kind: "reject" | "assign" | "confirm", row }
  const [error, setError] = useState(null);
  const rows = list.data || [];
  const act = async (fn) => {
    setError(null);
    try { await fn(); } catch (e) { setError(e.message); }
    list.reload();
  };
  // Validate: a stale row (the official value moved since the client asked) needs the confirmation first.
  const validate = (row) => {
    if (row.stale) return setModal({ kind: "confirm", row });
    return act(async () => {
      try {
        await rpc("client_changes_decide", { p_id: row.id, p_status: "validated", p_note: null, p_force: false });
      } catch (e) {
        if (!/changed since/i.test(e.message || "")) throw e;
        setModal({ kind: "confirm", row }); // someone changed the record after the list loaded: show both values
      }
    });
  };
  const row = modal && (rows.find((r) => r.id === modal.row.id) || modal.row);
  return (
    <div>
      <p className="bk-note">Details clients asked to change on their own record. Take one, check it against the official value, then validate or reject it. A validated value is written into the CRM.</p>
      <div className="bk-tabs" role="tablist" aria-label="Status">
        {VIEWS.map(([k, label]) => <button type="button" role="tab" aria-selected={view === k} key={k} className={view === k ? "active" : ""} onClick={() => setView(k)}>{label} <span className="bk-tab-count">{rows.filter((d) => d.status === k).length}</span></button>)}
      </div>
      <ErrorNote message={error || list.error} />
      {list.loading && !list.data ? <Spinner /> : (
        <DataTable search="Search client, field…" rows={rows.filter((d) => d.status === view)} empty={`Nothing ${LABEL[view].toLowerCase()}.`} columns={[
          { key: "client", label: "Client" },
          { key: "field_key", label: "Field", render: (d) => fieldLabel(d.field_key) },
          { key: "official_value", label: "Current official value", render: (d) => showValue(d.field_key, d.status === "pending" || d.status === "in_review" ? d.official_value : d.old_value) },
          { key: "new_value", label: "Proposed value", render: (d) => <>{showValue(d.field_key, d.new_value)}{d.stale && <> <Badge tone="bad">Record changed</Badge></>}</> },
          { key: "status", label: "Status", render: (d) => <Badge tone={TONE[d.status]}>{LABEL[d.status]}</Badge> },
          { key: "assignee", label: "Assigned to" },
          { key: "created_at", label: "Received", render: (d) => fmtDate(d.created_at) },
          { key: "review_note", label: "Review note" },
          { key: "actions", label: "", render: (d) => (
            <span className="bk-actions">
              {d.status === "pending" && <Button variant="primary" onClick={() => act(() => rpc("client_changes_take", { p_id: d.id }))}>Take</Button>}
              {(d.status === "pending" || (d.status === "in_review" && d.can_decide)) && <Button onClick={() => setModal({ kind: "assign", row: d })}>Assign to</Button>}
              {d.status === "in_review" && d.can_decide && <>
                <Button variant="primary" onClick={() => validate(d)}>Validate</Button>
                <Button onClick={() => setModal({ kind: "reject", row: d })}>Reject</Button>
                <Button onClick={() => act(() => rpc("client_changes_release", { p_id: d.id }))}>Release</Button>
              </>}
            </span>
          ) },
        ]} />
      )}
      {modal?.kind === "reject" && (
        <FormModal title={`Reject ${fieldLabel(row.field_key)} for ${row.client}`} submitLabel="Reject" onClose={() => setModal(null)}
          onSubmit={async (v) => { await rpc("client_changes_decide", { p_id: row.id, p_status: "rejected", p_note: v.note, p_force: false }); list.reload(); }}
          fields={[{ name: "note", label: "Reason. The client sees this.", type: "textarea", required: true, full: true }]} />
      )}
      {modal?.kind === "assign" && (
        <FormModal title={`Assign ${fieldLabel(row.field_key)} for ${row.client}`} submitLabel="Assign" onClose={() => setModal(null)}
          onSubmit={async (v) => { await rpc("client_changes_assign", { p_id: row.id, p_to: v.to }); list.reload(); }}
          fields={[{ name: "to", label: "Assign to", type: "select", required: true, options: [{ value: "", label: "Choose a person" }, ...(people.data || []).map((p) => ({ value: p.id, label: p.full_name }))] }]} />
      )}
      {modal?.kind === "confirm" && (
        <FormModal title={`Overwrite ${fieldLabel(row.field_key)} for ${row.client}?`} submitLabel="Overwrite with proposed value" onClose={() => setModal(null)}
          note={`This detail has changed since the client made the request. Official value now: ${showValue(row.field_key, row.official_value)}. Proposed value: ${showValue(row.field_key, row.new_value)}. Validating replaces the official value.`}
          onSubmit={async () => { await rpc("client_changes_decide", { p_id: row.id, p_status: "validated", p_note: null, p_force: true }); list.reload(); }}
          fields={[]} />
      )}
    </div>
  );
}
