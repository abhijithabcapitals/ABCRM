import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ErrorNote, Spinner } from "@banking/components/shared";
import DayCell from "./DayCell";
import { attendanceRange, calendarMarks } from "../../services/hrApi";
import { addMonth, extendMonths, groupRange, markClasses, markText, marksByDate, monthDays, monthKey, monthsAround, periodRange, visibleDayIndex } from "../../logic/attendance";

const WEEKDAY = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dow = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
const daysOf = (key) => monthDays(Number(key.slice(0, 4)), Number(key.slice(5, 7)));
const monthName = (key) => `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

const COL = 34; // day column width
const NAME = 170;
const TOTAL = 36;
const FROZEN = NAME + 4 * TOTAL; // the name and the four totals stay put
const NEAR_EDGE = COL * 10;

// People by day with no end in either direction: a month loads as the scroll nears an edge. The totals count the month in the title,
// which follows the scroll. date comes from the Attendance screen, so its arrows jump here, and onMonth tells it where the scroll is.
export default function EndlessGrid({ date, onMonth, refresh, today, canEdit, onEdit }) {
  const wrap = useRef(null);
  const shown = monthKey(date);
  const reported = useRef(shown); // the month this grid last told the screen about
  const echoes = useRef(new Set()); // months told to the screen and not yet back: a fast scroll can have several on the way
  const shiftDays = useRef(0); // days just added on the left, to hold the view still
  const asked = useRef(new Set());
  const [months, setMonths] = useState(() => monthsAround(shown));
  const [jump, setJump] = useState({ key: shown });
  const [loaded, setLoaded] = useState({});
  const [error, setError] = useState(null);

  const loadMonth = useCallback(async (key) => {
    const { from, to } = periodRange("month", `${key}-01`);
    try {
      const [rows, named] = await Promise.all([attendanceRange(from, to), calendarMarks(from, to)]);
      setLoaded((l) => ({ ...l, [key]: { rows, named } }));
    } catch (e) {
      asked.current.delete(key); // the next scroll tries again
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    for (const key of months) {
      if (!asked.current.has(key)) { asked.current.add(key); loadMonth(key); }
    }
  }, [months, loadMonth]);

  // A saved day or a sync can change any month on screen.
  const firstRefresh = useRef(refresh);
  useEffect(() => {
    if (firstRefresh.current === refresh) return;
    firstRefresh.current = refresh;
    asked.current.forEach(loadMonth);
  }, [refresh, loadMonth]);

  // The screen's arrows chose another month.
  useEffect(() => {
    if (echoes.current.delete(shown) || shown === reported.current) return;
    reported.current = shown;
    setMonths((m) => extendMonths(m, shown));
    setJump({ key: shown });
  }, [shown]);

  const days = useMemo(() => months.flatMap(daysOf), [months]);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (shiftDays.current) { el.scrollLeft += shiftDays.current * COL; shiftDays.current = 0; }
    if (!jump) return;
    // Starts at the 1st. In the current month on a narrow screen, today might not fit, so it starts near today.
    const first = days.indexOf(`${jump.key}-01`);
    const day = monthKey(today) === jump.key ? Number(today.slice(8)) : 1;
    const fits = day * COL < el.clientWidth - FROZEN;
    el.scrollLeft = (first + (fits ? 0 : day - 4)) * COL;
    setJump(null);
  }, [months, jump, days, today]);

  const onScroll = () => {
    const el = wrap.current;
    if (!shiftDays.current && el.scrollLeft < NEAR_EDGE) {
      const earlier = addMonth(months[0], -1);
      shiftDays.current = daysOf(earlier).length;
      setMonths((m) => [earlier, ...m]);
    } else if (el.scrollLeft + el.clientWidth > el.scrollWidth - NEAR_EDGE) {
      setMonths((m) => [...m, addMonth(m.at(-1), 1)]);
    }
    const key = monthKey(days[visibleDayIndex({ scrollLeft: el.scrollLeft, clientWidth: el.clientWidth, frozen: FROZEN, col: COL, days: days.length })]);
    if (key !== reported.current) { reported.current = key; echoes.current.add(key); onMonth(key); }
  };

  const people = useMemo(() => groupRange(Object.values(loaded).flatMap((m) => m.rows)), [loaded]);
  const totals = useMemo(() => Object.fromEntries(groupRange(loaded[shown]?.rows).map((p) => [p.employee_id, p.counts])), [loaded, shown]);
  const marks = useMemo(() => {
    const all = Object.values(loaded);
    return marksByDate(all.flatMap((m) => m.named.holidays), all.flatMap((m) => m.named.marks));
  }, [loaded]);
  const ready = months.some((key) => loaded[key]);

  return (
    <>
      <ErrorNote message={error} onClose={() => setError(null)} />
      {!ready && !error && <Spinner label="Loading attendance" />}
      <div className="hr-grid-wrap" ref={wrap} onScroll={onScroll} tabIndex={0} aria-label="Attendance by day. Scroll sideways for earlier or later months.">
        <table data-plain="true" className="hr-grid hr-grid-month hr-grid-endless" style={{ width: FROZEN + days.length * COL }}>
          <colgroup>
            <col style={{ width: NAME }} />
            {[1, 2, 3, 4].map((n) => <col key={n} style={{ width: TOTAL }} />)}
            {days.map((d) => <col key={d} style={{ width: COL }} />)}
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2} className="hr-grid-name">Employee</th>
              <th rowSpan={2} className="hr-grid-total hr-grid-total-1" title={`Present in ${monthName(shown)}`}>P</th>
              <th rowSpan={2} className="hr-grid-total hr-grid-total-2" title={`Absent in ${monthName(shown)}`}>A</th>
              <th rowSpan={2} className="hr-grid-total hr-grid-total-3" title={`Late in ${monthName(shown)}`}>Late</th>
              <th rowSpan={2} className="hr-grid-total hr-grid-total-4" title={`Overtime in ${monthName(shown)}`}>OT</th>
              {months.map((key) => <th key={key} colSpan={daysOf(key).length} className="hr-grid-month-head"><span className="hr-grid-month-label">{monthName(key)}</span></th>)}
            </tr>
            <tr>
              {days.map((d) => <th key={d} className={markClasses(marks[d]) ? "hr-grid-day-marked" : ""} title={markText(marks[d]) || undefined}>{Number(d.slice(8))}<small>{WEEKDAY[dow(d)]}</small></th>)}
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const c = totals[p.employee_id] || {};
              return (
                <tr key={p.employee_id}>
                  <th scope="row" className="hr-grid-name" title={`${p.employee_code} · ${p.full_name}`}>{p.employee_code} · {p.full_name}</th>
                  <td className="hr-grid-total hr-grid-total-1">{c.Present ?? 0}</td>
                  <td className="hr-grid-total hr-grid-total-2">{c.Absent ?? 0}</td>
                  <td className="hr-grid-total hr-grid-total-3">{c.Late ?? 0}</td>
                  <td className="hr-grid-total hr-grid-total-4">{c.Overtime ?? 0}</td>
                  {days.map((d) => <td key={d}><DayCell person={p} date={d} today={today} canEdit={canEdit} onEdit={onEdit} marks={marks} /></td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
