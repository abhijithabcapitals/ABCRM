import { lazy, Suspense, useEffect, useRef, useState } from "react";
import ChatBoundary from "./ChatBoundary.jsx";
import ChatRail from "./ChatRail.jsx";
import useChat from "./useChat.js";
import usePresence from "./usePresence.js";
import chatApi from "../services/chatClient.js";
import { shouldCollapse } from "../logic/chat.js";
import "./chat.css";

const MessengerPanel = lazy(() => import("./MessengerPanel.jsx"));

const KEEP_OPEN = "msgr-keep-open";
const MAIL_REFRESH_MS = 5 * 60 * 1000;
const readKeepOpen = () => {
  try { return localStorage.getItem(KEEP_OPEN) === "1"; } catch { return false; }
};
const saveKeepOpen = (on) => {
  try { localStorage.setItem(KEEP_OPEN, on ? "1" : "0"); } catch { /* still applies until the page reloads */ }
};

// Shown while the pane loads or if it fails. Always has a close button, as phones have no Esc.
function PanelNote({ text, onClose }) {
  return (
    <div className="msgr-panel">
      <header className="msgr-pane-head">
        <strong>Chats</strong>
        <button type="button" className="msgr-close" onClick={onClose} aria-label="Close chat">×</button>
      </header>
      <p className="msgr-note">{text}</p>
    </div>
  );
}

function Inner({ profile, onOpenMail }) {
  const { rows, error, connected, reload, onMessage } = useChat(profile?.id);
  const { label: statusOf } = usePresence(profile?.id);
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false); // the pane loads on first open, then stays mounted so drafts survive
  const [selected, setSelected] = useState(null);
  const [screen, setScreen] = useState(null); // "new", "info", "settings", or null
  const [keepOpen, setKeepOpen] = useState(readKeepOpen);
  const [mailCount, setMailCount] = useState(null);
  const dock = useRef(null);
  const canReadMail = !!onOpenMail;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!keepOpen && shouldCollapse(e.target, dock.current, dock.current)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, keepOpen]);

  // Things fixed to the right of the page, such as the reading widget, sit clear of the dock.
  useEffect(() => {
    const el = dock.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const root = document.documentElement;
    const watcher = new ResizeObserver(() => root.style.setProperty("--msgr-dock-offset", `${el.offsetWidth}px`));
    watcher.observe(el);
    return () => { watcher.disconnect(); root.style.removeProperty("--msgr-dock-offset"); };
  }, []);

  useEffect(() => {
    if (!canReadMail) { setMailCount(null); return undefined; }
    let live = true;
    const check = () => chatApi.mailNewCount().then((n) => { if (live) setMailCount(n); }, () => {});
    check();
    const timer = setInterval(check, MAIL_REFRESH_MS);
    window.addEventListener("focus", check);
    return () => { live = false; clearInterval(timer); window.removeEventListener("focus", check); };
  }, [canReadMail]);

  const show = () => { setOpened(true); setOpen(true); };
  const showScreen = (name) => { setScreen(name); show(); };
  const close = () => setOpen(false);
  // Clicking the open chat again collapses it.
  const pick = (id) => {
    if (open && id === selected && !screen) { close(); return; }
    setSelected(id);
    setScreen(null);
    show();
  };

  return (
    <aside ref={dock} className={`msgr-dock${open ? " msgr-dock-open" : ""}`}>
      <ChatRail rows={rows} myId={profile?.id} selectedId={selected} open={open} error={error} mailCount={mailCount}
        onSettings={() => showScreen("settings")} onNew={() => showScreen("new")} onSelect={pick} onRetry={reload} onOpenMail={onOpenMail} />
      <div className="msgr-dock-pane" inert={!open}>
        {opened && (
          <div className="msgr-dock-pane-in">
            <ChatBoundary fallback={<PanelNote text="Chat is not available right now. Please reload the page." onClose={close} />}>
              <Suspense fallback={<PanelNote text="Loading chat…" onClose={close} />}>
                <MessengerPanel profile={profile} rows={rows} reload={reload} onMessage={onMessage} visible={open} connected={connected}
                  selected={selected} onSelect={setSelected} screen={screen} onScreen={setScreen} onClose={close}
                  keepOpen={keepOpen} onKeepOpen={(on) => { setKeepOpen(on); saveKeepOpen(on); }} statusOf={statusOf} />
              </Suspense>
            </ChatBoundary>
          </div>
        )}
      </div>
    </aside>
  );
}

// If chat fails to render, the page around it carries on without the dock.
export default function MessengerDock({ profile, onOpenMail }) {
  return (
    <ChatBoundary fallback={null}>
      <Inner profile={profile} onOpenMail={onOpenMail} />
    </ChatBoundary>
  );
}
