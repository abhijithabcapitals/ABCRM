# Calendar Module

A compact, Teams-style calendar for any CRM page: a small month view with an **Upcoming** agenda below it.
Click a day to list that day's events; click it again (or **Show upcoming**) to go back. Days are shown in the
given time zone (default `Asia/Dubai`), weeks start on Monday.

| Path | Purpose |
|---|---|
| `components/CalendarPanel.jsx` | The calendar + agenda component |
| `logic/dates.js` | Day keys, month grid, range and label helpers (time-zone aware) |
| `index.js` | `default` / `CalendarPanel` plus the date helpers |

## Use it

The Main Module maps `@calendar` to this folder (`Main Module/vite.config.js`). The component does no data
fetching: give it events and load whatever range it asks for.

```jsx
import CalendarPanel from "@calendar";

<CalendarPanel
  events={events}                       // [{ id, title, start, end?, allDay?, kind?, subtitle?, color? }]
  kinds={{ meeting: { label: "Meeting", color: "#0d7d82" } }}
  onRangeChange={({ from, to }) => load(from, to)}   // ISO strings; covers the month shown and the upcoming window
  onEventClick={(e) => open(e)}         // optional
  loading={loading}
  error={error}
/>
```

Other props: `timezone`, `weekStart` (0 Sunday, 1 Monday), `upcomingDays` (14), `maxUpcoming` (25), `title`,
`emptyText`.

Used by: CEO Agent tab (`CEO Agent Module`) for meetings, reminders and task due dates.
