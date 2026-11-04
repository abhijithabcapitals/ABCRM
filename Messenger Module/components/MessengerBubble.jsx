import { lazy, Suspense, useEffect, useRef, useState } from "react";
import ChatBoundary from "./ChatBoundary.jsx";
import useChat from "./useChat.js";
import { badgeText, shouldCollapse } from "../logic/chat.js";
import "./chat.css";

const MessengerPanel = lazy(() => import("./MessengerPanel.jsx"));

const ICON = (
  <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
  </svg>
);

// Shown while the panel loads or if it fails. Always has a close button, since touch has no Esc and the bubble is hidden on phones.
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

function Inner({ profile }) {
  const { rows, total, error, connected, reload, onMessage } = useChat(profile?.id);
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false); // the panel loads on first open, then stays mounted so drafts survive
  const panelRef = useRef(null);
  const bubbleRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    // shouldCollapse ignores the bubble, so a click on it only toggles; it never closes and then reopens.
    const onDown = (e) => { if (shouldCollapse(e.target, panelRef.current, bubbleRef.current)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    setOpened(true);
    setOpen((v) => !v);
  };
  const badge = error ? "" : badgeText(total);

  return (
    <>
      <button ref={bubbleRef} type="button" className={`msgr-bubble${open ? " msgr-bubble-open" : ""}`} onClick={toggle}
        aria-label={badge ? `Team chat, ${badge} unread` : "Team chat"} aria-expanded={open}>
        {ICON}
        {badge && <span className="msgr-badge">{badge}</span>}
      </button>
      {opened && (
        <div ref={panelRef} className="msgr-panel-wrap" hidden={!open}>
          <ChatBoundary fallback={<PanelNote text="Chat is not available right now. Please reload the page." onClose={() => setOpen(false)} />}>
            <Suspense fallback={<PanelNote text="Loading chat…" onClose={() => setOpen(false)} />}>
              <MessengerPanel profile={profile} rows={rows} reload={reload} onMessage={onMessage} visible={open}
                connected={connected} error={error} onClose={() => setOpen(false)} />
            </Suspense>
          </ChatBoundary>
        </div>
      )}
    </>
  );
}

// If chat fails to render, a plain bubble stays and the page around it is untouched.
export default function MessengerBubble({ profile }) {
  return (
    <ChatBoundary fallback={<button type="button" className="msgr-bubble" title="Chat is not available right now" aria-label="Team chat unavailable" disabled>{ICON}</button>}>
      <Inner profile={profile} />
    </ChatBoundary>
  );
}
