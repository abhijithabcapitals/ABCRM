import { useEffect, useState } from "react";
import chatApi from "../services/chatClient.js";
import { badgeText } from "../logic/chat.js";
import { channelRow, findChannel, groupTeams, replyLabel } from "../logic/teams.js";
import AttachPicker from "./AttachPicker.jsx";
import Conversation from "./Conversation.jsx";
import ManageTeam from "./ManageTeam.jsx";
import Message from "./Message.jsx";
import NewTeam from "./NewTeam.jsx";

function TeamTree({ teams, error, loaded, selected, managing, onSelect, onManage, onNew, onRetry }) {
  let body;
  if (error) {
    body = <div className="abm-list-note" role="alert"><p>{error}</p><button type="button" className="abm-btn" onClick={onRetry}>Try again</button></div>;
  } else if (!loaded) {
    body = <div aria-label="Loading teams" role="status"><div className="abm-skeleton" /><div className="abm-skeleton" /></div>;
  } else if (!teams.length) {
    body = <p className="abm-list-note">You are not in a team yet. Use New team to start one.</p>;
  } else {
    body = (
      <ul className="abm-list">
        {teams.map((t) => (
          <li key={t.id}>
            <div className="abm-team-head">
              <strong className="abm-clip" title={t.name}>{t.name}</strong>
              <button type="button" className="abm-btn-quiet" aria-current={managing === t.id ? "true" : undefined} aria-label={`Manage ${t.name}`} title={t.role === "owner" ? "Rename the team, edit what it is for, and manage channels and people" : "See the team's channels and people"} onClick={() => onManage(t.id)}>Manage</button>
            </div>
            <ul className="abm-list">
              {t.channels.map((c) => {
                const count = badgeText(c.unread);
                return (
                  <li key={c.channel_id}>
                    <button type="button" className={`abm-channel${selected === c.conversation_id ? " abm-channel-on" : ""}`} aria-current={selected === c.conversation_id ? "true" : undefined}
                      aria-label={`${c.channel_name}${c.visibility === "private" ? ", private" : ""}${count ? `, ${count} unread` : ""}`} onClick={() => onSelect(c.conversation_id)}>
                      <span className={`abm-clip${count && !c.muted ? " abm-channel-new" : ""}`}>{c.channel_name}</span>
                      {c.visibility === "private" && <span className="abm-flag">Private</span>}
                      {c.muted && <span className="abm-flag">Muted</span>}
                      {count && <span className={c.muted ? "abm-unread-quiet" : "msgr-unread"}>{count}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <section className="abm-side" aria-label="Teams and channels">
      <header className="abm-side-head">
        <h2>Teams</h2>
        <button type="button" className="abm-btn" onClick={onNew}>New team</button>
      </header>
      <div className="abm-side-body">{body}</div>
    </section>
  );
}

// The Teams section. It stays mounted while hidden, so half-typed posts survive. `target` opens a channel or thread from Activity or search.
export default function TeamsSection({ profile, teamsData, visible, connected, onMessage, target }) {
  const { rows, error, loaded, reload } = teamsData;
  const me = profile?.id;
  const [selected, setSelected] = useState(null);
  const [thread, setThread] = useState(null);
  const [screen, setScreen] = useState(null); // "new", a team id to manage, or null
  const [drafts, setDrafts] = useState({});
  const teams = groupTeams(rows);
  const current = findChannel(rows, selected);
  const managed = teams.find((t) => t.id === screen);

  // A channel that has gone (deleted, or the person removed) falls back to the empty view.
  const open = current?.conversation_id || null;
  const threadHere = thread && thread.conversation_id === open ? thread : null;

  useEffect(() => {
    if (!target) return undefined;
    let live = true;
    const go = setTimeout(() => {
      setSelected(target.conversationId);
      setScreen(null);
      setThread(null);
      if (target.threadId) chatApi.message(target.threadId).then((m) => { if (live && m) setThread(m); }, () => {});
    }, 0);
    return () => { live = false; clearTimeout(go); };
  }, [target]);

  const pick = (id) => { setSelected(id); setThread(null); setScreen(null); };
  const flags = async (change) => {
    try { await chatApi.setChatFlags(open, change); await reload(); } catch { /* the button stays as it was */ }
  };
  const draftProps = (key) => ({ draft: drafts[key] || "", onDraft: (text) => setDrafts((d) => ({ ...d, [key]: text })) });
  const stage = screen ? "form" : thread && threadHere ? "thread" : open ? "channel" : "tree";

  return (
    <div className={`abm-teams abm-teams-${stage}`}>
      <TeamTree teams={teams} error={error} loaded={loaded} selected={open} managing={screen} onSelect={pick} onManage={setScreen} onNew={() => setScreen("new")} onRetry={reload} />
      {screen === "new" && <NewTeam me={me} onClose={() => setScreen(null)} onCreated={async () => { await reload(); setScreen(null); }} />}
      {managed && <ManageTeam key={managed.id} team={managed} me={me} onChanged={reload} onClose={() => setScreen(null)} onGone={() => { setScreen(null); setSelected(null); setThread(null); }} />}
      {!screen && !current && <p className="abm-pane-empty">Pick a channel to read it here.</p>}
      {!screen && current && (
        <div className="abm-channel-view">
          <div className="abm-pane abm-posts">
            <div className="msgr-panel">
              <Conversation key={open} row={channelRow(current, teams.find((t) => t.id === current.team_id)?.name)} profile={profile} visible={visible && !screen} connected={connected}
                onMessage={onMessage} reload={reload} onClose={() => setSelected(null)} attachSlot={(slot) => <AttachPicker {...slot} />} {...draftProps(open)}
                threaded onOpenThread={setThread} replyLabel={replyLabel} placeholder="Start a post" onFlags={flags} noPin />
            </div>
          </div>
          {threadHere && (
            <div className="abm-pane abm-thread">
              <div className="msgr-panel">
                <Conversation key={threadHere.id} row={channelRow(current)} profile={profile} visible={visible && !screen} connected={connected}
                  onMessage={onMessage} reload={reload} onClose={() => setThread(null)} attachSlot={(slot) => <AttachPicker {...slot} />} {...draftProps(`t:${threadHere.id}`)}
                  thread={threadHere} placeholder="Reply" title="Thread"
                  topSlot={<div className="msgr-thread-top"><Message message={threadHere} mine={threadHere.sender_id === me} me={me} /></div>} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
