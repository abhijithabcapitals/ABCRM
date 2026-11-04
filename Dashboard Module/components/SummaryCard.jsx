import { useCallback, useEffect, useRef, useState } from "react";

const Icon = ({ d }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

function Shimmer() {
  return (
    <div className="sum-shimmer" aria-label="Loading" role="status">
      <span style={{ width: "40%", height: 22 }} />
      <span style={{ width: "100%" }} />
      <span style={{ width: "72%" }} />
    </div>
  );
}

// Title bar, collapse and move controls, plus loading, error and no-access states for the body.
// The body is only asked for once the card is first expanded; collapsing keeps what was loaded.
export default function SummaryCard({ card, collapsed, onToggle, onMove, first, last, dragHandlers, load, onOpen, children }) {
  const [state, setState] = useState({ status: "loading" });
  const started = useRef(false);

  const request = useCallback(() => {
    Promise.resolve()
      .then(() => load())
      .then((data) => setState({ status: "data", data }), (error) => setState({ status: "error", error }));
  }, [load]);

  useEffect(() => {
    if (collapsed || started.current) return;
    started.current = true;
    request();
  }, [collapsed, request]);

  const retry = () => {
    setState({ status: "loading" });
    request();
  };

  const opener = onOpen
    ? {
        role: "button",
        tabIndex: 0,
        "aria-label": `Open ${card.title}`,
        onClick: onOpen,
        onKeyDown: (e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          onOpen();
        },
      }
    : {};

  return (
    <div className={`sum-card${collapsed ? " is-collapsed" : ""}`}>
      <div className="sum-head">
        <span className="sum-grip" title="Drag to rearrange" aria-hidden="true" {...dragHandlers}>
          <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor"><circle cx="2" cy="2" r="1.5" /><circle cx="8" cy="2" r="1.5" /><circle cx="2" cy="8" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="2" cy="14" r="1.5" /><circle cx="8" cy="14" r="1.5" /></svg>
        </span>
        <button type="button" className="sum-toggle" aria-expanded={!collapsed} onClick={onToggle}>
          <span className="sum-chevron"><Icon d="M6 9l6 6 6-6" /></span>
          <span className="sum-title">{card.title}</span>
        </button>
        <button type="button" className="sum-step" aria-label={`Move ${card.title} up`} disabled={first} onClick={() => onMove(-1)}><Icon d="M12 19V5M6 11l6-6 6 6" /></button>
        <button type="button" className="sum-step" aria-label={`Move ${card.title} down`} disabled={last} onClick={() => onMove(1)}><Icon d="M12 5v14M6 13l6 6 6-6" /></button>
      </div>
      <div className="sum-fold">
        <div className="sum-fold-inner" inert={collapsed}>
          {state.status === "loading" && <Shimmer />}
          {state.status === "error" && state.error?.noAccess && <div className="sum-note">No access to this data</div>}
          {state.status === "error" && !state.error?.noAccess && (
            <div className="sum-note sum-error">
              <span>{state.error?.message || "Could not load this card"}</span>
              <button type="button" className="sum-link" onClick={retry}>Retry</button>
            </div>
          )}
          {state.status === "data" && (
            <div className={`sum-body${onOpen ? " is-link" : ""}`} {...opener}>{children(state.data)}</div>
          )}
        </div>
      </div>
    </div>
  );
}
