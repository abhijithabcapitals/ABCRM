// The client field used across the CRM: a searchable list showing each client's code and name.
// Search by code, name, licence, TRN, email or phone. mode "name" gives the name and still accepts a new name typed by
// hand; mode "code" gives the Client ID, for screens that link to a Client Master record.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useClientLookup } from "./ClientLookup";
import { pickerRows, searchClients } from "../logic/clientLookup";
import "./ClientPicker.css";

const SHOWN = 50;
const same = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

export default function ClientPicker({ id, value, onChange, clients, mode = "name", required, disabled, placeholder, style }) {
  const loaded = useClientLookup(clients === undefined);
  const source = clients === undefined ? loaded : clients;
  const rows = useMemo(() => { const all = pickerRows(source); return mode === "code" ? all.filter((c) => c.ref) : all; }, [source, mode]);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false); // on opening, show the whole list rather than only the current client
  const [active, setActive] = useState(-1);
  const [box, setBox] = useState(null);
  const input = useRef(null);
  const list = useRef(null);

  const hits = useMemo(() => searchClients(rows, typed ? value : ""), [rows, typed, value]);
  const shown = hits.slice(0, SHOWN);
  const chosen = useMemo(() => (value ? rows.find((c) => (mode === "code" ? same(c.ref, value) : same(c.name, value))) : null), [rows, value, mode]);
  const listId = `${id}-options`;

  useEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const r = input.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom;
      const up = below < 220 && r.top > below;
      const width = Math.max(r.width, 420);
      setBox({ left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), width, ...(up ? { bottom: window.innerHeight - r.top + 4, maxHeight: r.top - 16 } : { top: r.bottom + 4, maxHeight: below - 16 }) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);

  useEffect(() => { if (active >= 0) list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);

  const choose = (c) => { onChange(mode === "code" ? String(c.ref) : c.name, c); setOpen(false); setTyped(false); setActive(-1); };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      if (shown.length) setActive((a) => (e.key === "ArrowDown" ? (a + 1) % shown.length : (a <= 0 ? shown.length : a) - 1));
    } else if (e.key === "Enter" && open) {
      const c = shown[active] || (typed && shown.length === 1 ? shown[0] : null); // a full code typed then Enter picks it
      e.preventDefault(); // with the list open, Enter answers the list; the next Enter submits the form
      if (c) choose(c); else setOpen(false);
    } else if (e.key === "Escape" && open) {
      e.stopPropagation(); // close the list, not the form around it
      setOpen(false);
    } else if (e.key === "Tab") setOpen(false);
  };

  return (
    <>
      <input ref={input} id={id} type="text" role="combobox" autoComplete="off" aria-autocomplete="list" aria-expanded={open} aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined} value={value ?? ""} required={required} disabled={disabled} style={style}
        placeholder={placeholder || (mode === "code" ? "Search by client code or name" : "Search by client code or name, or type a new name")}
        onFocus={() => { setOpen(true); setTyped(false); setActive(-1); }} onClick={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKeyDown}
        onChange={(e) => { setTyped(true); setOpen(true); setActive(-1); onChange(e.target.value, null); }} />
      <small className="cp-note">{chosen ? (mode === "code" ? chosen.name : chosen.ref ? `Client code ${chosen.ref}` : "No client code yet") : ""}</small>
      {open && !disabled && box && createPortal(
        <div ref={list} id={listId} role="listbox" className="cp-list" style={box} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }} onClick={(e) => e.stopPropagation()}>
          {shown.map((c, i) => {
            const extra = [c.trade_name && !same(c.trade_name, c.name) ? c.trade_name : null, c.license ? `Licence ${c.license}` : null].filter(Boolean).join(" · ");
            return (
              <div key={`${c.rank ?? ""}-${c.ref ?? ""}-${c.id ?? ""}-${c.name}-${i}`} id={`${listId}-${i}`} data-i={i} role="option" aria-selected={i === active} className={`cp-row${i === active ? " is-active" : ""}`} onMouseEnter={() => setActive(i)} onClick={() => choose(c)}>
                <span className={`cp-code${c.ref ? "" : " is-none"}`}>{c.ref || "No code"}</span>
                <span className="cp-text"><strong>{c.name}</strong>{extra && <small>{extra}</small>}</span>
              </div>
            );
          })}
          {!shown.length && <div className="cp-empty">{rows.length ? (mode === "code" ? "No client matches." : "No client matches. This name will be kept as typed.") : "No clients available to you."}</div>}
          {hits.length > SHOWN && <div className="cp-empty">Showing {SHOWN} of {hits.length}. Type to narrow the list.</div>}
        </div>, document.body)}
    </>
  );
}
