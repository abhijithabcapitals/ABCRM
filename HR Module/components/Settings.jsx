import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormGrid, FormModal, PageHead, Panel, Spinner, cleanValues, fmtDate, useLoad } from "@banking/components/shared";
import { calendarMarkConfirm, check, run, saveWfhRule, table, wfhRules } from "../services/hrApi";
import { confirmSoon, dubaiToday, parseTime } from "../logic/attendance";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]; // extract(dow) 0..6

// HR only. The database refuses these writes for anyone else. Nothing here is pre-filled with statutory values: HR enters them.
export default function Settings({ profile }) {
  const isAdmin = profile?.role === "admin"; // display only: the database still enforces who may change the HR list
  const access = useLoad(async () => (isAdmin ? run(table("hr_access").select("profile_id, granted_at")) : []), [isAdmin]);
  const profiles = useLoad(async () => (isAdmin ? run(table("profiles").select("id, full_name").order("full_name")) : []), [isAdmin]);
  const finance = useLoad(async () => (isAdmin ? run(table("hr_finance_managers").select("profile_id, granted_at")) : []), [isAdmin]);
  const types = useLoad(async () => run(table("hr_leave_types").select("*").order("name")), []);
  const holidays = useLoad(async () => run(table("hr_holidays").select("*").order("holiday_date")), []);
  const marks = useLoad(async () => run(table("hr_calendar_marks").select("*").order("mark_date")), []);
  const settings = useLoad(async () => run(table("hr_settings").select("*").eq("id", 1).single()), []);
  const rules = useLoad(wfhRules, []);
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
      <ErrorNote message={error || access.error || profiles.error || types.error || holidays.error || settings.error} onClose={() => setError(null)} />

      {isAdmin ? (
      <Panel title="HR access list" sub="People here see and change all HR data. Administrators always have access." actions={<Button onClick={() => setModal("access")}>+ Add person</Button>}>
        <DataTable rows={(access.data || []).map((a) => ({ ...a, id: a.profile_id }))} empty="No one on the list." columns={[
          { key: "name", label: "Person", render: (a) => nameOf[a.profile_id] || a.profile_id },
          { key: "granted_at", label: "Added", render: (a) => fmtDate(a.granted_at) },
          { key: "x", label: "", render: (a) => <Button onClick={() => { if (window.confirm(`Remove ${nameOf[a.profile_id] || "this person"} from the HR access list?`)) guard(async () => check(await table("hr_access").delete().eq("profile_id", a.profile_id)), access.reload); }}>Remove</Button> },
        ]} />
      </Panel>
      ) : (
        <Panel title="HR access list"><p className="bk-note hr-quiet">An administrator manages the HR access list.</p></Panel>
      )}

      {isAdmin && (
      <Panel title="Finance Managers" sub="They approve expense claims, which then go to Accounts. Administrators can approve too. Someone here needs a linked employee record to open the HR tab." actions={<Button onClick={() => setModal("finance")}>+ Add person</Button>}>
        <ErrorNote message={finance.error} />
        <DataTable rows={(finance.data || []).map((a) => ({ ...a, id: a.profile_id }))} empty="No one on the list." columns={[
          { key: "name", label: "Person", render: (a) => nameOf[a.profile_id] || a.profile_id },
          { key: "granted_at", label: "Added", render: (a) => fmtDate(a.granted_at) },
          { key: "x", label: "", render: (a) => <Button onClick={() => { if (window.confirm(`Remove ${nameOf[a.profile_id] || "this person"} from the Finance Managers?`)) guard(async () => check(await table("hr_finance_managers").delete().eq("profile_id", a.profile_id)), finance.reload); }}>Remove</Button> },
        ]} />
      </Panel>
      )}

      <Panel title="Leave types" sub="Start empty. Enter the entitlements your policy sets; leave annual days blank for no limit." actions={<Button variant="primary" onClick={() => setModal({ kind: "type", row: { paid: true } })}>+ Add leave type</Button>}>
        <DataTable rows={types.data || []} empty="No leave types yet." columns={[
          { key: "name", label: "Name" },
          { key: "paid", label: "Paid", render: (t) => (t.paid ? "Paid" : "Unpaid") },
          { key: "annual_days", label: "Annual days", render: (t) => t.annual_days ?? "No limit" },
          { key: "carry_forward", label: "Carries forward", render: (t) => (t.carry_forward ? "Yes" : "No") },
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

      <Panel title="Calendar marks" sub="Estimated UAE Islamic holidays and India festivals. A mark only shows on the calendar: the day still counts as a working day. When the UAE date is announced, press Confirm to make it a holiday." actions={<Button variant="primary" onClick={() => setModal({ kind: "mark", row: { region: "India" } })}>+ Add mark</Button>}>
        <ErrorNote message={marks.error} />
        <DataTable search="Search name or region…" rows={marks.data || []} pageSize={25} empty="No marks yet." columns={[
          { key: "mark_date", label: "Date", render: (m) => fmtDate(m.mark_date) },
          { key: "name", label: "Name" },
          { key: "region", label: "Region", render: (m) => <>{m.region}{confirmSoon(m, dubaiToday()) && <> <Badge tone="warn">Confirm the date</Badge></>}</> },
          { key: "source", label: "Source", render: (m) => m.source || "–" },
          { key: "x", label: "", render: (m) => <>
            {m.region === "UAE" && <><Button onClick={() => setModal({ kind: "confirm", row: m })}>Confirm</Button> </>}
            <Button onClick={() => setModal({ kind: "mark", row: m })}>Edit</Button> <Button onClick={() => remove("hr_calendar_marks", m.id, marks.reload)}>Remove</Button>
          </> },
        ]} />
      </Panel>

      <Panel title="Working week" sub="Tick the days that are weekend. They are not counted as leave days. Working weeks vary by company.">
        <div className="hr-days-row">
          {DAYS.map((n, d) => (
            <label key={n} className="hr-day-check"><input type="checkbox" checked={weekend.includes(d)} onChange={() => toggleDay(d)} /> {n}</label>
          ))}
        </div>
      </Panel>

      <Panel title="Working hours" sub="Late counts from the start time. Overtime counts from the end time, or the Saturday end time on Saturdays.">
        {settings.data && <ShiftSettings key={settings.data.updated_at} value={settings.data} onSave={(v) => guard(async () => check(await table("hr_settings").update(v).eq("id", 1)), settings.reload)} />}
      </Panel>

      <Panel title="Work from home Saturdays" sub="Everyone is marked Work From Home on these Saturdays, with no punch needed. Leave a date blank for no limit." actions={<Button variant="primary" onClick={() => setModal({ kind: "rule", row: {} })}>+ Add rule</Button>}>
        <DataTable rows={rules.data || []} empty="No rules yet." columns={[
          { key: "effective_from", label: "From", render: (r) => (r.effective_from ? fmtDate(r.effective_from) : "No limit") },
          { key: "effective_to", label: "To", render: (r) => (r.effective_to ? fmtDate(r.effective_to) : "No limit") },
          { key: "pattern", label: "Saturdays", render: (r) => WFH_LABEL[r.pattern] },
          { key: "x", label: "", render: (r) => <><Button onClick={() => setModal({ kind: "rule", row: r })}>Edit</Button> <Button onClick={() => remove("hr_wfh_saturday_rules", r.id, rules.reload)}>Remove</Button></> },
        ]} />
      </Panel>

      <Panel title="Payroll" sub="Every setting here needs confirmation. The law does not fix these, so they stay empty until HR confirms them, and a payroll run or gratuity calculation stops and names what is missing.">
        {settings.data && <PaySettings key={settings.data.updated_at} value={settings.data} onSave={(v) => guard(async () => check(await table("hr_settings").update(v).eq("id", 1)), settings.reload)} />}
      </Panel>

      {isAdmin && modal === "finance" && <FormModal title="Add a Finance Manager" submitLabel="Add" initial={{}} onClose={() => setModal(null)}
        fields={[{ name: "profile_id", label: "Person", type: "select", required: true, options: (profiles.data || []).filter((p) => !(finance.data || []).some((f) => f.profile_id === p.id)).map((p) => ({ value: p.id, label: p.full_name })) }]}
        onSubmit={async (v) => { check(await table("hr_finance_managers").insert({ profile_id: v.profile_id })); await finance.reload(); }} />}
      {isAdmin && modal === "access" && <FormModal title="Add to HR access list" submitLabel="Add" initial={{}} onClose={() => setModal(null)}
        fields={[{ name: "profile_id", label: "Person", type: "select", required: true, options: (profiles.data || []).filter((p) => !hrIds.has(p.id)).map((p) => ({ value: p.id, label: p.full_name })) }]}
        onSubmit={async (v) => { check(await table("hr_access").insert({ profile_id: v.profile_id })); await access.reload(); }} />}
      {modal?.kind === "type" && <FormModal title={modal.row.id ? "Edit leave type" : "Add leave type"} initial={modal.row} onClose={() => setModal(null)}
        fields={[{ name: "name", label: "Name", required: true }, { name: "carry_forward", label: "Unused days carry forward", type: "select", options: [{ value: true, label: "Yes" }, { value: false, label: "No" }] }, { name: "paid", label: "Paid", type: "select", required: true, options: [{ value: true, label: "Paid" }, { value: false, label: "Unpaid" }] }, { name: "annual_days", label: "Annual days", type: "number", help: "Blank means no limit" }, { name: "half_pay_note", label: "May have half-pay tiers", type: "select", help: "Half pay is not calculated. Yes puts a review note on the pay line", options: [{ value: false, label: "No" }, { value: true, label: "Yes" }] }]}
        onSubmit={async (v) => {
          const values = { name: v.name, paid: v.paid === true || v.paid === "true", annual_days: v.annual_days, half_pay_note: v.half_pay_note === true || v.half_pay_note === "true", carry_forward: v.carry_forward === true || v.carry_forward === "true" };
          check(modal.row.id ? await table("hr_leave_types").update(values).eq("id", modal.row.id) : await table("hr_leave_types").insert(values));
          await types.reload();
        }} />}
      {modal?.kind === "rule" && <FormModal title={modal.row.id ? "Edit rule" : "Add rule"} initial={modal.row} onClose={() => setModal(null)}
        fields={[{ name: "effective_from", label: "From", type: "date" }, { name: "effective_to", label: "To", type: "date" },
          { name: "pattern", label: "Saturdays", type: "select", required: true, options: Object.entries(WFH_LABEL).map(([value, label]) => ({ value, label })) }]}
        onSubmit={async (v) => { await saveWfhRule(modal.row.id, { effective_from: v.effective_from || null, effective_to: v.effective_to || null, pattern: v.pattern }); await rules.reload(); }} />}
      {modal?.kind === "mark" && <FormModal title={modal.row.id ? "Edit mark" : "Add mark"} initial={modal.row} onClose={() => setModal(null)}
        fields={[{ name: "mark_date", label: "Date", type: "date", required: true }, { name: "name", label: "Name", required: true },
          { name: "region", label: "Region", type: "select", required: true, options: ["UAE", "India"] }, { name: "source", label: "Source" }]}
        onSubmit={async (v) => {
          const values = { mark_date: v.mark_date, name: v.name, region: v.region, source: v.source || null };
          check(modal.row.id ? await table("hr_calendar_marks").update(values).eq("id", modal.row.id) : await table("hr_calendar_marks").insert(values));
          await marks.reload();
        }} />}
      {modal?.kind === "confirm" && <FormModal title={`Confirm ${modal.row.name}`} submitLabel="Make it a holiday" initial={{ date: modal.row.mark_date }} onClose={() => setModal(null)}
        note="Use the date the government announced, which may differ from this estimate. The day then counts as a holiday in attendance, leave and pay."
        fields={[{ name: "date", label: "Announced date", type: "date", required: true }]}
        onSubmit={async (v) => {
          await calendarMarkConfirm(modal.row.id, v.date);
          await Promise.all([marks.reload(), holidays.reload()]);
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

const WFH_LABEL = { last: "Last Saturday of the month", second_and_last: "2nd and last Saturday of the month" };
const SHIFT_FIELDS = [
  { name: "shift_start", label: "Start", help: "HH:MM" },
  { name: "shift_end", label: "End", help: "HH:MM" },
  { name: "saturday_end", label: "Saturday end", help: "HH:MM" },
];

function ShiftSettings({ value, onSave }) {
  const [values, setValues] = useState({ shift_start: String(value.shift_start).slice(0, 5), shift_end: String(value.shift_end).slice(0, 5), saturday_end: String(value.saturday_end).slice(0, 5) });
  return (
    <div>
      <FormGrid fields={SHIFT_FIELDS} values={values} setValues={setValues} />
      <Button variant="primary" onClick={() => onSave({ shift_start: parseTime(values.shift_start), shift_end: parseTime(values.shift_end), saturday_end: parseTime(values.saturday_end) })}>Save working hours</Button>
    </div>
  );
}

function PaySettings({ value, onSave }) {
  const [values, setValues] = useState(value);
  return (
    <div>
      <FormGrid fields={PAY_FIELDS} values={values} setValues={setValues} />
      <Button variant="primary" onClick={() => onSave(cleanValues(PAY_FIELDS, values))}>Save payroll settings</Button>
    </div>
  );
}
