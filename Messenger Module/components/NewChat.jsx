import { useEffect, useState } from "react";
import chatApi from "../services/chatClient.js";

// Start a direct chat (click a person) or a group (title and at least one other person).
// onOpened(id) runs after the chat exists; the panel reloads the list and selects it.
export default function NewChat({ me, onOpened, onBack, onClose }) {
  const [group, setGroup] = useState(false);
  const [staff, setStaff] = useState(null);
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const [chosen, setChosen] = useState([]);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    let stale = false;
    chatApi.staff().then(
      (list) => { if (!stale) setStaff(list); },
      () => { if (!stale) { setStaff([]); setProblem("Could not load the staff list. Please try again."); } },
    );
    return () => { stale = true; };
  }, []);

  const needle = search.trim().toLowerCase();
  const people = (staff || []).filter((p) => p.id !== me && (!needle || String(p.full_name || "").toLowerCase().includes(needle)));
  const toggle = (id) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  async function run(action, sentence) {
    if (working) return;
    setWorking(true);
    setProblem("");
    try {
      onOpened(await action());
    } catch {
      setProblem(sentence);
      setWorking(false);
    }
  }

  const startDirect = (id) => run(() => chatApi.startDirect(id), "Could not open this chat. Please try again.");
  function create() {
    if (!title.trim()) { setProblem("Give the group a name."); return; }
    if (!chosen.length) { setProblem("Choose at least one person."); return; }
    run(() => chatApi.createGroup(title.trim(), chosen), "Could not create the group. Please try again.");
  }

  return (
    <section className="msgr-screen" aria-label={group ? "New group" : "New chat"}>
      <header className="msgr-pane-head">
        <button type="button" className="msgr-icon-btn" onClick={onBack} aria-label="Back">←</button>
        <strong className="msgr-head-title">{group ? "New group" : "New chat"}</strong>
        <button type="button" className="msgr-close" onClick={onClose} aria-label="Close chat">×</button>
      </header>
      <div className="msgr-tabs">
        <button type="button" className={`msgr-tab${group ? "" : " msgr-tab-on"}`} onClick={() => { setGroup(false); setProblem(""); }}>Direct</button>
        <button type="button" className={`msgr-tab${group ? " msgr-tab-on" : ""}`} onClick={() => { setGroup(true); setProblem(""); }}>Group</button>
      </div>
      {group && <input className="msgr-search" placeholder="Group name" aria-label="Group name" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />}
      <input className="msgr-search" type="search" placeholder="Search staff" aria-label="Search staff" value={search} onChange={(e) => setSearch(e.target.value)} />
      {problem && <p className="msgr-problem" role="alert">{problem}</p>}
      <ul className="msgr-rows">
        {people.map((p) => (
          <li key={p.id}>
            {group ? (
              <label className="msgr-row"><input type="checkbox" checked={chosen.includes(p.id)} onChange={() => toggle(p.id)} /> <span className="msgr-row-title">{p.full_name || "Unnamed"}</span></label>
            ) : (
              <button type="button" className="msgr-row" disabled={working} onClick={() => startDirect(p.id)}><span className="msgr-row-title">{p.full_name || "Unnamed"}</span></button>
            )}
          </li>
        ))}
      </ul>
      {staff && !people.length && <p className="msgr-note">No one found</p>}
      {group && <div className="msgr-screen-foot"><button type="button" className="msgr-send" disabled={working} onClick={create}>Create group</button></div>}
    </section>
  );
}
