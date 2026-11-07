import { useRef, useState } from "react";

// The closed BD Agent tab on the right edge. Drag it up or down to move it out of the way; a click without
// dragging opens the agent. Arrow keys move it too. The spot is kept in this browser as a share of the window height.
const KEY = "bd-agent-tab-top";
const MIN = 8;
const MAX = 92;
const clamp = (value) => Math.min(MAX, Math.max(MIN, value));

function savedTop() {
  try {
    const value = Number(localStorage.getItem(KEY));
    return Number.isFinite(value) && value > 0 ? clamp(value) : 50;
  } catch {
    return 50;
  }
}

function save(value) {
  try { localStorage.setItem(KEY, String(value)); } catch { /* storage off: the spot lasts until reload */ }
}

export default function BdAgentTab({ onOpen }) {
  const [top, setTop] = useState(savedTop);
  const drag = useRef(null);

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    drag.current = { startY: event.clientY, startTop: top, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event) => {
    const d = drag.current;
    if (!d) return;
    const dy = event.clientY - d.startY;
    if (!d.moved && Math.abs(dy) < 5) return;
    d.moved = true;
    setTop(clamp(d.startTop + (dy / window.innerHeight) * 100));
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) save(top);
    else onOpen();
  };

  const onKeyDown = (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const next = clamp(top + (event.key === "ArrowUp" ? -4 : 4));
    setTop(next);
    save(next);
  };

  return (
    <button
      type="button"
      className="bd-agent-tab"
      style={{ top: `${top}%` }}
      title="Click to open. Drag up or down to move."
      aria-label="Open BD Agent. Use the up and down arrow keys to move this tab."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { drag.current = null; }}
      onKeyDown={onKeyDown}
      onClick={(event) => { if (event.detail === 0) onOpen(); }}
    >
      <span aria-hidden="true" className="bd-agent-tab-grip">⋮⋮</span>
      BD Agent
    </button>
  );
}
