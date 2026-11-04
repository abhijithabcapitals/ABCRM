import { useMemo, useState } from "react";
import { Button, ErrorNote, PageHead, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { attendanceRange, biometricSync, calendarMarks } from "../services/hrApi";
import AttendanceHistory from "./attendance/AttendanceHistory";
import BiometricPanel from "./BiometricPanel";
import CalendarView from "./attendance/CalendarView";
import DailyList from "./attendance/DailyList";
import EditDayModal from "./attendance/EditDayModal";
import EndlessGrid from "./attendance/EndlessGrid";
import WeekView from "./attendance/WeekView";
import YearHeatmap from "./attendance/YearHeatmap";
import { SHORT, STATUSES, canEditDay, dubaiToday, groupRange, markText, marksByDate, monthDays, periodRange, shiftPeriod, staffSyncNote, statusLabel, weekDays, withEveryone } from "../logic/attendance";

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

// Five views of one set of rows from hr_attendance_range. HR changes anyone's day, a manager asks for direct reports' days, and everyone asks for their own.
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
  // The month grid loads its own months as it scrolls, so nothing is fetched for it here.
  const endless = viewKey === "month";
  const rows = useLoad(async () => (endless ? [] : attendanceRange(range.from, range.to)), [endless, range.from, range.to]);
  const named = useLoad(async () => (endless ? null : calendarMarks(range.from, range.to)), [endless, range.from, range.to]);
  const [refresh, setRefresh] = useState(0);
  const reload = async () => { setRefresh((n) => n + 1); await rows.reload(); };
  const marks = useMemo(() => marksByDate(named.data?.holidays, named.data?.marks), [named.data]);
  const everyone = useLoad(async () => (endless ? [] : attendanceRange(today, today)), [endless, today]);
  const people = useMemo(() => withEveryone(groupRange(rows.data), groupRange(everyone.data)), [rows.data, everyone.data]);
  const person = people.find((p) => p.employee_id === personId) || people.find((p) => p.employee_id === employeeId) || people[0];
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const canEdit = (p, d) => canEditDay({ role, myId: employeeId, employeeId: p.employee_id, date: d, today, employeeStatus: p.employee_status, exitDate: p.exit_date, status: p.days[d]?.status, isAdmin });
  const onEdit = (p, d) => { setNotice(null); setEditing({ person: p, date: d }); };
  const needsPerson = viewKey === "calendar" || viewKey === "year";
  // HR has the full Biometric sync panel below. Everyone else gets the recent sync from here.
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(null);
  const syncNow = async () => {
    setSyncing(true); setSyncError(null); setNotice(null);
    try { const r = await biometricSync(); await reload(); setNotice(staffSyncNote(r)); } catch (e) { setSyncError(e.message); }
    setSyncing(false);
  };

  return (
    <div>
      <PageHead title="Attendance Sheet" sub={role === "hr" ? "Everyone. Click a day to change it." : role === "manager" ? "You and your direct reports. Click a day to request a change." : "Your attendance. Click a day to use Annual leave, work from home or correct the times."}>
        {role !== "hr" && <Button busy={syncing} onClick={syncNow}>Sync now</Button>}
        <span className="hr-month-nav">
          <Button onClick={() => setDate(shiftPeriod(view.period, date, -1))} aria-label="Previous">‹</Button>
          <strong>{periodTitle(view.period, date)}</strong>
          <Button onClick={() => setDate(shiftPeriod(view.period, date, 1))} aria-label="Next">›</Button>
        </span>
      </PageHead>
      <ErrorNote message={rows.error || syncError} />
      {notice &&<div className="hr-warning" role="status">{notice}</div>}
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
          <span><i className="hr-legend-mark hr-legend-mark-uae" />UAE public holiday</span>
          <span><i className="hr-legend-mark hr-legend-mark-india" />India festival</span>
        </div>
        {viewKey === "daily" && marks[date] && <p className="bk-note hr-quiet">{markText(marks[date])}</p>}
        {endless ? <EndlessGrid date={date} onMonth={(key) => setDate(`${key}-01`)} refresh={refresh} today={today} canEdit={canEdit} onEdit={onEdit} />
          : rows.loading && !rows.data ? <Spinner label="Loading attendance" /> : !people.length ? (
          <p className="bk-note hr-quiet">No employees to show for this period.</p>
        ) : viewKey === "calendar" ? <CalendarView person={person} days={monthDays(year, month)} today={today} canEdit={canEdit} onEdit={onEdit} marks={marks} />
          : viewKey === "week" ? <WeekView days={weekDays(date)} people={people} today={today} canEdit={canEdit} onEdit={onEdit} marks={marks} />
          : viewKey === "year" ? <YearHeatmap person={person} year={year} today={today} canEdit={canEdit} onEdit={onEdit} marks={marks} />
          : <DailyList date={date} people={people} canEdit={canEdit} onEdit={onEdit} />}
      </Panel>
      <AttendanceHistory role={role} refresh={refresh} />
      {role === "hr" && <BiometricPanel onChanged={reload} />}
      {editing && (
        <EditDayModal person={editing.person} date={editing.date} own={!isAdmin && editing.person.employee_id === employeeId} direct={isAdmin || (role === "hr" && editing.person.employee_id !== employeeId)} onClose={() => setEditing(null)}
          onSaved={async (message) => { setNotice(message); await reload(); }} />
      )}
    </div>
  );
}
