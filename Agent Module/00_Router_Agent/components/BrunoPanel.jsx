import { useEffect, useRef, useState } from "react";
import { canSend, CONNECTION_ERROR, inputAfterSend } from "../logic/chat.js";
import { PetFace } from "./BrunoPet.jsx";

// The chat. Replies are shown as plain text, word for word; the agent's name is a separate label.
export default function BrunoPanel({ supabase, name, onCollapse }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // State updates after the render, so a second Enter in the same moment needs this to see the send.
  const busyRef = useRef(false);
  const endRef = useRef(null);

  useEffect(() => {
    let live = true;
    supabase.rpc("router_history").then(({ data, error: historyError }) => {
      if (!live) return;
      if (historyError) setError(CONNECTION_ERROR);
      else setMessages((data || []).map((m) => ({ id: m.id, role: m.role, content: m.content, from: m.from_name })));
    });
    return () => {
      live = false;
    };
  }, [supabase]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages, busy]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onCollapse();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCollapse]);

  async function send() {
    if (!canSend(input, busyRef.current)) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    const { data, error: sendError } = await supabase.functions.invoke("router-agent", { body: { message: input } });
    const failed = !!sendError || typeof data?.reply !== "string";
    setInput(inputAfterSend(input, failed));
    if (failed) {
      setError(CONNECTION_ERROR);
    } else {
      const at = Date.now();
      setMessages((list) => [
        ...list,
        { id: `q${at}`, role: "user", content: input.trim() },
        { id: `a${at}`, role: "assistant", content: data.reply, from: data.from },
      ]);
    }
    busyRef.current = false;
    setBusy(false);
  }

  async function clear() {
    const { error: clearError } = await supabase.rpc("router_clear");
    if (clearError) setError(CONNECTION_ERROR);
    else setMessages([]);
  }

  return (
    <section className="bruno-panel" aria-label={name}>
      <header className="bruno-head">
        <PetFace size={32} />
        <strong className="bruno-title">{name}</strong>
        <button type="button" className="bruno-link" onClick={clear} disabled={busy || !messages.length}>Clear</button>
        <button type="button" className="bruno-icon" aria-label={`Collapse ${name}`} onClick={onCollapse}>−</button>
      </header>

      <div className="bruno-list" aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className={`bruno-msg bruno-${m.role}`}>
            <div className="bruno-bubble">{m.content}</div>
            {m.from && <div className="bruno-from">from {m.from}</div>}
          </div>
        ))}
        {busy && <div className="bruno-msg bruno-assistant"><div className="bruno-bubble bruno-wait" aria-label="Waiting for a reply">…</div></div>}
        <div ref={endRef} />
      </div>

      {error && <div className="bruno-error" role="alert">{error}</div>}

      <form className="bruno-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea
          className="bruno-input"
          rows={2}
          maxLength={4000}
          placeholder={`Ask ${name}...`}
          aria-label={`Ask ${name}`}
          value={input}
          readOnly={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="submit" className="bruno-send" disabled={!canSend(input, busy)}>Send</button>
      </form>
    </section>
  );
}
