import { useState } from "react";
import { Modal } from "@banking/components/shared";
import { dubaiToday, leaveCard, todayLabel } from "../../logic/attendance";

const BEFORE_LEAVE = [
  { key: "present", label: "Present" },
  { key: "absent", label: "Absent" },
];
const AFTER_LEAVE = [
  { key: "late", label: "Late", note: "After 09:30" },
  { key: "overtime", label: "Overtime", note: "After the day's end" },
  { key: "wfh", label: "Work From Home" },
];

// A card lists its people when clicked. Over a week or longer the number is person-days. Today stays today when another period is chosen.
export default function PeriodCards({ data, longPeriod }) {
  const [open, setOpen] = useState(null);
  const leave = leaveCard(data);
  const card = (c) => ({ ...c, count: data.counts?.[c.key] ?? 0, people: data.people?.[c.key] || [], note: longPeriod ? "Person-days" : c.note || "Today's people" });
  const cards = [
    ...BEFORE_LEAVE.map(card),
    { key: "leave", label: "On Leave", count: leave.count, people: leave.people, note: `Annual ${leave.annual} · Unpaid ${leave.unpaid}` },
    ...AFTER_LEAVE.map(card),
  ];
  return (
    <>
      <div className="bk-cards hr-period-cards">
        <div className="bk-card bk-card-static hr-card-today"><span>Today</span><strong>{todayLabel(dubaiToday())}</strong><small className="hr-card-note">Asia/Dubai</small></div>
        {cards.map((c) => (
          <button type="button" key={c.key} className={`bk-card hr-card-${c.key}`} onClick={() => setOpen(c)}>
            <span>{c.label}</span>
            <strong>{c.count}</strong>
            <small className="hr-card-note">{c.note}</small>
          </button>
        ))}
        <div className="bk-card bk-card-static"><span>Active</span><strong>{data.active}</strong><small className="hr-card-note">Employees</small></div>
      </div>
      {open && (
        <Modal title={open.label} onClose={() => setOpen(null)}>
          {!open.people.length ? <p className="bk-note hr-quiet">No one in this period.</p> : (
            <ul className="hr-people-list">
              {open.people.map((p) => <li key={`${p.employee_id}-${p.kind || ""}`}><span>{p.full_name}{p.kind ? ` (${p.kind})` : ""}</span><strong>{p.days} day{p.days === 1 ? "" : "s"}</strong></li>)}
            </ul>
          )}
        </Modal>
      )}
    </>
  );
}
