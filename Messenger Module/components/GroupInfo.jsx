import { useCallback, useEffect, useState } from "react";
import chatApi from "../services/chatClient.js";

// Members of a group. Owners (from the member list) can rename, add, remove and delete the group; everyone can archive it for themselves or leave.
// The database enforces the same rules, so hiding the controls is only for tidiness.
export default function GroupInfo({ row, me, reload, onBack, onClose, onLeft, onArchive }) {
  const cid = row.id;
  const [members, setMembers] = useState(null);
  const [staff, setStaff] = useState([]);
  const [title, setTitle] = useState(row.title || "");
  const [adding, setAdding] = useState([]);
  const [confirming, setConfirming] = useState(null); // "leave", "delete" or null
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState("");

  const load = useCallback(() => chatApi.members(cid).then(setMembers, () => { setMembers([]); setProblem("Could not load the members. Please try again."); }), [cid]);
  useEffect(() => { load(); chatApi.staff().then(setStaff, () => {}); }, [load]);

  const owner = (members || []).some((m) => m.profile_id === me && m.role === "owner");
  const inGroup = new Set((members || []).map((m) => m.profile_id));
  const candidates = staff.filter((p) => !inGroup.has(p.id));

  async function act(action, sentence, after) {
    if (working) return;
    setWorking(true);
    setProblem("");
    try {
      await action();
      await after?.();
    } catch {
      setProblem(sentence);
    }
    setWorking(false);
  }

  const refresh = async () => { await load(); await reload(); };
  const rename = () => {
    if (!title.trim()) { setProblem("Give the group a name."); return; }
    act(() => chatApi.renameGroup(cid, title.trim()), "Could not rename the group. Please try again.", reload);
  };
  const remove = (id) => act(() => chatApi.removeMember(cid, id), "Could not remove this person. Please try again.", refresh);
  const add = () => act(() => chatApi.addMembers(cid, adding), "Could not add these people. Please try again.", async () => { setAdding([]); await refresh(); });
  const leave = () => act(() => chatApi.leave(cid), "Could not leave the group. Please try again.", async () => { await reload(); onLeft(); });
  const destroy = () => act(() => chatApi.deleteGroup(cid), "Could not delete the group. Please try again.", async () => { await reload(); onLeft(); });

  return (
    <section className="msgr-screen" aria-label="Group info">
      <header className="msgr-pane-head">
        <button type="button" className="msgr-icon-btn" onClick={onBack} aria-label="Back">←</button>
        <strong className="msgr-head-title">Group info</strong>
        <button type="button" className="msgr-close" onClick={onClose} aria-label="Close chat">×</button>
      </header>
      {problem && <p className="msgr-problem" role="alert">{problem}</p>}
      {owner && (
        <div className="msgr-field-row">
          <input className="msgr-search" aria-label="Group name" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
          <button type="button" className="msgr-send" disabled={working} onClick={rename}>Rename</button>
        </div>
      )}
      <ul className="msgr-rows">
        {(members || []).map((m) => (
          <li key={m.profile_id} className="msgr-row msgr-member">
            <span className="msgr-row-title">{m.full_name || "Former staff"}{m.profile_id === me ? " (you)" : ""}</span>
            {m.role === "owner" && <small className="msgr-role">Owner</small>}
            {owner && m.profile_id !== me && (
              <button type="button" className="msgr-link" disabled={working} onClick={() => remove(m.profile_id)}>Remove</button>
            )}
          </li>
        ))}
      </ul>
      {owner && candidates.length > 0 && (
        <div className="msgr-add">
          <strong>Add people</strong>
          <ul className="msgr-rows msgr-pick-rows">
            {candidates.map((p) => (
              <li key={p.id}>
                <label className="msgr-row">
                  <input type="checkbox" checked={adding.includes(p.id)} onChange={() => setAdding((a) => (a.includes(p.id) ? a.filter((x) => x !== p.id) : [...a, p.id]))} />
                  <span className="msgr-row-title">{p.full_name || "Unnamed"}</span>
                </label>
              </li>
            ))}
          </ul>
          <button type="button" className="msgr-send" disabled={working || !adding.length} onClick={add}>Add</button>
        </div>
      )}
      <div className="msgr-screen-foot">
        {confirming === "leave" && (
          <>
            <span>Leave this group?</span>
            <button type="button" className="msgr-danger" disabled={working} onClick={leave}>Leave</button>
            <button type="button" className="msgr-link" onClick={() => setConfirming(null)}>Cancel</button>
          </>
        )}
        {confirming === "delete" && (
          <>
            <span>Delete this group and all its messages for everyone? This cannot be undone.</span>
            <button type="button" className="msgr-danger" disabled={working} onClick={destroy}>Delete</button>
            <button type="button" className="msgr-link" onClick={() => setConfirming(null)}>Cancel</button>
          </>
        )}
        {!confirming && (
          <>
            {onArchive && <button type="button" className="msgr-link" disabled={working} onClick={() => onArchive(!row.archived)}>{row.archived ? "Restore chat" : "Archive chat"}</button>}
            <button type="button" className="msgr-danger" onClick={() => setConfirming("leave")}>Leave group</button>
            {owner && <button type="button" className="msgr-danger" onClick={() => setConfirming("delete")}>Delete group</button>}
          </>
        )}
      </div>
    </section>
  );
}
