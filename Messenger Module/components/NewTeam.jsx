import { useEffect, useState } from "react";
import chatApi from "../services/chatClient.js";
import { checkName } from "../logic/teams.js";
import PeoplePicker from "./PeoplePicker.jsx";

export default function NewTeam({ me, onCreated, onClose }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [people, setPeople] = useState([]);
  const [chosen, setChosen] = useState([]);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    chatApi.staff().then(
      (list) => { if (live) setPeople((list || []).filter((p) => p.id !== me && p.full_name).map((p) => ({ id: p.id, name: p.full_name }))); },
      (e) => { if (live) setProblem(e.message); },
    );
    return () => { live = false; };
  }, [me]);

  async function submit(e) {
    e.preventDefault();
    const bad = checkName(name, "team name");
    if (bad) { setProblem(bad); return; }
    setBusy(true);
    setProblem("");
    try {
      onCreated(await chatApi.createTeam(name.trim(), description.trim(), chosen));
    } catch (err) {
      setProblem(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="abm-page abm-form" onSubmit={submit} aria-label="New team">
      <header className="abm-side-head">
        <h2>New team</h2>
        <button type="button" className="abm-btn-quiet" onClick={onClose}>Cancel</button>
      </header>
      <div className="abm-side-body abm-form-body">
        {problem && <p className="abm-problem" role="alert">{problem}</p>}
        <label className="abm-label">Team name
          <input className="abm-field" autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="abm-label">What the team is for (optional)
          <input className="abm-field" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <PeoplePicker people={people} chosen={chosen} onChange={setChosen} label="Add people" />
        <p className="abm-hint">You will own the team. A General channel is made for everyone in it.</p>
        <button type="submit" className="abm-btn" disabled={busy}>{busy ? "Creating…" : "Create team"}</button>
      </div>
    </form>
  );
}
