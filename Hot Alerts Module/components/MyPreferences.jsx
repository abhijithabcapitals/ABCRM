import { useEffect, useState } from "react";
import { Note, box } from "./ui";
import { alertPreferencesGet, alertPreferencesSave } from "../services/alertsApi";
import { isNotSwitchedOn, prefIsOn, prefWithChange } from "../logic/alertLogic";

const th = { textAlign: "left", fontSize: 11, color: "#888", fontWeight: 600, padding: "6px 10px", borderBottom: "1px solid #eee" };
const td = { fontSize: 12, padding: "6px 10px", borderBottom: "1px solid #f3f3f3" };

// The signed-in person's own choices. Each tick saves at once. A change never affects other people.
export default function MyPreferences({ supabase }) {
  const [prefs, setPrefs] = useState(null);
  const [error, setError] = useState("");
  const [off, setOff] = useState(false);

  useEffect(() => {
    let live = true;
    alertPreferencesGet(supabase)
      .then((p) => { if (live) setPrefs(p); })
      .catch((e) => { if (!live) return; if (isNotSwitchedOn(e)) setOff(true); else setError(e.message); });
    return () => { live = false; };
  }, [supabase]);

  async function toggle(category, channel, enabled) {
    const before = prefs;
    setError("");
    setPrefs(prefWithChange(prefs, category, channel, enabled));
    try {
      await alertPreferencesSave(supabase, category, channel, enabled);
    } catch (e) {
      setPrefs(before);
      setError(e.message);
    }
  }

  if (off) return null;
  return (
    <div style={box}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>My notifications</div>
      <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
        Choose what reaches you. Your alerts stay in your list either way, and Critical alerts always reach the bell.
      </div>
      {error && <Note tone="bad">{error}</Note>}
      {!prefs ? <div style={{ fontSize: 12, color: "#888" }}>Loading...</div> : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Category</th>{prefs.channels.map((c) => <th key={c} style={th}>{c}</th>)}</tr></thead>
          <tbody>
            {prefs.categories.map((cat) => (
              <tr key={cat}>
                <td style={td}>{cat}</td>
                {prefs.channels.map((c) => (
                  <td key={c} style={td}>
                    <input type="checkbox" aria-label={`${cat} ${c}`} checked={prefIsOn(prefs, cat, c)} onChange={(e) => toggle(cat, c, e.target.checked)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
