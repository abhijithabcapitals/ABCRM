import { useCallback, useState } from "react";
import { Note } from "./ui";
import { alertCalendar } from "../services/alertsApi";
import { alertsToEvents, PRIORITY_STYLES } from "../logic/alertLogic";

const KINDS = Object.fromEntries(Object.entries(PRIORITY_STYLES).map(([p, s]) => [p, { label: p, color: s.color }]));

// Due dates on a month view. CalendarPanel arrives as a prop, as this module imports only react.
export default function AlertCalendar({ supabase, CalendarPanel, onOpen, access }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async ({ from, to }) => {
    setLoading(true);
    setError("");
    try {
      setEvents(alertsToEvents(await alertCalendar(supabase, String(from).slice(0, 10), String(to).slice(0, 10))));
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [supabase]);

  if (!CalendarPanel) return null;
  return (
    <div>
      {access?.mode === "Preview" && !access?.is_admin && <Note>The Notification Centre is in preview, so no due dates show here yet.</Note>}
      {error && <Note tone="bad">{error}</Note>}
      <CalendarPanel events={events} kinds={KINDS} onRangeChange={load} onEventClick={(e) => onOpen(e.id)} loading={loading} title="Due dates" emptyText="Nothing due" />
    </div>
  );
}
