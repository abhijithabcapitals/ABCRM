import { useEffect, useState } from "react";
import { Note, box, btn, btnDark } from "./ui";
import { alertManualRaise, alertManualTypes } from "../services/alertsApi";

const input = { padding: 6, fontSize: 12 };

// Things only a person can know, such as a complaint. Each becomes an alert with an owner and a due date.
export default function LogItem({ supabase, onDone }) {
  const [types, setTypes] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ type: "", client: "", detail: "", due: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open || types.length) return;
    alertManualTypes(supabase).then((t) => setTypes(t || [])).catch((e) => setError(e.message));
  }, [open, supabase, types.length]);

  async function save() {
    setBusy(true); setError(""); setSaved(false);
    try {
      await alertManualRaise(supabase, form.type, form.client.trim(), form.detail, form.due || null);
      setForm({ type: "", client: "", detail: "", due: "" });
      setSaved(true);
      onDone?.();
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  if (!open) return <button type="button" style={{ ...btn, marginBottom: 12 }} onClick={() => setOpen(true)}>Log an item</button>;
  return (
    <div style={box}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Log an item</div>
      {error && <Note tone="bad">{error}</Note>}
      {saved && <Note>Saved. It is now an alert with an owner.</Note>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <select aria-label="Type" style={input} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          <option value="">Choose type</option>
          {types.map((t) => <option key={t.type} value={t.type}>{t.type}</option>)}
        </select>
        <input aria-label="Client code" placeholder="Client code, e.g. CL000001" style={input} value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} />
        <input aria-label="Due date" type="date" style={input} value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} />
      </div>
      <textarea aria-label="Detail" rows={2} placeholder="Detail" style={{ ...input, width: "100%", boxSizing: "border-box", marginBottom: 8 }} value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} />
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" style={btnDark} disabled={busy || !form.type || !form.client.trim()} onClick={save}>Save</button>
        <button type="button" style={btn} disabled={busy} onClick={() => { setOpen(false); setSaved(false); }}>Close</button>
      </div>
    </div>
  );
}
