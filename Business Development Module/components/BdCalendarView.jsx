import { useCallback, useEffect, useMemo, useState } from "react";
import CalendarPanel, { isoToZoned, todayKey, zonedToIso } from "@calendar";
import {
  deleteBdCalendarItem, fetchBdCalendarItems, fetchOverdueBdCalendarItems, saveBdCalendarItem,
} from "../logic/businessDevelopmentData";

// Lead Calendar page: a month view with an agenda of the leads' follow-ups (open the
// lead) and BD calendar items — deadlines, meetings, tasks, conversion targets and
// reminders — that can be linked to a lead and assigned to a person.

const TZ = "Asia/Dubai";
const ITEM_KINDS = {
  deadline: { label: "Deadline", color: "#dc2626" },
  meeting: { label: "Meeting", color: "#2563eb" },
  task: { label: "Task", color: "#d97706" },
  milestone: { label: "Conversion target", color: "#059669" },
  reminder: { label: "Reminder", color: "#7c3aed" },
};
const KINDS = { followup: { label: "Follow-up", color: "#0d7d82" }, ...ITEM_KINDS };
const DONE_COLOR = "#9ca3af";

const personName = (profiles, id) => {
  const p = profiles.find((person) => person.id === id);
  return p ? p.full_name || p.email : "";
};

export default function BdCalendarView({ leads, profiles, currentUserId, followups, onOpenLead, onCompleteFollowup }) {
  const [range, setRange] = useState(null);
  const [items, setItems] = useState([]);
  const [overdue, setOverdue] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [editing, setEditing] = useState(null); // { item } to edit, { item: null } for new

  const leadById = useMemo(() => new Map(leads.map((lead) => [lead.id, lead])), [leads]);

  const load = useCallback(async () => {
    if (!range) return;
    setLoading(true);
    const [inRange, late] = await Promise.all([fetchBdCalendarItems(range.from, range.to), fetchOverdueBdCalendarItems()]);
    setLoading(false);
    const failed = inRange.error || late.error;
    if (failed) { setError(failed.message); return; }
    setError("");
    setItems(inRange.data || []);
    setOverdue(late.data || []);
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const mine = useCallback((item) => !mineOnly || item.assigned_to === currentUserId || item.created_by === currentUserId, [mineOnly, currentUserId]);

  const events = useMemo(() => {
    const followupEvents = followups
      .filter((f) => !mineOnly || f.lead.current_owner === currentUserId)
      .map((f) => ({
        id: `f-${f.id}`, kind: "followup", title: f.lead.name || "Lead follow-up", start: f.planned_at,
        subtitle: `Follow-up${f.channel ? ` · ${f.channel}` : ""}${f.objective ? ` · ${f.objective}` : ""}`, followup: f,
      }));
    const itemEvents = items.filter(mine).map((item) => {
      const lead = item.lead_id ? leadById.get(item.lead_id) : null;
      const assignee = personName(profiles, item.assigned_to);
      const parts = [ITEM_KINDS[item.kind]?.label, lead?.name, assignee && `for ${assignee}`, item.status === "done" && "Done"].filter(Boolean);
      return {
        id: `i-${item.id}`, kind: item.kind, title: item.title, start: item.starts_at, end: item.ends_at,
        allDay: item.all_day, subtitle: parts.join(" · "), color: item.status === "done" ? DONE_COLOR : undefined, item,
      };
    });
    return [...followupEvents, ...itemEvents];
  }, [followups, items, mine, mineOnly, currentUserId, leadById, profiles]);

  const overdueItems = overdue.filter(mine);
  const overdueFollowups = followups.filter((f) => new Date(f.planned_at) < new Date() && (!mineOnly || f.lead.current_owner === currentUserId));

  function open(event) {
    if (event.followup) onOpenLead(event.followup.lead);
    else setEditing({ item: event.item });
  }

  async function markDone(item) {
    const { error: saveError } = await saveBdCalendarItem({ status: "done" }, item.id);
    if (saveError) { setError(saveError.message); return; }
    await load();
  }

  async function save(values, item) {
    const { data, error: saveError } = await saveBdCalendarItem(values, item?.id || null);
    if (saveError) throw new Error(saveError.message);
    await load();
    return data;
  }

  async function remove(item) {
    const { error: deleteError } = await deleteBdCalendarItem(item.id);
    if (deleteError) throw new Error(deleteError.message);
    await load();
  }

  return (
    <section className="bd-cal-page">
      <div className="bd-section-heading">
        <div><h2>Lead Calendar</h2><p>Deadlines, meetings, tasks and conversion targets for business development, with every lead follow-up. UAE time.</p></div>
        <div className="bd-cal-tools">
          <label className="bd-cal-check"><input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> Only mine</label>
          <button type="button" className="bd-button bd-button-primary" onClick={() => setEditing({ item: null })}>＋ New calendar item</button>
        </div>
      </div>

      <div className="bd-cal-layout">
        <CalendarPanel
          title="Lead Calendar"
          events={events}
          kinds={KINDS}
          timezone={TZ}
          upcomingDays={30}
          maxUpcoming={60}
          loading={loading}
          error={error ? `Could not load the calendar: ${error}` : ""}
          emptyText="Nothing in the next 30 days. Add a deadline or schedule a follow-up."
          onRangeChange={setRange}
          onEventClick={open}
        />

        <aside className="bd-cal-side" aria-label="Overdue">
          <h3>Overdue</h3>
          {!overdueItems.length && !overdueFollowups.length && <p className="bd-cal-muted">Nothing overdue.</p>}
          {overdueItems.map((item) => {
            const lead = item.lead_id ? leadById.get(item.lead_id) : null;
            return (
              <article key={item.id} className="bd-cal-late">
                <i style={{ background: ITEM_KINDS[item.kind]?.color }} aria-hidden="true" />
                <button type="button" className="bd-cal-late-main" onClick={() => setEditing({ item })}>
                  <b>{item.title}</b>
                  <small>{ITEM_KINDS[item.kind]?.label} · due {formatWhen(item)}{lead ? ` · ${lead.name}` : ""}</small>
                </button>
                <button type="button" className="bd-text-button" onClick={() => markDone(item)}>Done</button>
              </article>
            );
          })}
          {overdueFollowups.map((f) => (
            <article key={f.id} className="bd-cal-late">
              <i style={{ background: KINDS.followup.color }} aria-hidden="true" />
              <button type="button" className="bd-cal-late-main" onClick={() => onOpenLead(f.lead)}>
                <b>{f.lead.name}</b>
                <small>Follow-up · due {formatWhen({ starts_at: f.planned_at })}{f.objective ? ` · ${f.objective}` : ""}</small>
              </button>
              <button type="button" className="bd-text-button" onClick={() => onCompleteFollowup(f)}>Complete</button>
            </article>
          ))}
        </aside>
      </div>

      {editing && (
        <CalendarItemEditor
          item={editing.item}
          leads={leads}
          profiles={profiles}
          currentUserId={currentUserId}
          onSave={save}
          onDelete={remove}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function formatWhen(item) {
  const z = isoToZoned(item.starts_at, TZ);
  const day = new Date(`${z.date}T12:00:00+04:00`).toLocaleDateString("en-AE", { timeZone: TZ, day: "numeric", month: "short" });
  return item.all_day ? day : `${day} ${z.time}`;
}

function CalendarItemEditor({ item, leads, profiles, currentUserId, onSave, onDelete, onClose }) {
  const start = item ? isoToZoned(item.starts_at, TZ) : null;
  const [form, setForm] = useState({
    kind: item?.kind || "deadline",
    title: item?.title || "",
    date: start?.date || todayKey(TZ),
    time: item && !item.all_day ? start.time : "",
    endTime: item?.ends_at ? isoToZoned(item.ends_at, TZ).time : "",
    lead_id: item?.lead_id || "",
    assigned_to: item ? item.assigned_to || "" : currentUserId || "",
    notes: item?.notes || "",
    status: item?.status || "open",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const sortedLeads = useMemo(() => [...leads].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))), [leads]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function submit(event) {
    event.preventDefault();
    if (!form.title.trim()) { setError("Add a title."); return; }
    if (!form.date) { setError("Pick a date."); return; }
    if (form.endTime && (!form.time || form.endTime <= form.time)) { setError("End time must be after the start time."); return; }
    const allDay = !form.time;
    setBusy(true);
    setError("");
    try {
      await onSave({
        kind: form.kind,
        title: form.title.trim(),
        starts_at: zonedToIso(form.date, form.time || "00:00", TZ),
        ends_at: !allDay && form.endTime ? zonedToIso(form.date, form.endTime, TZ) : null,
        all_day: allDay,
        lead_id: form.lead_id || null,
        assigned_to: form.assigned_to || null,
        notes: form.notes.trim() || null,
        ...(item ? { status: form.status } : {}),
      }, item);
      onClose();
    } catch (saveError) {
      setError(saveError.message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${item.title}"?`)) return;
    setBusy(true);
    try {
      await onDelete(item);
      onClose();
    } catch (deleteError) {
      setError(deleteError.message);
      setBusy(false);
    }
  }

  return (
    <div className="bd-modal-scrim" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <form className="bd-modal bd-modal-compact" onSubmit={submit} aria-label={item ? "Edit calendar item" : "New calendar item"}>
        <div className="bd-modal-heading">
          <div><h2>{item ? "Edit calendar item" : "New calendar item"}</h2><p>Times are UAE time. Leave the time empty for an all-day item.</p></div>
          <button type="button" className="bd-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        {error && <div className="bd-inline-error">{error}</div>}
        <div className="bd-form-grid">
          <label>Type
            <select value={form.kind} onChange={(e) => set("kind", e.target.value)}>
              {Object.entries(ITEM_KINDS).map(([key, spec]) => <option key={key} value={key}>{spec.label}</option>)}
            </select>
          </label>
          <label>Title<input value={form.title} maxLength={200} onChange={(e) => set("title", e.target.value)} required autoFocus /></label>
          <label>Date<input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} required /></label>
          <label>Time (optional)<input type="time" value={form.time} onChange={(e) => set("time", e.target.value)} /></label>
          {form.kind === "meeting" && (
            <label>End time<input type="time" value={form.endTime} onChange={(e) => set("endTime", e.target.value)} /></label>
          )}
          <label>Lead (optional)
            <select value={form.lead_id} onChange={(e) => set("lead_id", e.target.value)}>
              <option value="">Not linked to a lead</option>
              {sortedLeads.map((lead) => <option key={lead.id} value={lead.id}>{lead.name}{lead.lead_id ? ` · ${lead.lead_id}` : ""}</option>)}
            </select>
          </label>
          <label>Assigned to
            <select value={form.assigned_to} onChange={(e) => set("assigned_to", e.target.value)}>
              <option value="">Unassigned</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
            </select>
          </label>
          {item && (
            <label>Status
              <select value={form.status} onChange={(e) => set("status", e.target.value)}>
                <option value="open">Open</option>
                <option value="done">Done</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
          )}
          <label className="bd-form-wide">Notes<textarea rows="3" maxLength={4000} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></label>
        </div>
        <div className="bd-modal-actions">
          {item && <button type="button" className="bd-button bd-button-secondary bd-cal-delete" onClick={remove} disabled={busy}>Delete</button>}
          <button type="button" className="bd-button bd-button-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="bd-button bd-button-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </div>
  );
}
