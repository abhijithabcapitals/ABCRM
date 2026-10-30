import { useEffect, useMemo, useState } from "react";
import { addMonths, dayHeading, groupByDay, monthGrid, monthLabel, monthOf, rangeFor, timeIn, todayKey, weekdayLabels } from "@calendar";
import { fetchBdCalendarItems } from "../logic/businessDevelopmentData";

// Small month view at the top of the BD Agent panel: lead follow-ups plus BD calendar items.
// The full calendar (editing, overdue list) stays on the Lead Calendar page.
const TZ = "Asia/Dubai";
const COLORS = { followup: "#0d7d82", deadline: "#dc2626", meeting: "#2563eb", task: "#d97706", milestone: "#059669", reminder: "#7c3aed" };

export default function BdMiniCalendar({ followups, onOpenLead, onOpenCalendar }) {
  const today = todayKey(TZ);
  const [month, setMonth] = useState(() => monthOf(today));
  const [selected, setSelected] = useState(today);
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(true);
  const grid = useMemo(() => monthGrid(month), [month]);

  useEffect(() => {
    const { from, to } = rangeFor(grid[0].key, grid[grid.length - 1].key);
    let live = true;
    fetchBdCalendarItems(from, to).then(({ data }) => { if (live) setItems(data || []); });
    return () => { live = false; };
  }, [grid]);

  const byDay = useMemo(() => groupByDay([
    ...followups.map((f) => ({ id: `f-${f.id}`, kind: "followup", start: f.planned_at, title: f.lead.name || "Lead follow-up", followup: f })),
    ...items.filter((item) => item.status !== "done").map((item) => ({ id: `i-${item.id}`, kind: item.kind, start: item.starts_at, title: item.title, allDay: item.all_day })),
  ], TZ), [followups, items]);
  const dayEvents = byDay[selected] || [];

  return (
    <section className="bd-mini-cal" aria-label="Lead calendar">
      <div className="bd-mini-cal-head">
        <button type="button" className="bd-mini-cal-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "▾" : "▸"} {monthLabel(month)}
        </button>
        {open && (
          <span>
            <button type="button" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">‹</button>
            <button type="button" onClick={() => { setMonth(monthOf(today)); setSelected(today); }}>Today</button>
            <button type="button" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">›</button>
          </span>
        )}
      </div>
      {open && (
        <>
          <div className="bd-mini-cal-grid">
            {weekdayLabels().map((label) => <b key={label}>{label}</b>)}
            {grid.map(({ key, day, inMonth }) => {
              const kinds = [...new Set((byDay[key] || []).map((event) => event.kind))].slice(0, 3);
              return (
                <button
                  key={key}
                  type="button"
                  className={[inMonth ? "" : "out", key === today ? "today" : "", key === selected ? "selected" : ""].join(" ")}
                  onClick={() => setSelected(key)}
                  aria-label={`${key}${kinds.length ? `, ${(byDay[key] || []).length} items` : ""}`}
                >
                  {day}
                  <i>{kinds.map((kind) => <em key={kind} style={{ background: COLORS[kind] || "#64748b" }} />)}</i>
                </button>
              );
            })}
          </div>
          <div className="bd-mini-cal-day">
            <strong>{dayHeading(selected, TZ)}</strong>
            {dayEvents.length ? dayEvents.slice(0, 5).map((event) => (
              <button
                key={event.id}
                type="button"
                onClick={() => (event.followup ? onOpenLead(event.followup.lead) : onOpenCalendar())}
              >
                <em style={{ background: COLORS[event.kind] || "#64748b" }} />
                <span>{event.allDay ? "All day" : timeIn(TZ, event.start)}</span>
                <b>{event.title}</b>
              </button>
            )) : <small>Nothing scheduled.</small>}
            {dayEvents.length > 5 && <small>+{dayEvents.length - 5} more</small>}
            <button type="button" className="bd-text-button" onClick={onOpenCalendar}>Open Lead Calendar →</button>
          </div>
        </>
      )}
    </section>
  );
}
