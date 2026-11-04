// The client's details as held by AB Capital. A client asks for a change; staff check it before it is saved.
import { useState } from "react";
import { Badge, Button, FormModal, Panel } from "@banking/components/shared";
import { FIELDS, fieldState } from "../logic/fields";
import { showDate, toIso } from "./format";

const GROUPS = ["Company", "Licence", "Contact", "Tax"];

function Row({ field, state, readOnly, onEdit }) {
  const show = (v) => (field.type === "date" ? showDate(v) : v);
  const empty = state.value === null || state.value === "";
  return (
    <div className="pt-field">
      <span className="pt-field-label">{field.label}</span>
      {/* Plain text on purpose: the website is typed by the client and is never made a link. */}
      <span className="pt-field-value">{empty ? <span className="pt-muted">Not recorded yet</span> : show(state.value)}</span>
      {!readOnly && !state.locked && <Button onClick={onEdit} aria-label={`Change ${field.label}`}>Change</Button>}
      {(state.pending !== null || state.rejectedNote) && (
        <span className="pt-field-extra">
          {state.pending !== null && <><Badge tone="warn">Pending review</Badge><span>Requested: {show(state.pending)}</span></>}
          {state.locked && <span className="pt-muted">We are checking this now, so it cannot be changed yet.</span>}
          {state.rejectedNote && <span className="pt-note">Not accepted: {state.rejectedNote}</span>}
        </span>
      )}
    </div>
  );
}

export default function InformationTab({ me, api, readOnly, reload }) {
  const [editing, setEditing] = useState(null);
  const record = me.record || {};
  const fields = FIELDS.filter((f) => !f.masterOnly || me.has_master);
  const edit = editing && { name: "value", label: editing.label, type: editing.type === "date" ? "date" : "text", required: true, full: true };
  return (
    <>
      <p className="pt-muted bk-mb">If something is wrong, ask for a change. AB Capital Services FZE checks each change before it is saved.</p>
      {GROUPS.map((g) => (
        <Panel key={g} title={g}>
          {fields.filter((f) => f.group === g).map((f) => (
            <Row key={f.key} field={f} readOnly={readOnly} state={fieldState(f, record, me.changes)} onEdit={() => setEditing(f)} />
          ))}
        </Panel>
      ))}
      {editing && !readOnly && (
        <FormModal title={`Change ${editing.label}`} submitLabel="Send for review" onClose={() => setEditing(null)}
          fields={[edit]} initial={{ value: editing.type === "date" ? toIso(record[editing.key]) : record[editing.key] ?? "" }}
          note="AB Capital Services FZE will check this before it is saved to your record."
          onSubmit={async (v) => {
            if (!v.value) throw new Error("Enter the new value.");
            await api.submitChange(editing.key, v.value);
            reload();
          }} />
      )}
    </>
  );
}
