// The Fields and Documents items of a case: the client's form, whatever state it is in. The form can always be opened (Returned and Validated ones too);
// Read documents fills the form's empty answers from the client's documents while it is In review. A case with no form takes a drag and drop too:
// the first file starts the case's form (028), with no login. Each dropped file is also copied to the client's OneDrive folder by the Client Module.
import { lazy, Suspense, useRef, useState } from "react";
import { Badge, Button, DataTable, ErrorNote, KeyVals, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { useSetup } from "../SetupContext";
import { addStaffFormDocument, caseFormStart, formDetail, formStaffSave } from "../../services/businessSetupApi";
import { saveToOneDrive } from "../../services/oneDrive";
import { oneDriveNote } from "../../logic/oneDrive";
import BulkUpload from "../BulkUpload";
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
  const [fillError, setFillError] = useState(null);
  const d = f.data;
  const a = d?.answers || {};
  const docs = visibleDocs(d?.documents).filter((x) => x.upload_complete);
  const canRead = !!d && d.status === "In review" && can("setup.kyc.manage");
  // The form this panel's drop writes to: the case's, or the one the first drop started. One start at a time, however many files are dropped.
  const [started, setStarted] = useState(null);
  const starting = useRef(null);
  const formId = c.form_id || started;
  const canDrop = can("setup.kyc.manage") && !!c.client_id && !["Completed", "Cancelled", "Lost"].includes(c.stage) && (!c.form_id || canRead || started === c.form_id);
  const ensureForm = () => {
    if (formId) return Promise.resolve(formId);
    starting.current ||= caseFormStart(c.id).then(async (id) => { setStarted(id); await onChanged?.(); return id; }, (e) => { starting.current = null; throw e; });
    return starting.current;
  };
  const [drive, setDrive] = useState({ saved: 0, failed: 0, reason: null });
  const upload = async (file, type) => {
    const id = await ensureForm();
    await addStaffFormDocument(id, c.client_id, type, file);
    // The CRM copy is the record; OneDrive is a copy, so a failure there is reported and never undoes the upload.
    try { await saveToOneDrive(file, c.client_name, c.client_id, type); setDrive((s) => ({ ...s, saved: s.saved + 1 })); }
    catch (e) { setDrive((s) => ({ ...s, failed: s.failed + 1, reason: s.reason || e.message })); }
  };
  const driveNote = oneDriveNote(drive);
  return (
    <Panel title="Fields and documents" sub={c.form_id ? `Form: ${c.form_status}` : undefined}
      actions={<span className="bk-actions">
        {c.form_id && <Button onClick={() => onOpenForm(c.form_id)}>Open form</Button>}
        {canRead && <Button onClick={() => setReading(true)}>Read documents</Button>}
      </span>}>
      <div className="bk-actions bk-wrap bk-mb">{["fields", "documents"].map((k) => <Badge key={k} tone={itemTone(itemState(c, k))}>{k === "fields" ? "Fields" : "Documents"}: {itemState(c, k)}</Badge>)}</div>
      <ErrorNote message={f.error || fillError} onClose={fillError ? () => setFillError(null) : undefined} />
      {canDrop && <BulkUpload answers={a} labels={Object.fromEntries(FIELDS)} title="Drag and drop all the client's documents here"
        hint="or click to choose. PDF, JPG or PNG, up to 10 MB each. They are sorted, read in this browser, fill the empty fields below, and are copied to the client's OneDrive folder."
        upload={upload}
        fill={(next) => { setFillError(null); ensureForm().then((id) => formStaffSave(id, next)).then(f.reload, (e) => setFillError(e.message)); }}
        onUploaded={f.reload} />}
      {driveNote && <div className={`bk-alert bk-alert-${driveNote.tone}`}>{driveNote.text}</div>}
      {!c.form_id ? <p className="bk-note">{canDrop ? "This case has no client form yet. Drop the client's documents above: the first file starts the form for this case, with no login. Until then, Fields and Documents follow the client's KYC."
          : "This case has no client form. Fields and Documents follow the client's KYC: they are met once nothing is missing. Complete it on the client's page, using Open client."}</p>
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
