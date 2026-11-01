import { useMemo, useState } from "react";
import { Button, ErrorNote, FormModal, PageHead, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { attendanceMonth, attendanceSet } from "../services/hrApi";
import { STATUSES, canEditDay, dubaiToday, groupMonth, monthDays, parseTime, shiftMonth } from "../logic/attendance";

const SHORT = { Present: "P", Absent: "A", Leave: "L", Holiday: "H", Weekend: "W" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAY = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const dow = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
const hhmm = (t) => (t ? String(t).slice(0, 5) : "");

// Month grid: one line per person, one column per day. A stored entry wins, then approved leave, a holiday, a weekend; a blank
// cell is a working day with nothing recorded. HR sets anyone's day, a manager sets direct reports' days (not their own), an
// employee only reads. Future days cannot be set. The database enforces all of it; the buttons here only follow it.
// The grid scrolls sideways inside its own box so it stays usable at phone width.
export default function Attendance({ role, employeeId }) {
  const today = dubaiToday();
  const [ym, setYm] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }));
  const rows = useLoad(() => attendanceMonth(ym.year, ym.month), [ym.year, ym.month]);
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState(null);
  const days = useMemo(() => monthDays(ym.year, ym.month), [ym.year, ym.month]);
  const people = useMemo(() => groupMonth(rows.data), [rows.data]);
  const go = (by) => setYm((c) => shiftMonth(c.year, c.month, by));
  const canEdit = (p, date) => canEditDay({ role, myId: employeeId, employeeId: p.employee_id, date, today, employeeStatus: p.employee_status, exitDate: p.exit_date });

  const fields = [
    { name: "status", label: "Status", type: "select", required: true, options: STATUSES },
    { name: "time_in", label: "Time in", help: "HH:MM, only for Present" },
    { name: "time_out", label: "Time out", help: "HH:MM, only for Present" },
    { name: "note", label: "Note", type: "textarea", full: true },
  ];
  const submit = async (v) => {
    const timeIn = parseTime(v.time_in);
    const timeOut = parseTime(v.time_out);
    await attendanceSet(editing.person.employee_id, editing.date, v.status, timeIn, timeOut, v.note);
    setNotice(`Saved ${editing.person.full_name}, ${fmtDate(editing.date)}.`);
    await rows.reload();
  };

  return (
    <div>
      <PageHead title="Attendance" sub={role === "hr" ? "Everyone. Click a day to set it." : role === "manager" ? "You and your direct reports. Click a report's day to set it." : "Your attendance."}>
        <span className="hr-month-nav">
          <Button onClick={() => go(-1)} aria-label="Previous month">‹</Button>
          <strong>{MONTHS[ym.month - 1]} {ym.year}</strong>
          <Button onClick={() => go(1)} aria-label="Next month">›</Button>
        </span>
      </PageHead>
      <ErrorNote message={rows.error} />
      {notice && <div className="hr-warning" role="status">{notice}</div>}
      <Panel>
        <div className="hr-legend" aria-label="Legend">
          {STATUSES.map((s) => <span key={s}><i className={`hr-cell-${s}`} />{SHORT[s]} {s}</span>)}
          <span>Blank: nothing recorded</span>
        </div>
        {rows.loading && !rows.data ? <Spinner label="Loading attendance" /> : !people.length ? (
          <p className="bk-note hr-quiet">No employees to show for this month.</p>
        ) : (
          <div className="hr-grid-wrap" tabIndex={0} aria-label="Attendance month grid, scrolls sideways">
            <table className="hr-grid">
              <thead>
                <tr>
                  <th className="hr-grid-name">Employee</th>
                  {days.map((d) => <th key={d}>{Number(d.slice(8))}<small>{WEEKDAY[dow(d)]}</small></th>)}
                  <th className="hr-grid-sum">Present / Absent</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.employee_id}>
                    <th scope="row" className="hr-grid-name" title={`${p.employee_code} · ${p.full_name}`}>{p.employee_code} · {p.full_name}</th>
                    {days.map((d) => {
                      const r = p.days[d];
                      if (!r) return <td key={d}><span className="hr-cell" aria-label="Not employed" /></td>;
                      const times = r.time_in || r.time_out ? ` ${hhmm(r.time_in) || "?"}-${hhmm(r.time_out) || "?"}` : "";
                      const tip = `${p.full_name}, ${fmtDate(d)}: ${r.status || "Nothing recorded"}${times}${r.note ? `. ${r.note}` : ""}`;
                      const cls = `hr-cell ${r.status ? `hr-cell-${r.status}` : ""} ${d === today ? "hr-cell-today" : ""}`;
                      const text = r.status ? SHORT[r.status] : "";
                      return (
                        <td key={d}>
                          {canEdit(p, d)
                            ? <button type="button" className={cls} title={tip} aria-label={tip} onClick={() => { setNotice(null); setEditing({ person: p, date: d, row: r }); }}>{text}</button>
                            : <span className={cls} title={tip} role="img" aria-label={tip}>{text}</span>}
                        </td>
                      );
                    })}
                    <td className="hr-grid-sum">{p.counts.Present} / {p.counts.Absent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {editing && (
        <FormModal title={`${editing.person.full_name}, ${fmtDate(editing.date)}`} fields={fields} onClose={() => setEditing(null)} onSubmit={submit}
          initial={{ status: editing.row.status || "Present", time_in: hhmm(editing.row.time_in), time_out: hhmm(editing.row.time_out), note: editing.row.note || "" }}
          note="Absent, Leave, Holiday and Weekend days cannot carry times. A day that already has an entry is replaced; the change is logged." />
      )}
    </div>
  );
}
