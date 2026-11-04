import { useEffect, useRef, useState } from "react";
import chatApi from "../services/chatClient.js";
import { checkWebLink } from "../logic/chat.js";

const KINDS = [["client", "Client"], ["lead", "Lead"], ["task", "Task"], ["web", "Web link"]];
const MAX_REF = 2000;
const MAX_LABEL = 300;

// Labels shown in the chat. A lead is only ever shown by its number, never by the prospect's name.
const labelFor = (kind, r) => (kind === "client" ? `Client ${r.ref}: ${r.label}` : kind === "lead" ? `Lead ${r.label}` : r.label);

// Fills Composer's attachSlot: a button that opens a small picker, and a chip for the chosen record.
// The picker renders in place (no portal) so clicks in it stay inside the panel.
export default function AttachPicker({ link, setLink }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("client");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [url, setUrl] = useState("");
  const clients = useRef(null); // one copy of the client list per opening of the picker

  // Search as the person types; an older answer arriving late is ignored.
  useEffect(() => {
    if (!open) { clients.current = null; return undefined; }
    if (kind === "web") return undefined;
    let stale = false;
    setBusy(true);
    setProblem("");
    const t = setTimeout(() => {
      let copy = Promise.resolve(undefined);
      if (kind === "client") {
        if (!clients.current) {
          const fetched = chatApi.clientLookup();
          clients.current = fetched;
          fetched.catch(() => { if (clients.current === fetched) clients.current = null; });
        }
        copy = clients.current;
      }
      copy.then((list) => chatApi.searchRecords(kind, query, list)).then(
        (list) => { if (!stale) { setResults(list); setBusy(false); } },
        () => { if (!stale) { setResults([]); setBusy(false); setProblem("Could not search. Please try again."); } },
      );
    }, 250);
    return () => { stale = true; clearTimeout(t); };
  }, [open, kind, query]);

  function pickKind(k) {
    setKind(k);
    setQuery("");
    setResults([]);
    setProblem("");
  }

  function choose(r) {
    setLink({ type: kind, ref: String(r.ref), label: labelFor(kind, r).slice(0, MAX_LABEL) });
    setOpen(false);
  }

  function addWeb() {
    const address = url.trim();
    const bad = checkWebLink(address) || (address.length > MAX_REF ? "That address is too long to share." : null);
    if (bad) { setProblem(bad); return; }
    setLink({ type: "web", ref: address, label: address.slice(0, MAX_LABEL) });
    setUrl("");
    setProblem("");
    setOpen(false);
  }

  return (
    <div className="msgr-attach-wrap">
      {link ? (
        <span className="msgr-chip">
          <span className="msgr-chip-text">{link.label}</span>
          <button type="button" className="msgr-chip-x" onClick={() => setLink(null)} aria-label="Remove attachment">×</button>
        </span>
      ) : (
        <button type="button" className="msgr-icon-btn" onClick={() => setOpen((v) => !v)} aria-label="Attach a record or link" aria-expanded={open}>+</button>
      )}
      {open && !link && (
        <div className="msgr-popover" role="dialog" aria-label="Attach">
          <div className="msgr-tabs">
            {KINDS.map(([k, name]) => (
              <button key={k} type="button" className={`msgr-tab${k === kind ? " msgr-tab-on" : ""}`} onClick={() => pickKind(k)}>{name}</button>
            ))}
          </div>
          {kind === "web" ? (
            <div className="msgr-pop-body">
              <input className="msgr-search" type="url" placeholder="https://" aria-label="Web address" value={url}
                onChange={(e) => { setUrl(e.target.value); setProblem(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addWeb(); } }} />
              <button type="button" className="msgr-send" onClick={addWeb}>Add link</button>
            </div>
          ) : (
            <div className="msgr-pop-body">
              <input className="msgr-search" type="search" placeholder="Search" aria-label="Search records" value={query} onChange={(e) => setQuery(e.target.value)} />
              <ul className="msgr-rows msgr-pick-rows">
                {results.map((r) => (
                  <li key={r.ref}><button type="button" className="msgr-row" onClick={() => choose(r)}><span className="msgr-row-title">{labelFor(kind, r)}</span></button></li>
                ))}
              </ul>
              {!busy && !problem && results.length === 0 && <p className="msgr-note">Nothing found</p>}
            </div>
          )}
          {problem && <p className="msgr-problem" role="alert">{problem}</p>}
        </div>
      )}
    </div>
  );
}
