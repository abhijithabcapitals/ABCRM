import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import chatApi from "../services/chatClient.js";
import { onStartCall } from "../services/callBus.js";
import { isDesktop, notify, showWindow } from "../services/desktop.js";
import { OPEN_STATUSES, endedNote, incomingTitle } from "../logic/calls.js";
import ChatBoundary from "./ChatBoundary.jsx";
import "../replica/design/tokens.css";
import "./calls.css";

const CallStage = lazy(() => import("./CallStage.jsx"));
const POLL_MS = 15 * 1000;

// Our own soft two-note ring, made in the browser so there is no sound file. A browser may refuse it until the page has been clicked.
function useRing(on) {
  useEffect(() => {
    if (!on) return undefined;
    let audio;
    try { audio = new AudioContext(); } catch { return undefined; }
    const note = (freq, at) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.06, audio.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + at + 0.4);
      osc.connect(gain).connect(audio.destination);
      osc.start(audio.currentTime + at);
      osc.stop(audio.currentTime + at + 0.4);
    };
    const ring = () => { note(660, 0); note(520, 0.45); };
    ring();
    const timer = setInterval(ring, 2500);
    return () => { clearInterval(timer); audio.close().catch(() => {}); };
  }, [on]);
}

// Sits above every page: rings for incoming calls and holds the call screen, so a call carries on while someone moves around the CRM.
function Inner({ profile }) {
  const me = profile?.id;
  const [incoming, setIncoming] = useState([]);
  const [active, setActive] = useState(null);
  const [note, setNote] = useState("");
  const activeRef = useRef(null);
  const told = useRef(new Set()); // calls already notified about, so a reload does not repeat it
  useEffect(() => { activeRef.current = active; }, [active]);

  const flash = useCallback((text) => { setNote(text); setTimeout(() => setNote(""), 6000); }, []);

  const reload = useCallback(async () => {
    if (!me) return;
    try {
      const list = (await chatApi.callsRinging()) || [];
      setIncoming(list.filter((c) => c.id !== activeRef.current?.id));
      if (isDesktop()) {
        list.filter((c) => !told.current.has(c.id)).forEach((c) => {
          told.current.add(c.id);
          notify("Incoming call", incomingTitle(c));
          showWindow();
        });
      }
    } catch { /* tried again shortly */ }
  }, [me]);

  useEffect(() => {
    if (!me) return undefined;
    const first = setTimeout(reload, 0);
    const timer = setInterval(reload, POLL_MS);
    window.addEventListener("focus", reload);
    const stop = chatApi.subscribeCalls((row) => {
      reload();
      const now = activeRef.current;
      if (now && row.id === now.id && !OPEN_STATUSES.has(row.status)) {
        setActive(null);
        flash(endedNote(row.status, now.startedByMe));
      }
    });
    return () => { clearTimeout(first); clearInterval(timer); window.removeEventListener("focus", reload); stop(); };
  }, [me, reload, flash]);

  useEffect(() => onStartCall(async ({ conversationId, media, title }) => {
    if (activeRef.current) { flash("Leave your current call first."); return; }
    try {
      const rows = await chatApi.startCall(conversationId, media);
      const row = Array.isArray(rows) ? rows[0] : rows;
      setActive({ id: row.call_id, media, title, startedByMe: !row.joined_existing });
    } catch (e) {
      flash(e.message);
    }
  }), [flash]);

  async function leaveCurrent() {
    const now = activeRef.current;
    if (!now) return;
    setActive(null);
    chatApi.leaveCall(now.id).catch(() => {});
  }

  async function accept(call) {
    await leaveCurrent();
    setIncoming((list) => list.filter((c) => c.id !== call.id));
    try {
      await chatApi.answerCall(call.id);
      setActive({ id: call.id, media: call.media, title: incomingTitle(call), startedByMe: false });
    } catch (e) {
      flash(e.message);
    }
  }

  function decline(call) {
    setIncoming((list) => list.filter((c) => c.id !== call.id));
    chatApi.declineCall(call.id).catch(() => {});
  }

  const roomLost = useCallback(() => {
    const now = activeRef.current;
    if (!now) return;
    setActive(null);
    chatApi.leaveCall(now.id).catch(() => {});
    flash("The call ended.");
  }, [flash]);

  useRing(incoming.length > 0);

  return (
    <>
      {incoming.length > 0 && (
        <div className="abc-incoming-list" role="alertdialog" aria-label="Incoming calls">
          {incoming.map((c) => (
            <div key={c.id} className="abc-incoming">
              <div>
                <strong className="abm-clip">{incomingTitle(c)}</strong>
                <span>{c.media === "video" ? "Incoming video call" : "Incoming call"}{active ? ". Accepting ends your current call." : ""}</span>
              </div>
              <button type="button" className="abc-accept" onClick={() => accept(c)}>Accept</button>
              <button type="button" className="abc-decline" onClick={() => decline(c)}>Decline</button>
            </div>
          ))}
        </div>
      )}
      {active && (
        <Suspense fallback={null}>
          <CallStage key={active.id} call={active} onLeft={leaveCurrent} onEnded={roomLost} />
        </Suspense>
      )}
      {note && <p className="abc-note" role="status">{note}</p>}
    </>
  );
}

// If calls fail, the page around them carries on without them.
export default function CallHost({ profile }) {
  return <ChatBoundary fallback={null}><Inner profile={profile} /></ChatBoundary>;
}
