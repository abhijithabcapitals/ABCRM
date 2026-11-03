import { useEffect, useRef, useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, KeyVals, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { documentUrl, gratuity, insertRow, openDocument, run, table, updateRow, uploadDocument } from "../../services/hrApi";
import { BAND_TONE, bandLabel, dubaiToday, expiryBand } from "../../logic/expiry";
import { money } from "../../logic/payroll";
import { PROFILE_DOCS, currentPay, isPhoto, latestDoc, payLines } from "../../logic/profile";

// The round photo at the top of a profile. HR changes it. A new photo is a new file: stored files are never replaced.
export function ProfilePhoto({ employeeId, path, isHr, onSaved }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (path) documentUrl(path).then((u) => { if (live) setUrl(u); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [path]);
  const choose = async (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    setError(null);
    if (!isPhoto(file.name)) { setError("Choose a PNG, JPG or WEBP picture"); return; }
    setBusy(true);
    try { await onSaved(await uploadDocument(employeeId, file)); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  return (
    <div className="hr-profile-head">
      {url ? <img className="hr-photo" src={url} alt="Employee" /> : <div className="hr-photo hr-photo-empty">No photo</div>}
      {isHr && <>
        <input ref={input} type="file" accept=".png,.jpg,.jpeg,.webp" hidden onChange={choose} aria-label="Employee photo" />
        <Button busy={busy} onClick={() => input.current?.click()}>{path ? "Change photo" : "Add photo"}</Button>
      </>}
      <ErrorNote message={error} onClose={() => setError(null)} />
    </div>
  );
}

// Visa, Emirates ID and driving licence: the same records as the Documents tab. HR adds and edits; the employee reads their own.
export function IdPanel({ employeeId, isHr }) {
  const docs = useLoad(async () => run(table("hr_documents").select("*").eq("employee_id", employeeId).in("doc_type", PROFILE_DOCS)), [employeeId]);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);
  const today = dubaiToday();
  const rows = PROFILE_DOCS.map((type) => ({ id: type, type, doc: latestDoc(docs.data, type) }));
  const view = async (path) => { setError(null); try { await openDocument(path); } catch (e) { setError(e.message); } };
  return (
    <Panel title="Visa and IDs" sub="Files and older copies are in Documents.">
      <ErrorNote message={error || docs.error} onClose={() => setError(null)} />
      {docs.loading && !docs.data ? <Spinner /> : (
        <DataTable rows={rows} columns={[
          { key: "type", label: "Type" },
          { key: "number", label: "Number", render: (r) => r.doc?.doc_number || "–" },
          { key: "issue", label: "Issued", render: (r) => (r.doc?.issue_date ? fmtDate(r.doc.issue_date) : "–") },
          { key: "expiry", label: "Expiry", render: (r) => {
            if (!r.doc?.expiry_date) return "–";
            const band = expiryBand(r.doc.expiry_date, today);
            return <>{fmtDate(r.doc.expiry_date)}{band && <> <Badge tone={BAND_TONE[band]}>{bandLabel(band)}</Badge></>}</>;
          } },
          { key: "x", label: "", render: (r) => <>
            {r.doc?.storage_path && <><Button onClick={() => view(r.doc.storage_path)}>View</Button> </>}
            {isHr && <Button onClick={() => setEditing({ type: r.type, row: r.doc })}>{r.doc ? "Edit" : "Add"}</Button>}
          </> },
        ]} />
      )}
      {editing && <FormModal title={`${editing.type}`} initial={editing.row || {}} onClose={() => setEditing(null)}
        fields={[{ name: "doc_number", label: "Number" }, { name: "issue_date", label: "Issue date", type: "date" }, { name: "expiry_date", label: "Expiry date", type: "date" }]}
        onSubmit={async (v) => {
          const values = { doc_number: v.doc_number || null, issue_date: v.issue_date || null, expiry_date: v.expiry_date || null };
          await (editing.row ? updateRow("hr_documents", editing.row.id, values) : insertRow("hr_documents", { employee_id: employeeId, doc_type: editing.type, ...values }));
          await docs.reload();
        }} />}
    </Panel>
  );
}

// HR only: the database gives pay rows and gratuity to nobody else.
export function PayPanel({ employee: e }) {
  const today = dubaiToday();
  const pay = useLoad(async () => run(table("hr_pay_details").select("*").eq("employee_id", e.id)), [e.id]);
  const asOf = e.exit_date || today;
  const grat = useLoad(() => gratuity(e.id, asOf), [e.id, asOf]);
  const current = currentPay(pay.data, today);
  const parts = current ? payLines(current) : null;
  return (
    <Panel title="Salary and gratuity" sub="Changed in Salary Master.">
      <ErrorNote message={pay.error} />
      {pay.loading && !pay.data ? <Spinner /> : !current ? <p className="bk-note hr-quiet">No salary set.</p> : (
        <KeyVals items={[
          ...parts.lines.map(([k, v]) => [k, money(v)]),
          ["Monthly total", <span key="t" className="hr-pay-total">{money(parts.total)}</span>],
          ["Effective from", fmtDate(current.effective_from)],
          ["Bank account (IBAN)", current.iban],
          ["Bank routing code", current.bank_routing],
        ]} />
      )}
      <h4 className="hr-subhead">Gratuity to {fmtDate(asOf)}</h4>
      {grat.error ? <p className="bk-note hr-quiet">{grat.error}</p> : grat.loading && !grat.data ? <Spinner /> : grat.data && (
        <>
          <KeyVals items={[["Estimate", money(grat.data.amount)], ["Basic wage used", money(grat.data.basic)], ["Years counted", String(grat.data.years)], ["Gratuity days", String(grat.data.days)]]} />
          <p className="bk-note hr-quiet">{grat.data.note}</p>
        </>
      )}
    </Panel>
  );
}
