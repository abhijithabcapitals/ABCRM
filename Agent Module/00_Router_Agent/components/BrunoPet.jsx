import { Component, lazy, Suspense, useEffect, useState } from "react";
import { DEFAULT_NAME, NAME_CHANGED } from "../logic/agentName.js";
import "./Bruno.css";

const BrunoPanel = lazy(() => import("./BrunoPanel.jsx"));

// After a release, a tab left open can fail to load the panel's file. The pet collapses and the page keeps working.
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

export function PetFace({ size = 44 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path d="M10 12c-5 1-7 9-5 16 1 3 5 3 6-1l2-11z" fill="#7a4f2b" />
      <path d="M38 12c5 1 7 9 5 16-1 3-5 3-6-1l-2-11z" fill="#7a4f2b" />
      <circle cx="24" cy="25" r="16" fill="#c98f58" />
      <ellipse cx="24" cy="32" rx="9" ry="7" fill="#f3e2cd" />
      <circle cx="18" cy="22" r="2.4" fill="#2b1d12" />
      <circle cx="30" cy="22" r="2.4" fill="#2b1d12" />
      <ellipse cx="24" cy="29" rx="3" ry="2.2" fill="#2b1d12" />
      <path d="M24 31v3m-4 0c1 2 7 2 8 0" stroke="#2b1d12" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

// The person's agent: a small pet in the corner on every page. The chat panel loads the first time it opens.
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
  return (
    <button type="button" className="bruno-pet" aria-label={`Open ${name}`} onClick={() => toggle(true)}>
      <PetFace />
      <span className="bruno-pet-name">{name}</span>
    </button>
  );
}
