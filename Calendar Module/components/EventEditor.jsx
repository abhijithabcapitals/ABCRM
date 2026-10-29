import { useEffect, useRef, useState } from "react";
import { isoToZoned, zonedToIso } from "../logic/dates";

// Modal form to create, edit or delete one calendar event.
// kinds[k] may set: hasEnd (shows an end time), timeOptional (time may be blank).
export default function EventEditor({ event, defaultDate, kinds, timezone, onSave, onDelete, onClose }) {
  const isNew = !event;
  const kindKeys = Object.keys(kinds);
  const start = event?.start ? isoToZoned(event.start, timezone) : null;
  const [kind, setKind] = useState(event?.kind || kindKeys[0] || "event");
  const [title, setTitle] = useState(event?.title || "");
  const [date, setDate] = useState(start?.date || defaultDate);
  const [time, setTime] = useState(start ? start.time : "09:00");
  const [endTime, setEndTime] = useState(event?.end ? isoToZoned(event.end, timezone).time : "");
  const [notes, setNotes] = useState(event?.notes || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const titleRef = useRef(null);
  const spec = kinds[kind] || {};

  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e) {
    e.preventDefault();
    if (!title.trim()) { setError("Add a title."); return; }
    if (!date) { setError("Pick a date."); return; }
    if (!time && !spec.timeOptional) { setError("Pick a time."); return; }
    if (spec.hasEnd && endTime && time && endTime <= time) { setError("End time must be after the start time."); return; }
    setBusy(true);
    setError("");
    try {
      await onSave({
        kind,
        title: title.trim(),
        notes: notes.trim() || null,
        start: zonedToIso(date, time || "09:00", timezone),
        end: spec.hasEnd && endTime ? zonedToIso(date, endTime, timezone) : null,
      }, event || null);
      onClose();
    } catch (err) {
      setError(err?.message || String(err));
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${event.title}"?`)) return;
    setBusy(true);
    setError("");
    try {
      await onDelete(event);
      onClose();
    } catch (err) {
      setError(err?.message || String(err));
      setBusy(false);
    }
  }

  return (
    <div className="cal-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="cal-modal" role="dialog" aria-modal="true" aria-label={isNew ? "New event" : "Edit event"} onSubmit={submit}>
        <div className="cal-modal-head">
          <strong>{isNew ? "New event" : `Edit ${kinds[kind]?.label?.toLowerCase() || "event"}`}</strong>
          <button type="button" className="cal-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        {isNew && kindKeys.length > 1 && (
          <div className="cal-kinds" role="radiogroup" aria-label="Type">
            {kindKeys.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? "on" : ""}
                onClick={() => setKind(k)}>
                <i style={{ background: kinds[k].color }} />{kinds[k].label}
              </button>
            ))}
          </div>
        )}

        <label className="cal-field">Title
          <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
        </label>
        <div className="cal-row">
          <label className="cal-field">Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label className="cal-field">{spec.hasEnd ? "Start" : "Time"}{spec.timeOptional ? " (optional)" : ""}
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required={!spec.timeOptional} />
          </label>
          {spec.hasEnd && (
            <label className="cal-field">End
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </label>
          )}
        </div>
        <label className="cal-field">Notes
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
        </label>

        {error && <p className="cal-error" role="alert">{error}</p>}

        <div className="cal-modal-actions">
          {!isNew && onDelete && (
            <button type="button" className="cal-danger" onClick={remove} disabled={busy}>Delete</button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </div>
  );
}
