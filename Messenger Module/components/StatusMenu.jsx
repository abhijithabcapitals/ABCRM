import { useEffect, useRef, useState } from "react";
import { STATUSES, presenceLabel } from "../logic/parity.js";
import { initials } from "../logic/chat.js";

// The signed-in person's initials and status dot; opens a menu to change the status.
export default function StatusMenu({ name, status, onStatus }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className="abm-status" ref={box}>
      <button type="button" className="abm-me" aria-haspopup="true" aria-expanded={open} aria-label={`${name || "You"}, ${presenceLabel(status)}. Change status`} onClick={() => setOpen(!open)}>
        {initials(name || "You")}
        <span className={`abm-dot abm-dot-${status}`} aria-hidden="true" />
      </button>
      {open && (
        <ul className="abm-status-menu">
          {STATUSES.map((s) => (
            <li key={s.key}>
              <button type="button" aria-current={s.key === status ? "true" : undefined} onClick={() => { onStatus(s.key); setOpen(false); }}>
                <span className={`abm-dot-inline abm-dot-${s.key}`} aria-hidden="true" />{s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
