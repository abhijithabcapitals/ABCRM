import { useEffect, useRef, useState } from "react";

// Chat box for the Support Agent (Edge Function "support-agent").
// The conversation lives in component state only; nothing is stored.
export default function SupportChat({ supabase }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, sending]);

  async function send(e) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    const next = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setError("");
    setSending(true);
    const { data, error: fnError } = await supabase.functions.invoke("support-agent", {
      body: { messages: next },
    });
    setSending(false);
    let message = data?.error;
    if (fnError) {
      try {
        message = (await fnError.context?.json())?.error || fnError.message;
      } catch {
        message = fnError.message;
      }
    }
    if (message || !data?.reply) {
      setError(message || "No answer came back. Try again.");
      return;
    }
    setMessages([...next, { role: "assistant", content: data.reply }]);
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) send(e);
  }

  return (
    <aside className="ha-chat">
      <div className="ha-chat-head">
        <div style={{ fontWeight: 600, fontSize: 14 }}>Support Agent</div>
        <div style={{ fontSize: 12, color: "#888" }}>
          Ask about your tasks or the Knowledge Base
        </div>
      </div>

      <div className="ha-chat-list" ref={listRef} aria-live="polite">
        {messages.length === 0 && (
          <div style={{ color: "#999", fontSize: 13, lineHeight: 1.5 }}>
            Try: “What is overdue for me?” or “What documents do we need for VAT registration?”
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`ha-msg ${m.role === "user" ? "ha-msg-user" : "ha-msg-bot"}`}>
            {m.content}
          </div>
        ))}
        {sending && <div className="ha-msg ha-msg-bot" style={{ color: "#999" }}>Thinking…</div>}
        {error && <div className="ha-chat-error">{error}</div>}
      </div>

      <form className="ha-chat-form" onSubmit={send}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a question…"
          rows={2}
          aria-label="Question for the Support Agent"
        />
        <button className="btn btn-primary" type="submit" disabled={sending || !input.trim()}>
          Send
        </button>
      </form>
      <div style={{ fontSize: 11, color: "#aaa", padding: "0 12px 10px" }}>
        Read-only. Drafts need approval before sending.
      </div>

      <style>{`
        .ha-layout { display: flex; gap: 20px; align-items: flex-start; }
        .ha-main { flex: 1; min-width: 0; }
        .ha-chat { width: 360px; flex-shrink: 0; position: sticky; top: 16px; display: flex; flex-direction: column;
          height: calc(100vh - 140px); min-height: 420px; background: #fff; border: 1px solid #e8e8e8; border-radius: 8px; }
        .ha-chat-head { padding: 12px; border-bottom: 1px solid #f0f0f0; }
        .ha-chat-list { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
        .ha-msg { max-width: 90%; padding: 8px 11px; border-radius: 10px; font-size: 13px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
        .ha-msg-user { align-self: flex-end; background: var(--accent-weak, #e6f3f3); color: #1f2a30; }
        .ha-msg-bot { align-self: flex-start; background: #f5f5f4; color: #222; }
        .ha-chat-error { font-size: 12px; color: #b91c1c; background: #fee2e2; border-radius: 6px; padding: 8px 10px; }
        .ha-chat-form { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid #f0f0f0; align-items: flex-end; }
        .ha-chat-form textarea { flex: 1; resize: none; font: inherit; font-size: 13px; padding: 7px 9px; border: 1px solid #ddd; border-radius: 6px; }
        @media (max-width: 960px) {
          .ha-layout { flex-direction: column; }
          .ha-chat { width: 100%; position: static; height: 480px; }
        }
      `}</style>
    </aside>
  );
}
