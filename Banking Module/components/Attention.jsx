// Errors appear as one bubble in the centre over a blurred page, closed to carry on. What is missing blinks red.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import "./attention.css";

export function ErrorBubble({ message, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="crm-bubble-back" onClick={onClose}>
      <div className="crm-bubble" role="alertdialog" aria-modal="true" aria-label="Error" onClick={(e) => e.stopPropagation()}>
        <div className="crm-bubble-title">Something needs your attention</div>
        <p>{message}</p>
        <button type="button" autoFocus onClick={onClose}>Close and continue</button>
      </div>
    </div>,
    document.body,
  );
}

// Shows a message until closed, and again if a different one arrives.
export function ErrorNote({ message, onClose }) {
  const [closed, setClosed] = useState(null);
  if (!message || closed === message) return null;
  return <ErrorBubble message={message} onClose={() => { setClosed(message); onClose?.(); }} />;
}

// Marks elements until the user acts on them, and brings the first into view.
export function flagMissing(ids) {
  const els = ids.map((id) => document.getElementById(id)).filter(Boolean);
  els.forEach(mark);
  els[0]?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  return els.length;
}

function mark(el) {
  el.classList.add("crm-attention");
  const clear = () => { el.classList.remove("crm-attention"); ["input", "change", "click"].forEach((t) => el.removeEventListener(t, clear)); };
  ["input", "change", "click"].forEach((t) => el.addEventListener(t, clear));
}

// For the whole CRM: alert() and unexpected failures use the bubble, and required fields a form rejects blink.
export function GlobalAttention() {
  const [messages, setMessages] = useState([]);
  useEffect(() => {
    const show = (m) => setMessages((q) => (q.includes(m) ? q : [...q, m]));
    const nativeAlert = window.alert;
    window.alert = (m) => show(String(m));
    const onReject = (e) => { const r = e.reason; if (r?.message && r.name !== "AbortError") show(r.message); };
    const onInvalid = (e) => { if (e.target?.classList) mark(e.target); };
    window.addEventListener("unhandledrejection", onReject);
    document.addEventListener("invalid", onInvalid, true);
    return () => { window.alert = nativeAlert; window.removeEventListener("unhandledrejection", onReject); document.removeEventListener("invalid", onInvalid, true); };
  }, []);
  return messages.length ? <ErrorBubble message={messages[0]} onClose={() => setMessages((q) => q.slice(1))} /> : null;
}
