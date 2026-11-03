import { useState } from "react";
import { ErrorNote, Modal, fmtDate } from "@banking/components/shared";
import { attendanceRange } from "../../services/hrApi";
import { CARD_TIME, cardTimes, dubaiToday, leaveCard, todayLabel } from "../../logic/attendance";

const BEFORE_LEAVE = [
  { key: "present", label: "Present" },
  { key: "absent", label: "Absent" },
];
const AFTER_LEAVE = [
  { key: "late", label: "Late", note: "After 09:30, under 9 hours" },
  { key: "overtime", label: "Overtime", note: "After the day's end" },
  { key: "wfh", label: "Work From Home" },
];

// One person in an opened card. Present, Late and Overtime show the punch time: one day beside the name, a longer period day by day.
function PersonRow({ person, timeLabel, times, longPeriod }) {
  const dayCount = `${person.days} day${person.days === 1 ? "" : "s"}`;
  const name = `${person.full_name}${person.kind ? ` (${person.kind})` : ""}`;
  if (!timeLabel || !times) return <li><span>{name}</span><strong>{dayCount}</strong></li>;
  const list = times[person.employee_id] || [];
  if (!longPeriod) return <li><span>{name}</span><strong>{timeLabel} {list[0]?.time || "–"}</strong></li>;
  return (
    <li>
      <span>{name}<small className="hr-people-times">{list.map((d) => `${fmtDate(d.date)} ${d.time || "–"}`).join(" · ")}</small></span>
      <strong>{dayCount}</strong>
    </li>
  );
}

// A card lists its people when clicked. Over a week or longer the number is person-days. Today stays today when another period is chosen.
export default function PeriodCards({ data, longPeriod }) {
  const [open, setOpen] = useState(null);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const leave = leaveCard(data);
  const card = (c) => ({ ...c, count: data.counts?.[c.key] ?? 0, people: data.people?.[c.key] || [], note: longPeriod ? "Person-days" : c.note || "Today's people" });
  const cards = [
    ...BEFORE_LEAVE.map(card),
    { key: "leave", label: "On Leave", count: leave.count, people: leave.people, note: `Annual ${leave.annual} · Unpaid ${leave.unpaid}` },
    ...AFTER_LEAVE.map(card),
  ];
  const openCard = async (c) => {
    setOpen(c);
    setRows(null);
    setError(null);
    if (!CARD_TIME[c.key] || !c.people.length) return;
    try { setRows(await attendanceRange(data.from, data.to)); } catch (e) { setError(e.message); }
  };
  const timeCard = open && CARD_TIME[open.key];
  const times = timeCard && rows ? cardTimes(rows, open.key) : null;
  return (
    <>
      <div className="bk-cards hr-period-cards">
        <div className="bk-card bk-card-static hr-card-today"><span>Today</span><strong>{todayLabel(dubaiToday())}</strong><small className="hr-card-note">Asia/Dubai</small></div>
        {cards.map((c) => (
          <button type="button" key={c.key} className={`bk-card hr-card-${c.key}`} onClick={() => openCard(c)}>
            <span>{c.label}</span>
            <strong>{c.count}</strong>
            <small className="hr-card-note">{c.note}</small>
          </button>
        ))}
        <div className="bk-card bk-card-static"><span>Active</span><strong>{data.active}</strong><small className="hr-card-note">Employees</small></div>
      </div>
      {open && (
        <Modal title={open.label} onClose={() => setOpen(null)}>
          <ErrorNote message={error} />
          {!open.people.length ? <p className="bk-note hr-quiet">No one in this period.</p> : (
            <ul className="hr-people-list">
              {open.people.map((p) => <PersonRow key={`${p.employee_id}-${p.kind || ""}`} person={p} timeLabel={timeCard?.label} times={times} longPeriod={longPeriod} />)}
            </ul>
          )}
        </Modal>
      )}
    </>
  );
}
