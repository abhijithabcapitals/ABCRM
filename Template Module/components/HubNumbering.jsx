// Settings for reference numbers: one format per department and document type.
import { useState } from "react";
import "@banking/components/banking.css";
import { Button, ErrorNote, FormModal, Panel, Spinner, useLoad } from "@banking/components/shared";
import { numberingStatus, saveNumbering } from "../services/hubApi";
import { DEPARTMENTS } from "../logic/serviceDocs";
import MasterTemplates from "./MasterTemplates";

const KINDS = [["quote", "Quotations"], ["letter", "Engagement Letters"]];
const RESTART = { never: "Never: runs on continuously", year: "Each year", month: "Each month" };

export default function HubNumbering() {
  const status = useLoad(numberingStatus, []);
  const [edit, setEdit] = useState(null);
  if (status.loading && !status.data) return <Spinner />;
  const manage = status.data?.can_manage;
  return (
    <div>
      <ErrorNote message={status.error} />
      <MasterTemplates manage={manage} />
      <p className="bk-note">Reference numbers are given automatically, in order. A mail carries the number of its document. In a format, {"{YYYY}"} is the year, {"{MM}"} the month and {"{SERIAL}"} the serial number. Business Banking shares the numbering of its own quotes and letters.</p>
      {DEPARTMENTS.map((dept) => (
        <Panel key={dept} title={dept}>
          {KINDS.map(([kind, label]) => {
            const d = status.data?.[dept]?.[kind];
            if (!d) return null;
            return (
              <div className="bk-row" key={kind}>
                <span><strong>{label}:</strong> next <code className="bk-code">{d.preview}</code> <small className="bk-muted">· format {d.format} · {RESTART[d.restart]}</small></span>
                {manage && <Button onClick={() => setEdit({ dept, kind, label, ...d })}>Edit</Button>}
              </div>
            );
          })}
        </Panel>
      ))}
      {edit && <FormModal title={`${edit.dept} · ${edit.label}`} initial={edit} onClose={() => setEdit(null)} note="A number already used is skipped."
        fields={[{ name: "format", label: "Format", required: true, full: true }, { name: "next_serial", label: "Next serial", type: "number", required: true }, { name: "digits", label: "Digits", type: "number", required: true }, { name: "restart", label: "Serial restarts", type: "select", required: true, options: Object.entries(RESTART).map(([value, label]) => ({ value, label })) }]}
        onSubmit={async (v) => { await saveNumbering(edit.dept, edit.kind, v); await status.reload(); }} />}
    </div>
  );
}
