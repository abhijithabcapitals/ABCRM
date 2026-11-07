import { Component, lazy, Suspense, useEffect, useRef, useState } from "react";
import { DEFAULT_NAME, NAME_CHANGED } from "../logic/agentName.js";
import "./Bruno.css";

const BrunoPanel = lazy(() => import("./BrunoPanel.jsx"));

// After a release, a tab left open can fail to load the panel's file. The dock closes and the page keeps working.
class PanelBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const OPEN_KEY = "bruno_open";
const TOP_KEY = "bruno-tab-top";
const MIN = 8;
const MAX = 92;
const clamp = (value) => Math.min(MAX, Math.max(MIN, value));

function readOpen() {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}
function saveOpen(open) {
  try {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch { /* being remembered is only a convenience */ }
}
function readTop() {
  try {
    const value = Number(localStorage.getItem(TOP_KEY));
    return Number.isFinite(value) && value > 0 ? clamp(value) : 50;
  } catch {
    return 50;
  }
}
function saveTop(value) {
  try {
    localStorage.setItem(TOP_KEY, String(value));
  } catch { /* storage off: the spot lasts until reload */ }
}

// The closed tab on the right edge. Drag it up or down to move it; a click without dragging opens the dock.
// Arrow keys move it too. The spot is kept in this browser as a share of the window height.
function BrunoTab({ name, onOpen }) {
  const [top, setTop] = useState(readTop);
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
    if (d.moved) saveTop(top);
    else onOpen();
  };
  const onKeyDown = (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const next = clamp(top + (event.key === "ArrowUp" ? -4 : 4));
    setTop(next);
    saveTop(next);
  };

  return (
    <button
      type="button"
      className="bruno-tab"
      style={{ top: `${top}%` }}
      title="Click to open. Drag up or down to move."
      aria-label={`Open ${name}. Use the up and down arrow keys to move this tab.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { drag.current = null; }}
      onKeyDown={onKeyDown}
      onClick={(event) => { if (event.detail === 0) onOpen(); }}
    >
      <span aria-hidden="true" className="bruno-tab-grip">⋮⋮</span>
      {name}
    </button>
  );
}

// The person's agent, docked on the right of every page. Closed, it leaves a tab on the edge.
// The chat panel loads the first time it opens.
export default function BrunoPet({ supabase }) {
  const [open, setOpen] = useState(readOpen);
  const [name, setName] = useState(DEFAULT_NAME);

  useEffect(() => {
    let live = true;
    supabase.rpc("router_my_agent_name").then(({ data }) => {
      if (live && data) setName(data);
    });
    const renamed = (e) => setName(e.detail);
    window.addEventListener(NAME_CHANGED, renamed);
    return () => {
      live = false;
      window.removeEventListener(NAME_CHANGED, renamed);
    };
  }, [supabase]);

  const toggle = (next) => {
    setOpen(next);
    saveOpen(next);
  };

  if (open) {
    return (
      <PanelBoundary onFail={() => toggle(false)}>
        <Suspense fallback={null}>
          <BrunoPanel supabase={supabase} name={name} onCollapse={() => toggle(false)} />
        </Suspense>
      </PanelBoundary>
    );
  }
  return <BrunoTab name={name} onOpen={() => toggle(true)} />;
}
