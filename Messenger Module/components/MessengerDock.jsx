import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import ChatBoundary from "./ChatBoundary.jsx";
import ChatRail from "./ChatRail.jsx";
import useActivity from "./useActivity.js";
import useChat from "./useChat.js";
import usePresence from "./usePresence.js";
import useTeams from "./useTeams.js";
import inboxApi from "../services/inboxClient.js";
import { shouldCollapse } from "../logic/chat.js";
import { routeResult, saveSection } from "../logic/app.js";
import { teamsUnread } from "../logic/teams.js";
import "./chat.css";

const DockSections = lazy(() => import("./DockSections.jsx"));

const KEEP_OPEN = "msgr-keep-open";
const MAIL_REFRESH_MS = 2 * 60 * 1000; // the mail store syncs every two minutes
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

function Inner({ profile, onOpenPage }) {
  const { rows, error, connected, reload, onMessage } = useChat(profile?.id);
  const { label: statusOf } = usePresence(profile?.id);
  const activity = useActivity(profile?.id, onMessage);
  const teamsData = useTeams(profile?.id, onMessage);
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false); // the pane loads on first open, then stays mounted so drafts survive
  const [section, setSection] = useState("chats");
  const [inboxChannel, setInboxChannel] = useState("email");
  const [target, setTarget] = useState(null); // the channel or thread Activity asked to open
  const [selected, setSelected] = useState(null);
  const [screen, setScreen] = useState(null); // "new", "info", "settings", or null
  const [keepOpen, setKeepOpen] = useState(readKeepOpen);
  const [inboxCount, setInboxCount] = useState(0);
  const dock = useRef(null);

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

  const countInbox = useCallback(() => Promise.all([inboxApi.newCount(), inboxApi.channelUnread()]).then(([mail, other]) => setInboxCount(mail + other), () => {}), []);
  useEffect(() => {
    const first = setTimeout(countInbox, 0);
    const timer = setInterval(countInbox, MAIL_REFRESH_MS);
    window.addEventListener("focus", countInbox);
    return () => { clearTimeout(first); clearInterval(timer); window.removeEventListener("focus", countInbox); };
  }, [countInbox]);

  const close = () => setOpen(false);
  const show = (name) => {
    setSection(name);
    setScreen(null);
    setOpened(true);
    setOpen(true);
  };
  const showScreen = (name) => { show("chats"); setScreen(name); };
  // Clicking what is already open collapses it.
  const toggleSection = (name) => { if (open && section === name && !screen) close(); else show(name); };
  const pick = (id) => {
    if (open && section === "chats" && id === selected && !screen) { close(); return; }
    setSelected(id);
    show("chats");
  };
  const openInbox = (channel) => {
    if (open && section === "inbox" && inboxChannel === channel) { close(); return; }
    setInboxChannel(channel);
    show("inbox");
  };
  const openActivity = (row) => {
    if (!row.read_at) activity.markRead(row.id);
    const to = routeResult(row);
    if (to.target) setTarget(to.target); else setSelected(to.conversationId);
    show(to.section);
  };
  const openPage = onOpenPage ? () => { saveSection(section); onOpenPage(); } : undefined;

  const chat = {
    rows, reload, onMessage, visible: open, connected, selected, onSelect: setSelected, screen, onScreen: setScreen, onClose: close,
    keepOpen, onKeepOpen: (on) => { setKeepOpen(on); saveKeepOpen(on); }, statusOf,
    name: profile?.full_name, isAdmin: profile?.role === "admin",
  };

  return (
    <aside ref={dock} className={`msgr-dock${open ? " msgr-dock-open" : ""}`}>
      <ChatRail rows={rows} myId={profile?.id} selectedId={section === "chats" && !screen ? selected : null} open={open} error={error}
        section={open ? section : null} inboxChannel={inboxChannel} screen={open ? screen : null}
        counts={{ activity: activity.unread, teams: teamsData.error ? 0 : teamsUnread(teamsData.rows), inbox: inboxCount }}
        onSettings={() => showScreen("settings")} onNew={() => showScreen("new")} onSelect={pick} onRetry={reload} onSection={toggleSection} onInbox={openInbox} />
      <div className="msgr-dock-pane" inert={!open}>
        {opened && (
          <div className="msgr-dock-pane-in">
            <ChatBoundary fallback={<PanelNote text="Chat is not available right now. Please reload the page." onClose={close} />}>
              <Suspense fallback={<PanelNote text="Loading chat…" onClose={close} />}>
                <DockSections section={section} profile={profile} chat={chat} teamsData={teamsData} activity={activity} target={target} inboxChannel={inboxChannel}
                  onActivityOpen={openActivity} onCountChanged={countInbox} onOpenSettings={() => showScreen("settings")} onOpenPage={openPage} onClose={close} />
              </Suspense>
            </ChatBoundary>
          </div>
        )}
      </div>
    </aside>
  );
}

// If chat fails to render, the page around it carries on without the dock.
export default function MessengerDock({ profile, onOpenPage }) {
  return (
    <ChatBoundary fallback={null}>
      <Inner profile={profile} onOpenPage={onOpenPage} />
    </ChatBoundary>
  );
}
