import { useMemo, useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FilePick, FormGrid, Modal, Panel, Spinner, cleanValues, fmtDate, useLoad } from "@banking/components/shared";
import { insertRow, openDocument, readDocument, run, table, uploadDocument } from "../services/hrApi";
import { BAND_TONE, bandLabel, daysUntil, dubaiToday, expiryBand } from "../logic/expiry";
import { fieldsFromRead } from "../logic/documentFields";

export const DOC_TYPES = ["Passport", "Residence visa", "Emirates ID", "Labour card", "Medical insurance", "Driving licence", "Other"];

// Lives inside All Employees: with forEmployee, one person's section on their profile; without it, HR's list of everyone, soonest expiry first.
// HR adds for anyone. An employee or a manager sees and adds only their own (the database enforces it; the filter keeps the screen to the same rows).
export default function Documents({ role, employeeId, forEmployee }) {
  const isHr = role === "hr";
  const docs = useLoad(async () => {
    const query = table("hr_documents").select("*, hr_employees(employee_code, full_name, status)");
    return run((forEmployee ? query.eq("employee_id", forEmployee) : isHr ? query : query.eq("employee_id", employeeId)).order("expiry_date", { ascending: true, nullsFirst: false }));
  }, [isHr, employeeId, forEmployee]);
  const people = useLoad(async () => (isHr && !forEmployee ? run(table("hr_employees").select("id, employee_code, full_name, status").order("employee_code")) : []), [isHr, forEmployee]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(null);
  const today = dubaiToday();
  // A leaver's document gets no band, the same as the dashboard count and the alert list, and says why.
  const rows = useMemo(() => (docs.data || []).map((d) => {
    const left = d.hr_employees?.status === "Left";
    return { ...d, left, band: left ? null : expiryBand(d.expiry_date, today), days: daysUntil(d.expiry_date, today) };
  }), [docs.data, today]);

  const open = async (path) => { setError(null); try { await openDocument(path); } catch (e) { setError(e.message); } };
  const columns = [
    ...(isHr && !forEmployee ? [{ key: "employee", label: "Employee", render: (d) => (d.hr_employees ? `${d.hr_employees.employee_code} · ${d.hr_employees.full_name}` : "–") }] : []),
    { key: "doc_type", label: "Type" },
    { key: "doc_number", label: "Number" },
    { key: "issue_date", label: "Issued", render: (d) => fmtDate(d.issue_date) },
    { key: "expiry_date", label: "Expires", render: (d) => fmtDate(d.expiry_date) },
    { key: "band", label: "Expiry", render: (d) => (d.band ? <><Badge tone={BAND_TONE[d.band]}>{bandLabel(d.band)}</Badge> <span className="hr-days">{d.days < 0 ? `${-d.days} days ago` : `${d.days} days`}</span></> : d.left ? <span className="hr-days">Left: not tracked</span> : "–") },
    { key: "storage_path", label: "File", render: (d) => (d.storage_path ? <Button onClick={(e) => { e.stopPropagation(); open(d.storage_path); }}>View</Button> : "–") },
  ];

  return (
    <Panel title="Documents" sub={forEmployee ? "Soonest expiry first." : "Visas, passports, Emirates IDs, labour cards and other papers, soonest expiry first."}
      actions={(isHr || employeeId) && <Button variant="primary" onClick={() => setAdding(true)}>+ Add document</Button>}>
      <ErrorNote message={docs.error || people.error || error} onClose={() => setError(null)} />
      {docs.loading && !docs.data ? <Spinner /> : <DataTable search={forEmployee ? undefined : "Search employee, type or number…"} rows={rows} pageSize={50} empty="No documents yet." columns={columns} />}
      {adding && <AddDocument isHr={isHr && !forEmployee} employeeId={forEmployee || employeeId} people={(people.data || []).filter((p) => p.status !== "Left")} onClose={() => setAdding(false)} onSaved={() => docs.reload()} />}
    </Panel>
  );
}

function AddDocument({ isHr, employeeId, people, onClose, onSaved }) {
  const [file, setFile] = useState(null);
  const [values, setValues] = useState({ employee_id: isHr ? "" : employeeId, doc_type: "", doc_number: "", issue_date: "", expiry_date: "" });
  const [note, setNote] = useState(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const fields = [
    ...(isHr ? [{ name: "employee_id", label: "Employee", type: "select", required: true, options: people.map((p) => ({ value: p.id, label: `${p.employee_code} · ${p.full_name}` })) }] : []),
    { name: "doc_type", label: "Document type", type: "select", required: true, options: DOC_TYPES },
    { name: "doc_number", label: "Number" },
    { name: "issue_date", label: "Issue date", type: "date" },
    { name: "expiry_date", label: "Expiry date", type: "date" },
  ];

  // Reading is a convenience. If the local Document Module is not running, the form stays manual and the upload still works.
  const choose = async (f) => {
    setFile(f); setNote(null); setError(null); setReading(true);
    try {
      const found = fieldsFromRead(await readDocument(f));
      if (Object.keys(found).length) {
        setValues((s) => ({ ...s, ...Object.fromEntries(Object.entries(found).filter(([k]) => !s[k])) }));
        setNote("Some details were read from the file. Check them before saving.");
      } else setNote("Nothing could be read from the file. Type the details.");
    } catch {
      setNote("The document reader is not running on this PC. Type the details; the file still uploads.");
    }
    setReading(false);
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const v = cleanValues(fields, values);
      const owner = isHr ? v.employee_id : employeeId;
      if (!owner) throw new Error("Choose the employee");
      const storage_path = file ? await uploadDocument(owner, file) : null;
      await insertRow("hr_documents", { employee_id: owner, doc_type: v.doc_type, doc_number: v.doc_number, issue_date: v.issue_date, expiry_date: v.expiry_date, storage_path });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Add document" onClose={onClose} wide>
      <form onSubmit={submit}>
        <ErrorNote message={error} />
        <div className="hr-file-row">
          <FilePick label={file ? "Choose a different file" : "Choose file (optional)"} onFile={choose} busy={reading} />
          {file && <span>{file.name}</span>}
          {reading && <span className="bk-muted">Reading the document…</span>}
        </div>
        {note && <p className="bk-note">{note}</p>}
        <FormGrid fields={fields} values={values} setValues={setValues} />
        <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" busy={busy || reading}>Save</Button></div>
      </form>
    </Modal>
  );
}
