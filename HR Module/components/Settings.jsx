import { useState } from "react";
import { Button, DataTable, ErrorNote, FormGrid, FormModal, PageHead, Panel, Spinner, cleanValues, fmtDate, useLoad } from "@banking/components/shared";
import { check, run, table } from "../services/hrApi";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]; // extract(dow) 0..6

// HR only. The database refuses these writes for anyone else. Nothing here is pre-filled with statutory values: HR enters them.
export default function Settings({ profile }) {
  const isAdmin = profile?.role === "admin"; // display only: the database still enforces who may change the HR list
  const access = useLoad(async () => (isAdmin ? run(table("hr_access").select("profile_id, granted_at")) : []), [isAdmin]);
  const profiles = useLoad(async () => (isAdmin ? run(table("profiles").select("id, full_name").order("full_name")) : []), [isAdmin]);
  const types = useLoad(async () => run(table("hr_leave_types").select("*").order("name")), []);
  const holidays = useLoad(async () => run(table("hr_holidays").select("*").order("holiday_date")), []);
  const settings = useLoad(async () => run(table("hr_settings").select("*").eq("id", 1).single()), []);
  const [modal, setModal] = useState(null);
  const [error, setError] = useState(null);

  const nameOf = Object.fromEntries((profiles.data || []).map((p) => [p.id, p.full_name]));
  const guard = async (fn, reload) => { setError(null); try { await fn(); await reload(); } catch (e) { setError(e.message); } };
  const remove = (name, id, reload) => { if (window.confirm("Remove this entry?")) guard(async () => check(await table(name).delete().eq("id", id)), reload); };

  const weekend = settings.data?.weekend_days || [];
  const toggleDay = (d) => guard(async () => {
    const next = weekend.includes(d) ? weekend.filter((x) => x !== d) : [...weekend, d].sort();
    check(await table("hr_settings").update({ weekend_days: next }).eq("id", 1));
  }, settings.reload);

  const loading = [access, profiles, types, holidays, settings].some((x) => x.loading && !x.data);
  if (loading) return <Spinner label="Loading settings" />;
  const hrIds = new Set((access.data || []).map((a) => a.profile_id));

  return (
    <div>
      <PageHead title="Settings" sub="HR access, leave types, holidays, working week and payroll basis. Visible to HR only." />
      <ErrorNote message={error || access.error || types.error || holidays.error || settings.error} onClose={() => setError(null)} />

      {isAdmin ? (
      <Panel title="HR access list" sub="People here see and change all HR data. Administrators always have access." actions={<Button onClick={() => setModal("access")}>+ Add person</Button>}>
        <DataTable rows={(access.data || []).map((a) => ({ ...a, id: a.profile_id }))} empty="No one on the list." columns={[
          { key: "name", label: "Person", render: (a) => nameOf[a.profile_id] || a.profile_id },
          { key: "granted_at", label: "Added", render: (a) => fmtDate(a.granted_at) },
          { key: "x", label: "", render: (a) => <Button onClick={() => guard(async () => check(await table("hr_access").delete().eq("profile_id", a.profile_id)), access.reload)}>Remove</Button> },
        ]} />
      </Panel>
      ) : (
        <Panel title="HR access list"><p className="bk-note hr-quiet">An administrator manages the HR access list.</p></Panel>
      )}

      <Panel title="Leave types" sub="Start empty. Enter the entitlements your policy sets; leave annual days blank for no limit." actions={<Button variant="primary" onClick={() => setModal({ kind: "type", row: { paid: true } })}>+ Add leave type</Button>}>
        <DataTable rows={types.data || []} empty="No leave types yet." columns={[
          { key: "name", label: "Name" },
          { key: "paid", label: "Paid", render: (t) => (t.paid ? "Paid" : "Unpaid") },
          { key: "annual_days", label: "Annual days", render: (t) => t.annual_days ?? "No limit" },
          { key: "half_pay_note", label: "Payroll", render: (t) => (t.half_pay_note ? "Review note" : "") },
          { key: "x", label: "", render: (t) => <><Button onClick={() => setModal({ kind: "type", row: t })}>Edit</Button> <Button onClick={() => remove("hr_leave_types", t.id, types.reload)}>Remove</Button></> },
        ]} />
      </Panel>

      <Panel title="Holidays" actions={<Button variant="primary" onClick={() => setModal({ kind: "holiday", row: {} })}>+ Add holiday</Button>}>
        <DataTable rows={holidays.data || []} pageSize={50} empty="No holidays yet." columns={[
          { key: "holiday_date", label: "Date", render: (h) => fmtDate(h.holiday_date) },
          { key: "name", label: "Name" },
          { key: "x", label: "", render: (h) => <><Button onClick={() => setModal({ kind: "holiday", row: h })}>Edit</Button> <Button onClick={() => remove("hr_holidays", h.id, holidays.reload)}>Remove</Button></> },
        ]} />
      </Panel>

      <Panel title="Working week" sub="Tick the days that are weekend. They are not counted as leave days. Working weeks vary by company.">
        <div className="hr-days-row">
          {DAYS.map((n, d) => (
            <label key={n} className="hr-day-check"><input type="checkbox" checked={weekend.includes(d)} onChange={() => toggleDay(d)} /> {n}</label>
          ))}
        </div>
      </Panel>

      <Panel title="Payroll" sub="Every setting here needs confirmation. The law does not fix these, so they stay empty until HR confirms them, and a payroll run or gratuity calculation stops and names what is missing.">
        {settings.data && <PaySettings key={settings.data.updated_at} value={settings.data} onSave={(v) => guard(async () => check(await table("hr_settings").update(v).eq("id", 1)), settings.reload)} />}
      </Panel>

      {isAdmin && modal === "access" && <FormModal title="Add to HR access list" submitLabel="Add" initial={{}} onClose={() => setModal(null)}
        fields={[{ name: "profile_id", label: "Person", type: "select", required: true, options: (profiles.data || []).filter((p) => !hrIds.has(p.id)).map((p) => ({ value: p.id, label: p.full_name })) }]}
        onSubmit={async (v) => { check(await table("hr_access").insert({ profile_id: v.profile_id })); await access.reload(); }} />}
      {modal?.kind === "type" && <FormModal title={modal.row.id ? "Edit leave type" : "Add leave type"} initial={modal.row} onClose={() => setModal(null)}
        fields={[{ name: "name", label: "Name", required: true }, { name: "paid", label: "Paid", type: "select", required: true, options: [{ value: true, label: "Paid" }, { value: false, label: "Unpaid" }] }, { name: "annual_days", label: "Annual days", type: "number", help: "Blank means no limit" }, { name: "half_pay_note", label: "May have half-pay tiers", type: "select", help: "Half pay is not calculated. Yes puts a review note on the pay line", options: [{ value: false, label: "No" }, { value: true, label: "Yes" }] }]}
        onSubmit={async (v) => {
          const values = { name: v.name, paid: v.paid === true || v.paid === "true", annual_days: v.annual_days, half_pay_note: v.half_pay_note === true || v.half_pay_note === "true" };
          check(modal.row.id ? await table("hr_leave_types").update(values).eq("id", modal.row.id) : await table("hr_leave_types").insert(values));
          await types.reload();
        }} />}
      {modal?.kind === "holiday" && <FormModal title={modal.row.id ? "Edit holiday" : "Add holiday"} initial={modal.row} onClose={() => setModal(null)}
        fields={[{ name: "holiday_date", label: "Date", type: "date", required: true }, { name: "name", label: "Name", required: true }]}
        onSubmit={async (v) => {
          check(modal.row.id ? await table("hr_holidays").update(v).eq("id", modal.row.id) : await table("hr_holidays").insert(v));
          await holidays.reload();
        }} />}
    </div>
  );
}

const PAY_FIELDS = [
  { name: "pay_day_divisor_mode", label: "Pay day divisor mode (needs confirmation)", type: "select", help: "Used for the daily rate and for part-month pay", options: [{ value: "fixed", label: "A fixed number of days" }, { value: "calendar_days", label: "Calendar days in the month" }, { value: "working_days", label: "Working days in the month" }] },
  { name: "pay_days_basis", label: "Pay days basis (needs confirmation)", type: "number", help: "The number of days, used only with the fixed mode" },
  { name: "pay_unpaid_wage_base", label: "Unpaid leave wage base (needs confirmation)", type: "select", help: "The wage an unpaid day is taken from", options: [{ value: "basic", label: "Basic wage" }, { value: "total", label: "Total wage" }] },
  { name: "gratuity_daily_divisor", label: "Gratuity daily divisor (needs confirmation)", type: "number", help: "Monthly basic wage divided by this gives a day's wage" },
  { name: "gratuity_fraction_method", label: "Gratuity part-year method (needs confirmation)", type: "select", options: [{ value: "months_12", label: "Completed months / 12" }, { value: "days_365", label: "Days / 365" }] },
  { name: "gratuity_cap_base", label: "Gratuity cap base (needs confirmation)", type: "select", help: "Two years of this wage", options: [{ value: "basic", label: "Basic wage" }, { value: "total", label: "Total wage" }] },
  { name: "gratuity_service_end_inclusive", label: "Gratuity service end date rule (needs confirmation)", type: "tri", help: "Yes: the exit date counts as a day of service" },
];

function PaySettings({ value, onSave }) {
  const [values, setValues] = useState(value);
  return (
    <div>
      <FormGrid fields={PAY_FIELDS} values={values} setValues={setValues} />
      <Button variant="primary" onClick={() => onSave(cleanValues(PAY_FIELDS, values))}>Save payroll settings</Button>
    </div>
  );
}
