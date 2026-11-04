import { useRef, useState } from "react";
import { checkBody } from "../logic/chat.js";
import { applyMention, fileProblem, membersMatching, mentionIdsIn, mentionQuery } from "../logic/parity.js";

// Draft text is owned by the panel so it survives switching chats. attachSlot is filled by the attach picker:
// a node, or a function given { link, setLink } to show the chosen record and let it be cleared.
export default function Composer({ conversationId, draft, onDraft, onSend, attachSlot, members = [], me, replyTo, replyName, onCancelReply, onFile }) {
  const [problem, setProblem] = useState("");
  const [link, setLink] = useState(null);
  const [query, setQuery] = useState(null); // the @ name being typed
  const [active, setActive] = useState(0);
  const input = useRef(null);
  const picker = useRef(null);
  const matches = query === null ? [] : membersMatching(members, query, me);

  function submit() {
    // A link with no typed text sends the link's label as the body, which the database requires.
    const text = draft.trim() || (link ? link.label : "");
    const bad = checkBody(text);
    if (bad) { setProblem(bad); return; }
    setProblem("");
    onSend(text, link, { mentionIds: mentionIdsIn(text, members).filter((id) => id !== me), parentId: replyTo?.id });
    onDraft("");
    setLink(null);
    setQuery(null);
    onCancelReply?.();
  }

  function choose(member) {
    const caret = input.current?.selectionStart ?? draft.length;
    const next = applyMention(draft, caret, member.full_name);
    onDraft(next.text);
    setQuery(null);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(next.caret, next.caret);
    });
  }

  function onKey(e) {
    if (matches.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((active + 1) % matches.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActive((active - 1 + matches.length) % matches.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(matches[Math.min(active, matches.length - 1)]); return; }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setQuery(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  function pickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const bad = fileProblem(file);
    if (bad) { setProblem(bad); return; }
    setProblem("");
    onFile(file, replyTo?.id);
    onCancelReply?.();
  }

  return (
    <div className="msgr-composer">
      {problem && <p className="msgr-problem" role="alert">{problem}</p>}
      {replyTo && (
        <div className="msgr-replying">
          <span className="msgr-replying-text">Replying to {replyName}: {replyTo.body}</span>
          <button type="button" className="msgr-link" onClick={onCancelReply}>Cancel</button>
        </div>
      )}
      {matches.length > 0 && (
        <ul className="msgr-mentions" role="listbox" aria-label="Mention someone">
          {matches.map((m, i) => (
            <li key={m.profile_id} role="option" aria-selected={i === active}>
              <button type="button" className={`msgr-mention-pick${i === active ? " msgr-mention-on" : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(m)}>{m.full_name}</button>
            </li>
          ))}
        </ul>
      )}
      <div className="msgr-composer-row">
        {typeof attachSlot === "function" ? attachSlot({ link, setLink }) : attachSlot}
        {onFile && (
          <>
            <input ref={picker} type="file" className="msgr-file-input" tabIndex={-1} aria-hidden="true" onChange={pickFile} />
            <button type="button" className="msgr-file-btn" aria-label="Share a file" title="Share a file, up to 25 MB" onClick={() => picker.current?.click()}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m21 11-8.500 8.500a5.500 5.500 0 0 1-7.800-7.800l9-9a3.700 3.700 0 0 1 5.200 5.200l-9 9a1.800 1.800 0 0 1-2.600-2.600l8.500-8.500" /></svg>
            </button>
          </>
        )}
        <textarea
          key={conversationId}
          ref={input}
          className="msgr-input"
          rows={1}
          placeholder="Write a message"
          aria-label="Message"
          value={draft}
          onChange={(e) => {
            onDraft(e.target.value);
            setQuery(mentionQuery(e.target.value, e.target.selectionStart));
            setActive(0);
            if (problem) setProblem("");
          }}
          onKeyDown={onKey}
        />
        <button type="button" className="msgr-send" onClick={submit}>Send</button>
      </div>
    </div>
  );
}
