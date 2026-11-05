// The Fields and Documents items of a case: the client's form, whatever state it is in. The form can always be opened (Returned and Validated ones too);
// Read documents fills the form's empty answers from the client's documents while it is In review.
import { lazy, Suspense, useState } from "react";
import { Badge, Button, DataTable, ErrorNote, KeyVals, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { useSetup } from "../SetupContext";
import { formDetail } from "../../services/businessSetupApi";
import { FIELDS } from "../../logic/staffForm";
import { visibleDocs } from "../../logic/claims";
import { itemState, itemTone } from "../../logic/checklist";

// The reader and its models load only when someone clicks Read documents, so this tab stays light.
const ReadDocuments = lazy(() => import("./ReadDocuments"));
export const FORM_TONE = { Submitted: "warn", "In review": "warn", Returned: "bad", Validated: "good", Draft: undefined };
const DOC = { pending: "Waiting", in_review: "In review", validated: "Validated", rejected: "Rejected" };

export default function FieldsPanel({ c, onOpenForm, onChanged }) {
  const { can } = useSetup();
  const f = useLoad(() => (c.form_id ? formDetail(c.form_id) : Promise.resolve(null)), [c.form_id, c.form_status]);
  const [reading, setReading] = useState(false);
  const d = f.data;
  const a = d?.answers || {};
  const docs = visibleDocs(d?.documents).filter((x) => x.upload_complete);
  const canRead = !!d && d.status === "In review" && can("setup.kyc.manage");
  return (
    <Panel title="Fields and documents" sub={c.form_id ? `Form: ${c.form_status}` : undefined}
      actions={<span className="bk-actions">
        {c.form_id && <Button onClick={() => onOpenForm(c.form_id)}>Open form</Button>}
        {canRead && <Button onClick={() => setReading(true)}>Read documents</Button>}
      </span>}>
      <div className="bk-actions bk-wrap bk-mb">{["fields", "documents"].map((k) => <Badge key={k} tone={itemTone(itemState(c, k))}>{k === "fields" ? "Fields" : "Documents"}: {itemState(c, k)}</Badge>)}</div>
      <ErrorNote message={f.error} />
      {!c.form_id ? <p className="bk-note">This case has no client form. Fields and Documents follow the client's KYC: they are met once it is Done.</p>
        : f.loading && !d ? <Spinner /> : d && <>
          {d.status === "Returned" && d.return_note && <div className="bk-alert bk-alert-warn">Returned to the client: {d.return_note}</div>}
          {d.missing?.length > 0 && <div className="bk-alert bk-alert-warn">Still missing: {d.missing.join(", ")}.</div>}
          <KeyVals items={[...FIELDS.map(([k, label]) => [label, k === "licence_expiry" ? fmtDate(a[k]) : a[k]]), ["Services", (a.services || []).join(", ")], ["Partners", (a.partners || []).map((p) => `${p.name} (${p.nationality})`).join(", ")]]} />
          <div className="bk-mt"><DataTable rows={docs} empty="No documents uploaded." columns={[
            { key: "doc_type", label: "Type" }, { key: "file_name", label: "File" },
            { key: "status", label: "Status", render: (x) => <Badge tone={x.status === "validated" ? "good" : x.status === "rejected" ? "bad" : "warn"}>{DOC[x.status]}</Badge> }, { key: "review_note", label: "Note" },
          ]} /></div>
        </>}
      {reading && d && <Suspense fallback={<Spinner />}><ReadDocuments form={d} canSave={canRead} onClose={() => setReading(false)} onSaved={async () => { await f.reload(); await onChanged?.(); }} /></Suspense>}
    </Panel>
  );
}
