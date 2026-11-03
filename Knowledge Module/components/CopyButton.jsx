import { useState } from "react";
import { Button } from "@banking/components/shared";
import { canCopy, needsConfirm } from "../logic/copyText.js";

// item: { visibility, status } deciding whether the copy is allowed. text: the plain text to copy.
// Renders nothing for Internal items or empty text. A Draft item needs the tick before anything is written.
export default function CopyButton({ item, text }) {
  const [ticked, setTicked] = useState(false);
  const [result, setResult] = useState(null);
  if (!canCopy(item) || !text) return null;
  const confirm = needsConfirm(item);

  const copy = async () => {
    if (confirm && !ticked) return;
    setResult(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("This browser does not allow copying.");
      await navigator.clipboard.writeText(text);
      setTicked(false); // the next copy is a fresh confirmation
      setResult({ ok: true });
    } catch (e) {
      setResult({ error: `Could not copy: ${e.message || "clipboard blocked"}` });
    }
  };

  return (
    <div className="kn-copy">
      {confirm && (
        <label className="bk-check">
          <input type="checkbox" checked={ticked} onChange={(e) => { setTicked(e.target.checked); setResult(null); }} />
          I have checked this price.
        </label>
      )}
      <Button disabled={confirm && !ticked} onClick={copy}>Copy</Button>
      {result?.ok && <span className="kn-copied" role="status">Copied</span>}
      {result?.error && <span className="kn-error" role="alert">{result.error}</span>}
    </div>
  );
}
