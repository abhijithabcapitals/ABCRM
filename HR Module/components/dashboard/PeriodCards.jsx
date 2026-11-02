import { useState } from "react";
import { Modal } from "@banking/components/shared";

const CARDS = [
  { key: "present", label: "Present" },
  { key: "absent", label: "Absent" },
  { key: "late", label: "Late", note: "After 09:30" },
  { key: "overtime", label: "Overtime", note: "After the day's end" },
  { key: "wfh", label: "Work From Home" },
  { key: "leave_annual", label: "On Leave: Annual", note: "Within credit" },
  { key: "leave_unpaid", label: "On Leave: Unpaid" },
];

// A card lists its people when clicked. Over a week or longer the number is person-days.
export default function PeriodCards({ data, longPeriod }) {
  const [open, setOpen] = useState(null);
  const people = open ? data.people?.[open.key] || [] : [];
  return (
    <>
      <div className="bk-cards hr-period-cards">
        <div className="bk-card bk-card-static"><span>Active</span><strong>{data.active}</strong><small className="hr-card-note">Employees</small></div>
        {CARDS.map((c) => (
          <button type="button" key={c.key} className={`bk-card hr-card-${c.key}`} onClick={() => setOpen(c)}>
            <span>{c.label}</span>
            <strong>{data.counts?.[c.key] ?? 0}</strong>
            <small className="hr-card-note">{longPeriod ? "Person-days" : c.note || "Today's people"}</small>
          </button>
        ))}
      </div>
      {open && (
        <Modal title={open.label} onClose={() => setOpen(null)}>
          {!people.length ? <p className="bk-note hr-quiet">No one in this period.</p> : (
            <ul className="hr-people-list">
              {people.map((p) => <li key={p.employee_id}><span>{p.full_name}</span><strong>{p.days} day{p.days === 1 ? "" : "s"}</strong></li>)}
            </ul>
          )}
        </Modal>
      )}
    </>
  );
}
