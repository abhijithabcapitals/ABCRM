import { useState } from "react";

// A filter box and ticks. `people` is [{ id, name }]; `chosen` is a list of ids.
export default function PeoplePicker({ people, chosen, onChange, label = "Choose people" }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = people.filter((p) => (p.name || "").toLowerCase().includes(q));
  const flip = (id) => onChange(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);
  return (
    <fieldset className="abm-picker">
      <legend>{label}{chosen.length > 0 && ` (${chosen.length} chosen)`}</legend>
      <input type="search" className="abm-field" placeholder="Filter by name" aria-label={`${label}: filter by name`} value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="abm-picker-list">
        {!shown.length && <p className="abm-list-note">Nobody matches.</p>}
        {shown.map((p) => (
          <label key={p.id} className="abm-picker-row">
            <input type="checkbox" checked={chosen.includes(p.id)} onChange={() => flip(p.id)} />
            <span>{p.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
