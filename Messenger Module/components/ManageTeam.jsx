import { useCallback, useEffect, useState } from "react";
import chatApi from "../services/chatClient.js";
import { checkName } from "../logic/teams.js";
import PeoplePicker from "./PeoplePicker.jsx";

// Says what will be lost, and asks once more in place.
function Danger({ label, warning, onConfirm }) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <button type="button" className="abm-btn-danger" onClick={() => setAsking(true)}>{label}</button>;
  return (
    <span className="abm-confirm" role="alert">
      {warning}
      <button type="button" className="abm-btn-danger" onClick={() => { setAsking(false); onConfirm(); }}>Yes, {label.toLowerCase()}</button>
      <button type="button" className="abm-btn-quiet" onClick={() => setAsking(false)}>Keep</button>
    </span>
  );
}

function PrivateMembers({ channel, teamPeople, me, owner, act }) {
  const [members, setMembers] = useState(null);
  const [adding, setAdding] = useState([]);
  const load = useCallback(() => chatApi.members(channel.conversation_id).then(setMembers, () => setMembers([])), [channel.conversation_id]);
  useEffect(() => { const first = setTimeout(load, 0); return () => clearTimeout(first); }, [load]);
  if (!members) return <p className="abm-hint" role="status">Loading people…</p>;
  const inside = new Set(members.map((m) => m.profile_id));
  const others = teamPeople.filter((p) => !inside.has(p.profile_id) && p.full_name).map((p) => ({ id: p.profile_id, name: p.full_name }));
  return (
    <div className="abm-subpanel">
      <ul className="abm-list">
        {members.map((m) => (
          <li key={m.profile_id} className="abm-line">
            <span>{m.full_name || "Former staff"}</span>
            {owner && m.profile_id !== me && <button type="button" className="abm-btn-quiet" onClick={() => act(() => chatApi.removeChannelMember(channel.channel_id, m.profile_id)).then(load)}>Remove</button>}
          </li>
        ))}
      </ul>
      {owner && others.length > 0 && (
        <>
          <PeoplePicker people={others} chosen={adding} onChange={setAdding} label="Add to this channel" />
          <button type="button" className="abm-btn" disabled={!adding.length} onClick={() => act(() => chatApi.addChannelMembers(channel.channel_id, adding)).then(() => { setAdding([]); load(); })}>Add</button>
        </>
      )}
    </div>
  );
}

function ChannelLine({ channel, owner, teamPeople, me, act, onGone }) {
  const [renaming, setRenaming] = useState(null);
  const [open, setOpen] = useState(false);
  return (
    <li>
      <div className="abm-line">
        {renaming === null
          ? <span>{channel.channel_name}{channel.visibility === "private" && <span className="abm-flag"> Private</span>}{channel.is_general && <span className="abm-flag"> Everyone</span>}</span>
          : (
            <span className="abm-inline">
              <input className="abm-field" aria-label={`New name for ${channel.channel_name}`} maxLength={80} autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} />
              <button type="button" className="abm-btn" onClick={() => act(() => chatApi.renameChannel(channel.channel_id, renaming.trim())).then(() => setRenaming(null))}>Save</button>
              <button type="button" className="abm-btn-quiet" onClick={() => setRenaming(null)}>Cancel</button>
            </span>
          )}
        <span className="abm-inline">
          {channel.visibility === "private" && <button type="button" className="abm-btn-quiet" aria-expanded={open} onClick={() => setOpen(!open)}>People</button>}
          {channel.visibility === "private" && <Danger label="Leave" warning="You will no longer see this channel. If nobody is left, it is deleted." onConfirm={() => act(() => chatApi.leaveChannel(channel.channel_id)).then(onGone)} />}
          {owner && !channel.is_general && renaming === null && <button type="button" className="abm-btn-quiet" onClick={() => setRenaming(channel.channel_name)}>Rename</button>}
          {owner && !channel.is_general && <Danger label="Delete" warning="All its posts and replies go. This cannot be undone." onConfirm={() => act(() => chatApi.deleteChannel(channel.channel_id)).then(onGone)} />}
        </span>
      </div>
      {open && <PrivateMembers channel={channel} teamPeople={teamPeople} me={me} owner={owner} act={act} />}
    </li>
  );
}

// People, channels and the team's own details. Owners change things; members see them and can leave.
export default function ManageTeam({ team, me, onChanged, onGone, onClose }) {
  const owner = team.role === "owner";
  const [people, setPeople] = useState(null);
  const [staff, setStaff] = useState([]);
  const [adding, setAdding] = useState([]);
  const [problem, setProblem] = useState("");
  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description || "");
  const [channelName, setChannelName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [channelPeople, setChannelPeople] = useState([]);

  const loadPeople = useCallback(() => chatApi.teamPeople(team.id).then(setPeople, (e) => setProblem(e.message)), [team.id]);
  useEffect(() => {
    const first = setTimeout(loadPeople, 0);
    if (owner) chatApi.staff().then((list) => setStaff(list || []), () => {});
    return () => clearTimeout(first);
  }, [loadPeople, owner]);

  // Every change: show its sentence if refused, and refresh the lists if done. A refusal stops any step chained after it.
  async function act(fn) {
    setProblem("");
    try {
      await fn();
      await onChanged();
      await loadPeople();
    } catch (e) {
      setProblem(e.message);
      throw e;
    }
  }
  const run = (fn) => act(fn).catch(() => {});

  const outside = staff.filter((s) => s.full_name && !(people || []).some((p) => p.profile_id === s.id)).map((s) => ({ id: s.id, name: s.full_name }));
  const teamChoices = (people || []).filter((p) => p.profile_id !== me && p.full_name).map((p) => ({ id: p.profile_id, name: p.full_name }));

  function addChannel(e) {
    e.preventDefault();
    const bad = checkName(channelName, "channel name");
    if (bad) { setProblem(bad); return; }
    run(() => chatApi.createChannel(team.id, channelName.trim(), isPrivate ? "private" : "standard", isPrivate ? channelPeople : []).then(() => {
      setChannelName("");
      setIsPrivate(false);
      setChannelPeople([]);
    }));
  }

  return (
    <section className="abm-page abm-form" aria-label={`Manage ${team.name}`}>
      <header className="abm-side-head">
        <h2 className="abm-clip">{team.name}</h2>
        <button type="button" className="abm-btn-quiet" onClick={onClose}>Close</button>
      </header>
      <div className="abm-side-body abm-form-body">
        {problem && <p className="abm-problem" role="alert">{problem}</p>}

        {owner && (
          <section aria-label="Team details">
            <h3 className="abm-found">Details</h3>
            <label className="abm-label">Team name<input className="abm-field" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="abm-label">What the team is for<input className="abm-field" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
            <button type="button" className="abm-btn" onClick={() => { const bad = checkName(name, "team name"); if (bad) setProblem(bad); else run(() => chatApi.updateTeam(team.id, name.trim(), description.trim())); }}>Save details</button>
          </section>
        )}

        <section aria-label="Channels">
          <h3 className="abm-found">Channels</h3>
          <ul className="abm-list">
            {team.channels.map((c) => <ChannelLine key={c.channel_id} channel={c} owner={owner} teamPeople={people || []} me={me} act={act} onGone={onChanged} />)}
          </ul>
          {owner && (
            <form onSubmit={addChannel} className="abm-subpanel" aria-label="New channel">
              <label className="abm-label">New channel name<input className="abm-field" maxLength={80} value={channelName} onChange={(e) => setChannelName(e.target.value)} /></label>
              <label className="abm-picker-row"><input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} /><span>Private: only chosen people see it</span></label>
              {isPrivate && <PeoplePicker people={teamChoices} chosen={channelPeople} onChange={setChannelPeople} label="Who else is in it" />}
              <button type="submit" className="abm-btn">Add channel</button>
            </form>
          )}
        </section>

        <section aria-label="People">
          <h3 className="abm-found">People{people ? ` (${people.length})` : ""}</h3>
          {!people && <p className="abm-hint" role="status">Loading people…</p>}
          <ul className="abm-list">
            {(people || []).map((p) => (
              <li key={p.profile_id} className="abm-line">
                <span>{p.full_name || "Former staff"}{p.profile_id === me && <span className="abm-flag"> You</span>}{!owner && p.role === "owner" && <span className="abm-flag"> Owner</span>}</span>
                {owner && (
                  <span className="abm-inline">
                    <select className="abm-field" aria-label={`Role of ${p.full_name || "this person"}`} value={p.role} onChange={(e) => run(() => chatApi.setTeamRole(team.id, p.profile_id, e.target.value))}>
                      <option value="owner">Owner</option>
                      <option value="member">Member</option>
                    </select>
                    {p.profile_id !== me && <button type="button" className="abm-btn-quiet" onClick={() => run(() => chatApi.removeTeamMember(team.id, p.profile_id))}>Remove</button>}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {owner && outside.length > 0 && (
            <div className="abm-subpanel">
              <PeoplePicker people={outside} chosen={adding} onChange={setAdding} label="Add people" />
              <button type="button" className="abm-btn" disabled={!adding.length} onClick={() => run(() => chatApi.addTeamMembers(team.id, adding).then(() => setAdding([])))}>Add to team</button>
            </div>
          )}
        </section>

        <section aria-label="Leave or delete" className="abm-inline abm-danger-zone">
          <Danger label="Leave team" warning="You will lose access to its channels." onConfirm={() => act(() => chatApi.leaveTeam(team.id)).then(onGone, () => {})} />
          {owner && <Danger label="Delete team" warning="Every channel, post and reply in it goes for everyone. This cannot be undone." onConfirm={() => act(() => chatApi.deleteTeam(team.id)).then(onGone, () => {})} />}
        </section>
      </div>
    </section>
  );
}
