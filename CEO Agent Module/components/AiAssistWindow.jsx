import { useEffect, useRef, useState } from "react";

// Floating, draggable AI window over an open email: the stored AI summary, key points
// and suggested actions, plus on-demand help from OpenRouter (ceo-mail-reply "assist":
// a fresh summary, working notes, to-dos, or an answer to a question).

const MODES = [
  { id: "summary", label: "Quick summary" },
  { id: "notes", label: "Notes" },
  { id: "todos", label: "To-dos" },
];

export default function AiAssistWindow({ sb, thread, when, savedFacts, onSaveFact, onAddAction }) {
  const [collapsed, setCollapsed] = useState(false);
  const [pos, setPos] = useState(null); // null = default corner; { x, y } once dragged
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState(null); // { title, text }
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const boxRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    setResult(null);
    setError("");
    setQuestion("");
  }, [thread.id]);

  function startDrag(event) {
    if (event.button !== 0 || event.target.closest("button")) return;
    const rect = boxRef.current.getBoundingClientRect();
    dragRef.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function drag(event) {
    if (!dragRef.current) return;
    const box = boxRef.current.getBoundingClientRect();
    const x = Math.min(Math.max(8, event.clientX - dragRef.current.dx), window.innerWidth - box.width - 8);
    const y = Math.min(Math.max(8, event.clientY - dragRef.current.dy), window.innerHeight - 48);
    setPos({ x, y });
  }

  function endDrag() {
    dragRef.current = null;
  }

  async function assist(mode, label) {
    if (mode === "ask" && !question.trim()) { setError("Type a question first."); return; }
    setBusy(mode);
    setError("");
    setCopied(false);
    const { data, error: fnError } = await sb.functions.invoke("ceo-mail-reply", {
      body: { action: "assist", thread_id: thread.id, mode, question: mode === "ask" ? question : undefined },
    });
    setBusy("");
    let message = data?.error;
    if (fnError) {
      message = fnError.message;
      try { message = (await fnError.context?.json())?.error || message; } catch { /* keep the generic message */ }
    }
    if (message) { setError(message); return; }
    setResult({ title: mode === "ask" ? question.trim() : label, text: data.text });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied(true);
    } catch {
      setError("Could not copy to the clipboard.");
    }
  }

  const style = pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined;

  return (
    <aside ref={boxRef} className={`ceo-ai-float ${collapsed ? "ceo-ai-collapsed" : ""}`} style={style} aria-label="AI assistant">
      <AiStyles />
      <header className="ceo-ai-head" onPointerDown={startDrag} onPointerMove={drag} onPointerUp={endDrag} onPointerCancel={endDrag}
        title="Drag to move">
        <b>✦ AI summary &amp; notes</b>
        <button type="button" className="ceo-ai-icon" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? "Expand" : "Collapse"}>
          {collapsed ? "▴" : "▾"}
        </button>
      </header>

      {!collapsed && (
        <div className="ceo-ai-body">
          <section>
            <h4>Summary</h4>
            {thread.summary ? <p>{thread.summary}</p> : <p className="ceo-muted">No stored summary yet. Use Quick summary.</p>}
          </section>

          {thread.key_points?.length > 0 && (
            <section>
              <h4>Key points</h4>
              <ul className="ceo-ai-points">{thread.key_points.map((p, i) => {
                const isSaved = savedFacts.some((fact) => fact.thread_id === thread.id && fact.fact === p);
                return (
                  <li key={i}>
                    <span>{p}</span>
                    <button className="ceo-text-btn" type="button" disabled={isSaved} onClick={() => onSaveFact(thread, p)}>
                      {isSaved ? "Saved" : "Save"}
                    </button>
                  </li>
                );
              })}</ul>
            </section>
          )}

          {thread.suggested_actions?.length > 0 && (
            <section>
              <h4>Suggested actions</h4>
              <div className="ceo-ai-actions">
                {thread.suggested_actions.map((a, i) => (
                  <button key={i} type="button" className="ceo-chip" onClick={() => onAddAction(thread, a)}>
                    + {a.type === "reply" ? "Reply" : a.type}: {a.title}{a.due ? ` (${when(a.due)})` : ""}
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="ceo-ai-ask">
            <h4>Ask AI <small>via OpenRouter</small></h4>
            <div className="ceo-ai-modes">
              {MODES.map((m) => (
                <button key={m.id} type="button" className="ceo-ai-mode" disabled={!!busy} onClick={() => assist(m.id, m.label)}>
                  {busy === m.id ? "Working…" : m.label}
                </button>
              ))}
            </div>
            <form className="ceo-ai-question" onSubmit={(e) => { e.preventDefault(); assist("ask", "Answer"); }}>
              <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={1000} disabled={!!busy}
                placeholder="Ask about this email, e.g. what fee did they quote?" aria-label="Question about this email" />
              <button type="submit" className="ceo-ai-mode" disabled={!!busy || !question.trim()}>{busy === "ask" ? "…" : "Ask"}</button>
            </form>
            {error && <p className="ceo-notice ceo-error" role="alert">{error}</p>}
            {result && (
              <div className="ceo-ai-result">
                <b>{result.title}</b>
                <pre>{result.text}</pre>
                <div className="ceo-ai-result-tools">
                  <button type="button" className="ceo-text-btn" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
                  <button type="button" className="ceo-text-btn" onClick={() => onSaveFact(thread, result.text.slice(0, 2000))}>Save to memory</button>
                </div>
              </div>
            )}
            <small className="ceo-muted">The conversation text is sent to OpenRouter for this answer. Nothing is emailed.</small>
          </section>
        </div>
      )}
    </aside>
  );
}

function AiStyles() {
  return (
    <style>{`
      .ceo-ai-float { position: fixed; right: 24px; bottom: 24px; z-index: 1002; width: min(360px, calc(100vw - 32px)); max-height: min(70vh, 640px); display: flex; flex-direction: column; background: rgba(255,255,255,.97); border: 1px solid #d5e5e4; border-radius: 12px; box-shadow: 0 18px 48px rgba(15,23,42,.28); }
      .ceo-ai-collapsed { max-height: none; }
      .ceo-ai-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 9px 12px; background: #0d7d82; color: #fff; border-radius: 11px 11px 0 0; cursor: move; user-select: none; touch-action: none; }
      .ceo-ai-collapsed .ceo-ai-head { border-radius: 11px; }
      .ceo-ai-head b { font-size: 13px; }
      .ceo-ai-icon { background: rgba(255,255,255,.18); border: 0; color: #fff; width: 26px; height: 26px; border-radius: 6px; cursor: pointer; font-size: 13px; }
      .ceo-ai-body { overflow: auto; display: grid; gap: 12px; padding: 12px; font-size: 12.5px; color: #374151; }
      .ceo-ai-body h4 { margin: 0 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #0b6b70; }
      .ceo-ai-body h4 small { text-transform: none; letter-spacing: 0; color: #9ca3af; font-weight: 400; }
      .ceo-ai-body p { margin: 0; line-height: 1.5; }
      .ceo-ai-points { margin: 0; padding-left: 16px; display: grid; gap: 4px; }
      .ceo-ai-points li span { margin-right: 6px; }
      .ceo-ai-actions, .ceo-ai-modes { display: flex; flex-wrap: wrap; gap: 6px; }
      .ceo-ai-mode { font: inherit; font-size: 12px; padding: 5px 10px; border: 1px solid #99d5d2; border-radius: 999px; background: #e6f4f3; color: #0b6b70; cursor: pointer; }
      .ceo-ai-mode:disabled { opacity: .6; cursor: default; }
      .ceo-ai-ask { display: grid; gap: 8px; }
      .ceo-ai-question { display: flex; gap: 6px; }
      .ceo-ai-question input { flex: 1; min-width: 0; font: inherit; font-size: 12.5px; padding: 6px 9px; border: 1px solid #d1d5db; border-radius: 7px; }
      .ceo-ai-result { display: grid; gap: 4px; padding: 9px; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; }
      .ceo-ai-result pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; font-size: 12.5px; line-height: 1.5; }
      .ceo-ai-result-tools { display: flex; gap: 12px; }
    `}</style>
  );
}
