import { useEffect, useRef, useState } from "react";
import chatApi from "../services/chatClient.js";
import callRoom from "../services/callRoom.js";
import { RING_LIMIT_MS, mediaProblem, tileCols } from "../logic/calls.js";
import { initials } from "../logic/chat.js";

function Tile({ tile }) {
  const video = useRef(null);
  const { attach } = tile;
  useEffect(() => (attach && video.current ? attach(video.current) : undefined), [attach]);
  const label = `${tile.name}${tile.local ? " (you)" : ""}${tile.screen ? ": screen" : ""}`;
  return (
    <figure className={`abc-tile${tile.speaking && !tile.screen ? " abc-tile-speaking" : ""}${tile.screen ? " abc-tile-screen" : ""}`}>
      {attach
        ? <video ref={video} autoPlay playsInline muted={tile.local} aria-label={label} />
        : <span className="abc-initials" aria-hidden="true">{initials(tile.name)}</span>}
      <figcaption>{label}{tile.muted && !tile.screen && <span className="abc-muted"> Muted</span>}</figcaption>
    </figure>
  );
}

function DevicePicker({ controls, onClose }) {
  const [lists, setLists] = useState({ audioinput: [], videoinput: [], audiooutput: [] });
  const [problem, setProblem] = useState("");
  useEffect(() => {
    let live = true;
    Promise.all(["audioinput", "videoinput", "audiooutput"].map((k) => controls.devices(k).catch(() => []))).then(([audioinput, videoinput, audiooutput]) => {
      if (live) setLists({ audioinput, videoinput, audiooutput });
    });
    return () => { live = false; };
  }, [controls]);
  const row = (kind, label) => (lists[kind].length > 0 && (
    <label className="abm-label">{label}
      <select className="abm-field" onChange={(e) => controls.setDevice(kind, e.target.value).catch(() => setProblem("This device could not be used."))}>
        {lists[kind].map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Device"}</option>)}
      </select>
    </label>
  ));
  return (
    <div className="abc-devices" role="dialog" aria-label="Choose devices">
      {problem && <p className="abm-problem" role="alert">{problem}</p>}
      {row("audioinput", "Microphone")}
      {row("audiooutput", "Speaker")}
      {row("videoinput", "Camera")}
      <button type="button" className="abm-btn-quiet" onClick={onClose}>Close</button>
    </div>
  );
}

// One call on screen. Leaving always reaches the database, whatever LiveKit is doing.
export default function CallStage({ call, onLeft, onEnded }) {
  const [state, setState] = useState({ status: "connecting", tiles: [], others: 0, mic: true, camera: false, sharing: false });
  const [controls, setControls] = useState(null);
  const [problem, setProblem] = useState("");
  const [small, setSmall] = useState(false);
  const [devices, setDevices] = useState(false);
  const ctl = useRef(null);
  const media = call.media;

  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        const access = await chatApi.callToken(call.id);
        if (stopped) return;
        const made = await callRoom.connect({
          url: access.url,
          token: access.token,
          media,
          onChange: (next) => { if (!stopped) setState(next); },
          onEnded: () => { if (!stopped) onEnded(); },
          onProblem: (e, kind) => { const text = mediaProblem(e, kind); if (!stopped && text) setProblem(text); },
        });
        if (stopped) { made.leave().catch(() => {}); return; }
        ctl.current = made;
        setControls(made);
      } catch (e) {
        if (!stopped) { setProblem(e.message || "The call could not connect."); setState((s) => ({ ...s, status: "failed" })); }
      }
    })();
    return () => {
      stopped = true;
      ctl.current?.leave().catch(() => {});
      ctl.current = null;
    };
  }, [call.id, media, onEnded]);

  // The caller's window tells the database when ringing has gone on too long.
  useEffect(() => {
    if (!call.startedByMe || state.others > 0) return undefined;
    const timer = setTimeout(() => { chatApi.callRingTimeout(call.id).catch(() => {}); }, RING_LIMIT_MS);
    return () => clearTimeout(timer);
  }, [call.id, call.startedByMe, state.others]);

  const note = state.status === "reconnecting" ? "Reconnecting…"
    : state.status === "connecting" ? "Connecting…"
      : state.status === "connected" && !state.others ? (call.startedByMe ? "Calling…" : "Waiting for others…") : "";
  const shown = state.tiles;

  return (
    <section className={`abc-stage${small ? " abc-stage-small" : ""}`} role="dialog" aria-label={`Call: ${call.title}`}>
      <header className="abc-head">
        <strong className="abm-clip" title={call.title}>{call.title}</strong>
        {note && <span role="status">{note}</span>}
        <button type="button" className="abc-ctl" onClick={() => setSmall(!small)}>{small ? "Expand" : "Minimise"}</button>
      </header>
      {problem && <p className="abc-problem" role="alert">{problem}</p>}
      {!small && (
        <div className="abc-tiles" style={{ "--abc-cols": tileCols(shown.length) }}>
          {shown.map((t) => <Tile key={t.id} tile={t} />)}
        </div>
      )}
      {devices && controls && <DevicePicker controls={controls} onClose={() => setDevices(false)} />}
      <footer className="abc-bar">
        <button type="button" className="abc-ctl" disabled={!controls} aria-pressed={!state.mic} onClick={() => controls.setMic(!state.mic)}>{state.mic ? "Mute" : "Unmute"}</button>
        <button type="button" className="abc-ctl" disabled={!controls} aria-pressed={state.camera} onClick={() => controls.setCamera(!state.camera)}>{state.camera ? "Camera off" : "Camera on"}</button>
        <button type="button" className="abc-ctl" disabled={!controls} aria-pressed={state.sharing} onClick={() => controls.setSharing(!state.sharing)}>{state.sharing ? "Stop sharing" : "Share screen"}</button>
        <button type="button" className="abc-ctl" disabled={!controls} aria-expanded={devices} onClick={() => setDevices(!devices)}>Devices</button>
        <button type="button" className="abc-leave" onClick={onLeft}>Leave</button>
      </footer>
    </section>
  );
}
