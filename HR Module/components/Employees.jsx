import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, KeyVals, PageHead, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { EMP_FIELDS } from "@app/empFields";
import { check, employeeLink, loginProfiles, run, table } from "../services/hrApi";
import { VISA_STATUSES } from "../logic/profile";
import Documents from "./Documents";
import { AssetsPanel, IdPanel, InsurancePanel, MobilePanel, PayPanel, ProfilePhoto } from "./employees/ProfilePanels";

const PERSONAL_FIELDS = [
  { name: "date_of_birth", label: "Date of birth", type: "date" },
  { name: "nationality", label: "Nationality" },
  { name: "visa_status", label: "Visa status", type: "select", options: VISA_STATUSES },
  { name: "address", label: "UAE address", type: "textarea", full: true },
  { name: "permanent_country", label: "Home country" },
  { name: "permanent_address", label: "Permanent address", type: "textarea", full: true },
  { name: "emergency_contact", label: "Emergency contact", full: true },
];

const JOB_LABELS = { work_email: "Office mail", phone: "Office phone" };

const statusTone = (s) => (s === "Active" ? "good" : "warn");

// HR works on every employee. A manager sees themselves and direct reports (read only). An employee sees their own record.
export default function Employees({ role, employeeId, profile, intent }) {
  const isHr = role === "hr";
  const isAdmin = profile?.role === "admin"; // display only: the database refuses anyone else
  const list = useLoad(async () => run(table("hr_employees").select("*").order("employee_code")), []);
  const [openId, setOpenId] = useState(role === "employee" ? employeeId : null);
  const [edit, setEdit] = useState(isHr && intent?.add ? { status: "Active", on_payroll: true } : null);
  const [listView, setListView] = useState("people");
  const rows = list.data || [];
  const byId = Object.fromEntries(rows.map((e) => [e.id, e]));
  const opened = openId ? byId[openId] : null;

  const managerField = { name: "manager_id", label: "Manager", type: "select", options: rows.filter((e) => e.status !== "Left" && e.id !== edit?.id).map((e) => ({ value: e.id, label: `${e.employee_code} · ${e.full_name}` })) };
  const fields = [...EMP_FIELDS.map((f) => (JOB_LABELS[f.name] ? { ...f, label: JOB_LABELS[f.name] } : f)), managerField, { name: "on_payroll", label: "On payroll", type: "bool", checkLabel: "Include in payroll runs", help: "Untick for someone who should not get a pay line" }];
  const save = async (v) => {
    const values = { ...v, updated_at: new Date().toISOString() };
    check(edit.id ? await table("hr_employees").update(values).eq("id", edit.id) : await table("hr_employees").insert(values));
    await list.reload();
  };

  if (list.loading && !list.data) return <Spinner label="Loading employees" />;
  if (opened) {
    return (
      <div>
        {role !== "employee" && <div className="hr-back"><Button onClick={() => setOpenId(null)}>Back to employees</Button></div>}
        <EmployeeDetail employee={opened} manager={byId[opened.manager_id]} role={role} myId={employeeId} isHr={isHr} isAdmin={isAdmin} isSelf={opened.id === employeeId} employees={rows} onChanged={list.reload} onEdit={() => setEdit(opened)} />
        {edit && <FormModal wide title={`Edit ${edit.employee_code}`} fields={fields} initial={edit} onClose={() => setEdit(null)} onSubmit={save} />}
      </div>
    );
  }
  if (role === "employee") {
    return <><ErrorNote message={list.error} /><p className="bk-note">Your employee record could not be loaded.</p></>;
  }
  return (
    <div>
      <PageHead title="Employees" sub={isHr ? "Everyone on the payroll, including leavers." : "You and your direct reports."}>
        {isHr && <Button variant="primary" onClick={() => setEdit({ status: "Active", on_payroll: true })}>+ Add employee</Button>}
      </PageHead>
      <ErrorNote message={list.error} />
      {isHr && (
        <div className="hr-view-bar">
          <div className="hr-switch" role="group" aria-label="View">
            {[["people", "People"], ["documents", "Documents"]].map(([k, label]) => <button type="button" key={k} aria-pressed={listView === k} className={listView === k ? "active" : ""} onClick={() => setListView(k)}>{label}</button>)}
          </div>
        </div>
      )}
      {isHr && listView === "documents" ? <Documents role={role} employeeId={employeeId} /> : (
      <DataTable search="Search code, name or department…" rows={rows} onRow={(e) => setOpenId(e.id)} empty="No employees yet."
        columns={[
          { key: "employee_code", label: "Code" }, { key: "full_name", label: "Name" }, { key: "department", label: "Department" }, { key: "designation", label: "Designation" },
          { key: "manager_id", label: "Manager", render: (e) => byId[e.manager_id]?.full_name || "–" },
          { key: "status", label: "Status", render: (e) => <Badge tone={statusTone(e.status)}>{e.status}</Badge> },
        ]} />
      )}
      {edit && <FormModal wide title={edit.id ? `Edit ${edit.employee_code}` : "Add employee"} fields={fields} initial={edit} onClose={() => setEdit(null)} onSubmit={save} />}
    </div>
  );
}

function EmployeeDetail({ employee: e, manager, role, myId, isHr, isAdmin, isSelf, employees, onChanged, onEdit }) {
  const canSeePersonal = isHr || isSelf; // the database enforces this too: managers get no rows
  const personal = useLoad(async () => (canSeePersonal ? run(table("hr_employee_personal").select("*").eq("employee_id", e.id).maybeSingle()) : null), [e.id, canSeePersonal]);
  const [editPersonal, setEditPersonal] = useState(false);
  const savePersonal = async (v) => {
    check(await table("hr_employee_personal").upsert({ employee_id: e.id, ...v }, { onConflict: "employee_id" }));
    await personal.reload();
  };
  return (
    <>
      <PageHead title={e.full_name} sub={`${e.employee_code}${e.designation ? ` · ${e.designation}` : ""}`}>
        <Badge tone={statusTone(e.status)}>{e.status}</Badge>
        {isHr && <Button onClick={onEdit}>Edit job details</Button>}
      </PageHead>
      {canSeePersonal && <ProfilePhoto employeeId={e.id} path={personal.data?.photo_path} isHr={isHr} onSaved={(photo_path) => savePersonal({ photo_path })} />}
      <div className="hr-split">
        <Panel title="Job details">
          <KeyVals items={[["Department", e.department], ["Designation", e.designation], ["Manager", manager?.full_name], ["Office mail", e.work_email], ["Office phone", e.phone], ["Joined", e.join_date && fmtDate(e.join_date)], ["Exit date", e.exit_date && fmtDate(e.exit_date)], ...(isHr ? [["On payroll", e.on_payroll === false ? "No" : "Yes"]] : [])]} />
        </Panel>
        {canSeePersonal && (
          <Panel title="Personal details" actions={isHr && <Button onClick={() => setEditPersonal(true)}>Edit</Button>}>
            <ErrorNote message={personal.error} />
            {personal.loading && !personal.data ? <Spinner /> : (
              <KeyVals items={[["Date of birth", personal.data?.date_of_birth && fmtDate(personal.data.date_of_birth)], ["Nationality", personal.data?.nationality], ["Visa status", personal.data?.visa_status], ["UAE address", personal.data?.address], ["Home country", personal.data?.permanent_country], ["Permanent address", personal.data?.permanent_address], ["Emergency contact", personal.data?.emergency_contact]]} />
            )}
          </Panel>
        )}
        {canSeePersonal && <IdPanel employeeId={e.id} isHr={isHr} />}
        {isHr && <PayPanel employee={e} />}
      </div>
      {canSeePersonal && <Documents role={role} employeeId={myId} forEmployee={e.id} />}
      {canSeePersonal && <InsurancePanel employeeId={e.id} isHr={isHr} />}
      {canSeePersonal && <MobilePanel employeeId={e.id} isHr={isHr} />}
      {canSeePersonal && <AssetsPanel employee={e} isHr={isHr} />}
      {isAdmin && <LinkLogin employee={e} employees={employees} onChanged={onChanged} />}
      {editPersonal && <FormModal title={`Personal details · ${e.employee_code}`} fields={PERSONAL_FIELDS} initial={personal.data || {}} onClose={() => setEditPersonal(false)} onSubmit={savePersonal} />}
    </>
  );
}

// Admin only. Offers logins not linked to any employee. The database refuses everyone else and audits each change.
function LinkLogin({ employee: e, employees, onChanged }) {
  const profiles = useLoad(loginProfiles, []);
  const [choice, setChoice] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const taken = new Set(employees.map((x) => x.profile_id).filter(Boolean));
  const free = (profiles.data || []).filter((p) => !taken.has(p.id));
  const linkedName = (profiles.data || []).find((p) => p.id === e.profile_id)?.full_name;
  const change = async (profileId) => {
    setError(null); setBusy(true);
    try { await employeeLink(e.id, profileId); setChoice(""); await onChanged(); } catch (err) { setError(err.message); }
    setBusy(false);
  };
  const unlink = () => { if (window.confirm(`Unlink the login from ${e.full_name}? They lose their employee view until linked again.`)) change(null); };
  return (
    <Panel title="Link login" sub="Connects a CRM login to this employee record. Each login links to one employee. Changes are logged.">
      <ErrorNote message={error || profiles.error} onClose={() => setError(null)} />
      {e.profile_id ? (
        <div className="hr-file-row"><span>Linked to {linkedName || e.profile_id}</span><Button busy={busy} onClick={unlink}>Unlink</Button></div>
      ) : (
        <div className="hr-file-row">
          <select aria-label="Login to link" value={choice} onChange={(ev) => setChoice(ev.target.value)}>
            <option value="">Choose a login</option>
            {free.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.id}</option>)}
          </select>
          <Button variant="primary" busy={busy} disabled={!choice} onClick={() => change(choice)}>Link login</Button>
        </div>
      )}
    </Panel>
  );
}
