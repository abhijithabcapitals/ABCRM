import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_TZ, addDays, addMonths, dayHeading, groupByDay, monthGrid, monthLabel, monthOf, rangeFor,
  timeIn, todayKey, weekdayLabels,
} from "../logic/dates";
import EventEditor from "./EventEditor";

// Compact, Teams-style calendar: a small month view with an agenda below it.
// Data-agnostic: pass plain events and fetch what onRangeChange asks for.
//
// events: [{ id, title, start, end?, allDay?, kind?, subtitle?, notes?, color? }]  (start/end ISO strings)
// kinds:  { [kind]: { label, color, hasEnd?, timeOptional? } } for dots, the legend and the editor
// onSave(draft, original|null) and onDelete(event) make events editable; both may return promises
// and throw to show an error. draft = { kind, title, notes, start, end }.
export default function CalendarPanel({
  events = [],
  kinds = {},
  timezone = DEFAULT_TZ,
  weekStart = 1,
  upcomingDays = 14,
  maxUpcoming = 25,
  title = "Calendar",
  loading = false,
  error = "",
  emptyText = "No upcoming events.",
  onRangeChange,
  onEventClick,
  onSave,
  onDelete,
}) {
  const today = todayKey(timezone);
  const [month, setMonth] = useState(() => monthOf(today));
  const [selected, setSelected] = useState(null); // day key, or null for "upcoming"
  const [editing, setEditing] = useState(null); // { event } for edit, { event: null } for new
  const editable = Boolean(onSave);
  const openEvent = editable ? (e) => setEditing({ event: e }) : onEventClick;

  const grid = useMemo(() => monthGrid(month, weekStart), [month, weekStart]);
  const byDay = useMemo(() => groupByDay(events, timezone), [events, timezone]);

  // Ask the host for everything the month grid and the upcoming list can show.
  useEffect(() => {
    if (!onRangeChange) return;
    const first = grid[0].key < today ? grid[0].key : today;
    const lastUpcoming = addDays(today, upcomingDays);
    const last = grid[41].key > lastUpcoming ? grid[41].key : lastUpcoming;
    onRangeChange(rangeFor(first, last));
    // onRangeChange is usually an inline function; the range only changes with these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, today, upcomingDays]);

  const colorOf = (e) => e.color || kinds[e.kind]?.color || "#0d7d82";

  const agenda = useMemo(() => {
    if (selected) return [[selected, byDay[selected] || []]];
    const nowIso = new Date().toISOString();
    const end = addDays(today, upcomingDays);
    const days = Object.keys(byDay).filter((k) => k >= today && k <= end).sort();
    const out = [];
    let count = 0;
    for (const k of days) {
      const list = byDay[k].filter((e) => k > today || e.allDay || (e.end || e.start) >= nowIso);
      if (!list.length) continue;
      const room = maxUpcoming - count;
      if (room <= 0) break;
      out.push([k, list.slice(0, room)]);
      count += Math.min(list.length, room);
    }
    return out;
  }, [selected, byDay, today, upcomingDays, maxUpcoming]);

  function pick(key) {
    setSelected((cur) => (cur === key ? null : key));
  }

  function goToday() {
    setMonth(monthOf(today));
    setSelected(null);
  }

  return (
    <section className="cal-panel" aria-label={title}>
      <CalendarStyles />
      <div className="cal-mini">
        <div className="cal-mini-head">
          <button type="button" className="cal-month" onClick={goToday} title="Go to today">{monthLabel(month)}</button>
          <div className="cal-nav">
            <button type="button" onClick={() => setMonth((m) => addMonths(m, -1))} aria-label="Previous month">‹</button>
            <button type="button" onClick={() => setMonth((m) => addMonths(m, 1))} aria-label="Next month">›</button>
          </div>
        </div>
        <div className="cal-grid" role="grid" aria-label={monthLabel(month)}>
          {weekdayLabels(weekStart).map((w) => <span key={w} className="cal-dow" role="columnheader">{w}</span>)}
          {grid.map((c) => {
            const dayEvents = byDay[c.key] || [];
            const cls = ["cal-day", c.inMonth ? "" : "cal-out", c.key === today ? "cal-today" : "", c.key === selected ? "cal-sel" : ""]
              .filter(Boolean).join(" ");
            return (
              <button key={c.key} type="button" role="gridcell" className={cls} onClick={() => pick(c.key)}
                aria-pressed={c.key === selected}
                aria-label={`${c.key}${dayEvents.length ? `, ${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}` : ""}`}>
                <span className="cal-num">{c.day}</span>
                <span className="cal-dots" aria-hidden="true">
                  {dayEvents.slice(0, 3).map((e) => <i key={e.id} style={{ background: colorOf(e) }} />)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="cal-agenda">
        <div className="cal-agenda-head">
          <strong>{selected ? dayHeading(selected, timezone) : "Upcoming"}</strong>
          <span className="cal-agenda-tools">
            {selected && <button type="button" className="cal-link" onClick={() => setSelected(null)}>Show upcoming</button>}
            {editable && <button type="button" className="cal-new" onClick={() => setEditing({ event: null })}>+ New</button>}
          </span>
        </div>
        {error && <p className="cal-error" role="alert">{error}</p>}
        {loading && !events.length && <p className="cal-empty">Loading…</p>}
        {!loading && !error && agenda.every(([, list]) => !list.length) && (
          <p className="cal-empty">{selected ? "Nothing on this day." : emptyText}</p>
        )}
        {agenda.map(([key, list]) => list.length > 0 && (
          <div key={key} className="cal-agenda-day">
            {!selected && <div className="cal-agenda-date">{dayHeading(key, timezone)}</div>}
            {list.map((e) => (
              <button key={e.id} type="button" className="cal-event" onClick={() => openEvent?.(e)} disabled={!openEvent}
                title={editable ? "Edit" : undefined}>
                <span className="cal-event-time">
                  {e.allDay ? "All day" : timeIn(timezone, e.start)}
                  {!e.allDay && e.end && <small>{timeIn(timezone, e.end)}</small>}
                </span>
                <span className="cal-event-dot" style={{ background: colorOf(e) }} aria-hidden="true" />
                <span className="cal-event-body">
                  <b>{e.title}</b>
                  {(e.subtitle || kinds[e.kind]?.label) && <small>{e.subtitle || kinds[e.kind]?.label}</small>}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>

      {Object.keys(kinds).length > 1 && (
        <div className="cal-legend">
          {Object.entries(kinds).map(([k, v]) => (
            <span key={k}><i style={{ background: v.color }} />{v.label}</span>
          ))}
        </div>
      )}

      {editing && (
        <EventEditor
          event={editing.event}
          defaultDate={selected || today}
          kinds={kinds}
          timezone={timezone}
          onSave={onSave}
          onDelete={onDelete}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function CalendarStyles() {
  return (
    <style>{`
      .cal-panel { background: #fff; border: 1px solid #e8e8e8; border-radius: 10px; padding: 14px; display: grid; gap: 14px; max-width: 380px; width: 100%; }
      .cal-mini-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
      .cal-month { background: none; border: none; font: inherit; font-size: 14px; font-weight: 600; color: #1f2a30; cursor: pointer; padding: 2px 4px; border-radius: 4px; }
      .cal-month:hover { background: #f3f4f6; }
      .cal-nav { display: flex; gap: 2px; }
      .cal-nav button { width: 28px; height: 28px; border: none; background: none; border-radius: 6px; font-size: 18px; line-height: 1; color: #4b5563; cursor: pointer; }
      .cal-nav button:hover { background: #f3f4f6; }
      .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); row-gap: 2px; }
      .cal-dow { font-size: 11px; color: #9ca3af; text-align: center; padding: 4px 0; }
      .cal-day { position: relative; height: 36px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
        background: none; border: none; border-radius: 6px; cursor: pointer; font: inherit; padding: 0; }
      .cal-day:hover { background: #f3f4f6; }
      .cal-num { width: 26px; height: 26px; line-height: 26px; border-radius: 50%; font-size: 12.5px; color: #1f2a30; text-align: center; }
      .cal-out .cal-num { color: #c4c8cd; }
      .cal-today .cal-num { background: var(--accent, #0d7d82); color: #fff; font-weight: 600; }
      .cal-sel .cal-num { box-shadow: 0 0 0 2px var(--accent, #0d7d82); font-weight: 600; }
      .cal-today.cal-sel .cal-num { box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--accent, #0d7d82); }
      .cal-dots { display: flex; gap: 2px; height: 4px; position: absolute; bottom: 1px; }
      .cal-dots i { width: 4px; height: 4px; border-radius: 50%; }
      .cal-agenda { border-top: 1px solid #f0f0f0; padding-top: 10px; display: grid; gap: 8px; max-height: 420px; overflow-y: auto; }
      .cal-agenda-head { display: flex; justify-content: space-between; align-items: baseline; }
      .cal-agenda-head strong { font-size: 13px; color: #1f2a30; }
      .cal-link { background: none; border: none; color: var(--accent, #0d7d82); font-size: 12px; cursor: pointer; padding: 0; }
      .cal-agenda-day { display: grid; gap: 2px; }
      .cal-agenda-date { font-size: 11.5px; font-weight: 600; color: #6b7280; padding: 4px 0 2px; }
      .cal-event { display: grid; grid-template-columns: 44px 8px 1fr; gap: 8px; align-items: start; text-align: left; background: none; border: none;
        border-radius: 6px; padding: 6px 4px; font: inherit; color: inherit; width: 100%; }
      .cal-event:not(:disabled) { cursor: pointer; }
      .cal-event:not(:disabled):hover { background: #f7f7f6; }
      .cal-event-time { font-size: 12px; color: #374151; display: grid; }
      .cal-event-time small { font-size: 11px; color: #9ca3af; }
      .cal-event-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 4px; }
      .cal-event-body { display: grid; min-width: 0; }
      .cal-event-body b { font-size: 13px; font-weight: 500; color: #1f2a30; overflow-wrap: anywhere; }
      .cal-event-body small { font-size: 11.5px; color: #9ca3af; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cal-empty { font-size: 12.5px; color: #9ca3af; margin: 4px 0; }
      .cal-error { font-size: 12.5px; color: #b91c1c; background: #fee2e2; border-radius: 6px; padding: 8px 10px; margin: 0; }
      .cal-agenda-tools { display: flex; gap: 12px; align-items: baseline; }
      .cal-new { background: none; border: 1px solid #d1d5db; border-radius: 6px; padding: 2px 9px; font-size: 12px; color: #1f2a30; cursor: pointer; }
      .cal-new:hover { background: #f3f4f6; }
      .cal-modal-backdrop { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.35); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 16px; }
      .cal-modal { background: #fff; border-radius: 12px; width: min(440px, 100%); padding: 18px; display: grid; gap: 12px; box-shadow: 0 20px 50px rgba(15, 23, 42, 0.25); }
      .cal-modal-head { display: flex; justify-content: space-between; align-items: center; }
      .cal-modal-head strong { font-size: 15px; color: #1f2a30; }
      .cal-x { background: none; border: none; font-size: 22px; line-height: 1; color: #6b7280; cursor: pointer; }
      .cal-kinds { display: flex; gap: 6px; flex-wrap: wrap; }
      .cal-kinds button { display: inline-flex; align-items: center; gap: 6px; border: 1px solid #e5e7eb; background: #fff; border-radius: 16px; padding: 4px 11px; font-size: 12.5px; cursor: pointer; color: #374151; }
      .cal-kinds button.on { border-color: var(--accent, #0d7d82); background: #eef7f7; color: #0f5e5a; font-weight: 600; }
      .cal-kinds i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
      .cal-field { display: grid; gap: 4px; font-size: 12px; font-weight: 600; color: #374151; flex: 1; min-width: 0; }
      .cal-field input, .cal-field textarea { font: inherit; font-size: 13.5px; font-weight: 400; padding: 7px 9px; border: 1px solid #d1d5db; border-radius: 6px; min-width: 0; }
      .cal-field textarea { resize: vertical; }
      .cal-row { display: flex; gap: 10px; flex-wrap: wrap; }
      .cal-modal-actions { display: flex; gap: 8px; align-items: center; }
      .cal-danger { background: none; border: none; color: #b91c1c; font-size: 13px; cursor: pointer; padding: 0; }
      .cal-legend { display: flex; gap: 12px; flex-wrap: wrap; font-size: 11px; color: #6b7280; }
      .cal-legend i { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
    `}</style>
  );
}
