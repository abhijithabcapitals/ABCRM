import { useState } from "react";
import { checkBody } from "../logic/chat.js";

// Draft text is owned by the panel so it survives switching chats. attachSlot is filled by the attach picker:
// a node, or a function given { link, setLink } to show the chosen record and let it be cleared.
export default function Composer({ conversationId, draft, onDraft, onSend, attachSlot }) {
  const [problem, setProblem] = useState("");
  const [link, setLink] = useState(null);

  function submit() {
    const bad = checkBody(draft);
    if (bad) { setProblem(bad); return; }
    setProblem("");
    onSend(draft.trim(), link);
    onDraft("");
    setLink(null);
  }

  function onKey(e) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="msgr-composer">
      {problem && <p className="msgr-problem" role="alert">{problem}</p>}
      <div className="msgr-composer-row">
        {typeof attachSlot === "function" ? attachSlot({ link, setLink }) : attachSlot}
        <textarea
          key={conversationId}
          className="msgr-input"
          rows={1}
          placeholder="Write a message"
          aria-label="Message"
          value={draft}
          onChange={(e) => { onDraft(e.target.value); if (problem) setProblem(""); }}
          onKeyDown={onKey}
        />
        <button type="button" className="msgr-send" onClick={submit}>Send</button>
      </div>
    </div>
  );
}
