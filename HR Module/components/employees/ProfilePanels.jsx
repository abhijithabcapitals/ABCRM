import { useEffect, useRef, useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, KeyVals, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { check, documentUrl, gratuity, insertRow, openDocument, run, table, updateRow, uploadDocument } from "../../services/hrApi";
import { BAND_TONE, bandLabel, dubaiToday, expiryBand } from "../../logic/expiry";
import { money } from "../../logic/payroll";
import { PROFILE_DOCS, currentPay, isPhoto, latestDoc, payLines } from "../../logic/profile";
import { insuranceEnd, unreturnedAssets } from "../../logic/requests";

const day = (d) => (d ? fmtDate(d) : "–");
const expiry = (d) => {
  const band = d && expiryBand(d, dubaiToday());
  return <>{day(d)}{band && <> <Badge tone={BAND_TONE[band]}>{bandLabel(band)}</Badge></>}</>;
};

// A table of one kind of record on a profile, kept with its history. HR changes it; the employee reads their own.
function RecordsPanel({ title, sub, tableName, employeeId, isHr, fields, columns, label, tidy, warn }) {
  const rows = useLoad(async () => run(table(tableName).select("*").eq("employee_id", employeeId).order("created_at", { ascending: false })), [tableName, employeeId]);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);
  const remove = async (id) => {
    if (!window.confirm("Remove this entry?")) return;
    setError(null);
    try { check(await table(tableName).delete().eq("id", id)); await rows.reload(); } catch (e) { setError(e.message); }
  };
  return (
    <Panel title={title} sub={sub} actions={isHr && <Button onClick={() => setEditing({})}>+ Add</Button>}>
      <ErrorNote message={error || rows.error} onClose={() => setError(null)} />
      {warn?.(rows.data) && <div className="hr-warning" role="alert">{warn(rows.data)}</div>}
      {rows.loading && !rows.data ? <Spinner /> : (
        <DataTable rows={rows.data || []} empty={`No ${label} yet.`} columns={[
          ...columns,
          ...(isHr ? [{ key: "x", label: "", render: (r) => <><Button onClick={() => setEditing(r)}>Edit</Button> <Button onClick={() => remove(r.id)}>Remove</Button></> }] : []),
        ]} />
      )}
      {editing && <FormModal wide title={`${editing.id ? "Edit" : "Add"}: ${title}`} initial={editing} fields={fields} onClose={() => setEditing(null)}
        onSubmit={async (v) => {
          const values = tidy ? tidy(v) : v;
          await (editing.id ? updateRow(tableName, editing.id, values) : insertRow(tableName, { employee_id: employeeId, ...values }));
          await rows.reload();
        }} />}
    </Panel>
  );
}

export const InsurancePanel = ({ employeeId, isHr }) => (
  <RecordsPanel title="Insurance" label="insurance" tableName="hr_insurance" employeeId={employeeId} isHr={isHr}
    fields={[
      { name: "company", label: "Company", required: true }, { name: "plan_name", label: "Plan name" }, { name: "covered", label: "Covered", help: "Who or what the plan covers" },
      { name: "start_date", label: "Start date", type: "date" }, { name: "tenure_months", label: "Tenure (months)", type: "number" },
      { name: "end_date", label: "End date", type: "date", help: "Blank works it out from the start date and tenure" },
    ]}
    tidy={(v) => ({ ...v, end_date: v.end_date || insuranceEnd(v.start_date, v.tenure_months) || null })}
    columns={[
      { key: "company", label: "Company" }, { key: "plan_name", label: "Plan", render: (r) => r.plan_name || "–" }, { key: "covered", label: "Covered", render: (r) => r.covered || "–" },
      { key: "start_date", label: "Start", render: (r) => day(r.start_date) }, { key: "tenure_months", label: "Tenure", render: (r) => (r.tenure_months ? `${r.tenure_months} months` : "–") },
      { key: "end_date", label: "End", render: (r) => expiry(r.end_date) },
    ]} />
);

export const MobilePanel = ({ employeeId, isHr }) => (
  <RecordsPanel title="Mobile plan" label="mobile plans" tableName="hr_mobile_plans" employeeId={employeeId} isHr={isHr}
    fields={[
      { name: "phone_number", label: "Office number", required: true }, { name: "provider", label: "Provider" }, { name: "plan_name", label: "Plan" },
      { name: "recharge_date", label: "Recharge date", type: "date" }, { name: "next_recharge_date", label: "Next recharge", type: "date" }, { name: "amount", label: "Amount (AED)", type: "number" },
    ]}
    columns={[
      { key: "phone_number", label: "Office number" }, { key: "provider", label: "Provider", render: (r) => r.provider || "–" }, { key: "plan_name", label: "Plan", render: (r) => r.plan_name || "–" },
      { key: "recharge_date", label: "Recharged", render: (r) => day(r.recharge_date) }, { key: "next_recharge_date", label: "Next", render: (r) => expiry(r.next_recharge_date) },
      { key: "amount", label: "Amount", render: (r) => (r.amount === null ? "–" : money(r.amount)) },
    ]} />
);

export const AssetsPanel = ({ employee, isHr }) => (
  <RecordsPanel title="Assets issued" label="assets" tableName="hr_assets" employeeId={employee.id} isHr={isHr}
    warn={(rows) => { const out = employee.status === "Left" ? unreturnedAssets(rows) : []; return out.length ? `This person has left and still holds: ${out.map((a) => a.asset_type).join(", ")}.` : null; }}
    fields={[
      { name: "asset_type", label: "Type", required: true, help: "Laptop, Mobile, SIM and so on" }, { name: "make_model", label: "Make and model" }, { name: "serial_number", label: "Serial number" },
      { name: "issued_on", label: "Issued on", type: "date" }, { name: "returned_on", label: "Returned on", type: "date" }, { name: "note", label: "Note", type: "textarea", full: true },
    ]}
    columns={[
      { key: "asset_type", label: "Type" }, { key: "make_model", label: "Make and model", render: (r) => r.make_model || "–" }, { key: "serial_number", label: "Serial", render: (r) => r.serial_number || "–" },
      { key: "issued_on", label: "Issued", render: (r) => day(r.issued_on) }, { key: "returned_on", label: "Returned", render: (r) => (r.returned_on ? fmtDate(r.returned_on) : <Badge tone="warn">With employee</Badge>) },
      { key: "note", label: "Note", render: (r) => r.note || "–" },
    ]} />
);

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
