import { useMemo, useState } from "react";
import { Button, ErrorNote, PageHead, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { attendanceRange } from "../services/hrApi";
import BiometricPanel from "./BiometricPanel";
import CalendarView from "./attendance/CalendarView";
import DailyList from "./attendance/DailyList";
import EditDayModal from "./attendance/EditDayModal";
import MonthGrid from "./attendance/MonthGrid";
import WeekView from "./attendance/WeekView";
import YearHeatmap from "./attendance/YearHeatmap";
import { SHORT, STATUSES, canEditDay, dubaiToday, groupRange, monthDays, periodRange, shiftPeriod, statusLabel, weekDays } from "../logic/attendance";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const VIEWS = [
  { key: "month", label: "Month grid", period: "month" },
  { key: "calendar", label: "Calendar", period: "month" },
  { key: "week", label: "Week", period: "week" },
  { key: "year", label: "Year", period: "year" },
  { key: "daily", label: "Daily list", period: "day" },
];

function periodTitle(period, date) {
  if (period === "month") return `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
  if (period === "year") return date.slice(0, 4);
  if (period === "week") { const w = weekDays(date); return `${fmtDate(w[0])} to ${fmtDate(w[6])}`; }
  return fmtDate(date);
}

// Five views of one set of rows from hr_attendance_range. HR changes anyone's day, a manager direct reports' days (not their own), an employee only reads.
// The database enforces all of it; the buttons here only follow it.
export default function Attendance({ role, employeeId, profile }) {
  const today = dubaiToday();
  const isAdmin = profile?.role === "admin";
  const [viewKey, setViewKey] = useState("month");
  const [date, setDate] = useState(today);
  const [personId, setPersonId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState(null);
  const view = VIEWS.find((v) => v.key === viewKey);
  const range = periodRange(view.period, date);
  const rows = useLoad(() => attendanceRange(range.from, range.to), [range.from, range.to]);
  const people = useMemo(() => groupRange(rows.data), [rows.data]);
  const person = people.find((p) => p.employee_id === personId) || people.find((p) => p.employee_id === employeeId) || people[0];
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const canEdit = (p, d) => canEditDay({ role, myId: employeeId, employeeId: p.employee_id, date: d, today, employeeStatus: p.employee_status, exitDate: p.exit_date });
  const onEdit = (p, d) => { setNotice(null); setEditing({ person: p, date: d }); };
  const needsPerson = viewKey === "calendar" || viewKey === "year";

  return (
    <div>
      <PageHead title="Attendance Sheet" sub={role === "hr" ? "Everyone. Click a day to change it." : role === "manager" ? "You and your direct reports. Click a report's day to request a change." : "Your attendance."}>
        <span className="hr-month-nav">
          <Button onClick={() => setDate(shiftPeriod(view.period, date, -1))} aria-label="Previous">‹</Button>
          <strong>{periodTitle(view.period, date)}</strong>
          <Button onClick={() => setDate(shiftPeriod(view.period, date, 1))} aria-label="Next">›</Button>
        </span>
      </PageHead>
      <ErrorNote message={rows.error} />
      {notice && <div className="hr-warning" role="status">{notice}</div>}
      <Panel>
        <div className="hr-view-bar">
          <div className="hr-switch" role="group" aria-label="View">
            {VIEWS.map((v) => <button type="button" key={v.key} aria-pressed={viewKey === v.key} className={viewKey === v.key ? "active" : ""} onClick={() => setViewKey(v.key)}>{v.label}</button>)}
          </div>
          {needsPerson && people.length > 1 && (
            <select className="hr-person-pick" aria-label="Employee" value={person?.employee_id || ""} onChange={(e) => setPersonId(e.target.value)}>
              {people.map((p) => <option key={p.employee_id} value={p.employee_id}>{p.employee_code} · {p.full_name}</option>)}
            </select>
          )}
        </div>
        <div className="hr-legend" aria-label="Legend">
          {STATUSES.map((s) => <span key={s}><i className={`hr-cell-${s}`} />{SHORT[s]} {statusLabel({ status: s })}</span>)}
          <span>Blank: not counted</span>
        </div>
        {rows.loading && !rows.data ? <Spinner label="Loading attendance" /> : !people.length ? (
          <p className="bk-note hr-quiet">No employees to show for this period.</p>
        ) : viewKey === "month" ? <MonthGrid days={monthDays(year, month)} people={people} today={today} canEdit={canEdit} onEdit={onEdit} />
          : viewKey === "calendar" ? <CalendarView person={person} days={monthDays(year, month)} today={today} canEdit={canEdit} onEdit={onEdit} />
          : viewKey === "week" ? <WeekView days={weekDays(date)} people={people} today={today} canEdit={canEdit} onEdit={onEdit} />
          : viewKey === "year" ? <YearHeatmap person={person} year={year} today={today} canEdit={canEdit} onEdit={onEdit} />
          : <DailyList date={date} people={people} canEdit={canEdit} onEdit={onEdit} />}
      </Panel>
      {role === "hr" && <BiometricPanel onChanged={rows.reload} />}
      {editing && (
        <EditDayModal person={editing.person} date={editing.date} isAdmin={isAdmin} onClose={() => setEditing(null)}
          onSaved={async (message) => { setNotice(message); await rows.reload(); }} />
      )}
    </div>
  );
}
