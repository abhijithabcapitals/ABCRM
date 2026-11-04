import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ErrorNote } from "@banking/components/shared";
import {
  KIND_LABEL, LINK_READ_FAILED, NO_MASTER, NO_MATCH, NO_QUOTE, callZoho, canReissue, contactLine, contactLinkable, createRights, formatAmount, linkContact,
  makeGuard, openPdf, panelMode, panelNotes, replaceQuestion, rowActions, rowNotes, safeZohoUrl,
} from "../logic/zohoPanel";

// The Zoho step on a quote: link the client's Zoho contact, make draft estimates and invoices, and read them back.
// It never blocks the handover buttons. When Zoho is down or not connected, the rest of the screen works as before.
// Nothing is read from Zoho until staff press Show Zoho details.
const Note = ({ tone, children }) => <div className={`bk-alert bk-alert-${tone}`} role="note">{children}</div>;

export default function ZohoPanel({ supabase, department, sourceTable, sourceId, clientId, kinds = ["estimate", "invoice"], canCreate, noSourceNote, onChanged }) {
  const rights = createRights(canCreate);
  const [opened, setOpened] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState({ connected: undefined, readError: null });
  const [rows, setRows] = useState({});
  const [link, setLink] = useState({ known: false, linked: false, name: "", failed: false });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(null);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState(null);
  const [replace, setReplace] = useState(null);
  const busyNow = useRef(false);
  // scope changes when the panel goes away or its quote changes; loads counts reads of the state.
  const scope = useRef(makeGuard());
  const loads = useRef(makeGuard());
  const call = useCallback((body) => callZoho(supabase, body), [supabase]);
  // The screen around the panel is told once when a reply says the job was changed by the read-back.
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const load = useCallback(async (force) => {
    const inScope = scope.current.token();
    const mine = loads.current.next();
    const current = () => scope.current.valid(inScope) && loads.current.valid(mine);
    setLoading(true); setError(null);
    try {
      const out = await call({ action: "document_state", source_table: sourceTable, source_id: sourceId, force: !!force });
      // A newer read does not undo the change, so this is told even when a later read has started.
      if (out.job_changed === true && scope.current.valid(inScope)) changed.current?.();
      if (!current()) return;
      setRows(Object.fromEntries((out.rows || []).map((r) => [r.kind, r])));
      setInfo({ connected: out.connected, readError: out.read_error || null });
      setLoaded(true);
      if (out.connected !== false && clientId) {
        try {
          const c = await call({ action: "contact_get", client_id: clientId, department });
          if (!current()) return;
          setLink({ known: true, linked: !!c.linked, name: c.zoho_contact_name || "", failed: false });
        } catch {
          if (current()) setLink({ known: false, linked: false, name: "", failed: true });
        }
      }
    } catch (e) {
      if (current()) setError(e.message);
    } finally {
      if (current()) setLoading(false);
    }
  }, [call, sourceTable, sourceId, clientId, department]);

  useEffect(() => {
    const guard = scope.current;
    return () => { guard.next(); };
  }, [sourceId, clientId]);

  const show = () => { setOpened(true); load(false); };

  // One action at a time. The ref stops a double click in the same tick, before state updates.
  async function run(key, fn) {
    if (busyNow.current) return;
    busyNow.current = true;
    const inScope = scope.current.token();
    setBusy(key); setError(null);
    try {
      await fn(() => !scope.current.valid(inScope));
    } catch (e) {
      if (scope.current.valid(inScope)) setError(e.message);
    } finally {
      busyNow.current = false;
      if (scope.current.valid(inScope)) setBusy("");
    }
  }

  const search = () => run("search", async (stale) => {
    const out = await call({ action: "contacts_search", query: query.trim(), department });
    if (!stale()) setFound(out.contacts || []);
  });

  const saveLink = (contact, replaceIt) => run(`link-${contact.id}`, async (stale) => {
    const out = await linkContact({ call, clientId, department, contact, replace: replaceIt });
    if (stale()) return;
    if (out.status === "needs_replace") { setReplace({ contact, currentName: out.currentName }); return; }
    setReplace(null); setPicking(false); setFound(null); setQuery("");
    setLink({ known: true, linked: true, name: out.name, failed: false });
  });

  const create = (kind) => run(`create-${kind}`, async (stale) => {
    const out = await call({ action: "document_create", source_table: sourceTable, source_id: sourceId, kind });
    if (stale()) return;
    if (out.job_changed === true) changed.current?.();
    if (out.needs_contact) {
      setLink({ known: true, linked: false, name: "", failed: false });
      setError("Link the Zoho contact for this client first.");
      return;
    }
    setRows((r) => ({ ...r, [kind]: { ...out, kind } }));
  });

  // The tab opens on the click itself, so pop-up blockers allow it. It is pointed at the file once that arrives.
  const viewPdf = (kind) => run(`pdf-${kind}`, async (stale) => {
    const res = await openPdf({
      openTab: () => window.open("", "_blank"),
      fetchPdf: () => call({ action: "document_pdf", source_table: sourceTable, source_id: sourceId, kind }),
      makeUrl: (blob) => URL.createObjectURL(blob),
      revoke: (url) => URL.revokeObjectURL(url),
      later: (fn, ms) => setTimeout(fn, ms),
      isStale: stale,
    });
    if (!res.ok && !res.stale) throw new Error(res.message);
  });

  if (!sourceId) return <div className="bk-note">{noSourceNote || NO_QUOTE}</div>;

  if (!opened) {
    return (
      <div className="bk-note bk-actions bk-wrap">
        <strong>Zoho draft</strong>
        <button type="button" className="bk-link" onClick={show}>Show Zoho details</button>
      </div>
    );
  }

  const working = !!busy || loading;
  const connected = info.connected;
  const linkedOk = link.known && link.linked;
  const canLink = rights.estimate && !!clientId && !link.failed;
  const showContact = loaded && connected !== false;

  return (
    <div className="bk-mt">
      <ErrorNote message={error} />
      {loaded && panelNotes({ connected, readError: info.readError }).map((n) => <Note key={n.text} tone={n.tone}>{n.text}</Note>)}

      {showContact && (
        <div className="bk-note">
          {!clientId ? NO_MASTER : link.failed ? LINK_READ_FAILED : linkedOk ? <>Zoho contact: <strong>{link.name}</strong>{" "}</> : "No Zoho contact is linked to this client yet. "}
          {canLink && !picking && <button type="button" className="bk-link" disabled={working} onClick={() => setPicking(true)}>{linkedOk ? "Change" : "Find in Zoho"}</button>}
          {!canLink && !linkedOk && !link.failed && clientId ? "Someone who manages this must link it." : null}
        </div>
      )}

      {showContact && picking && canLink && (
        <div className="bk-note-line">
          <label>Search Zoho by name
            <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && query.trim() && !working) search(); }} />
          </label>
          <Button busy={busy === "search"} disabled={working || !query.trim()} onClick={search}>Search</Button>
          <Button disabled={working} onClick={() => { setPicking(false); setFound(null); setReplace(null); }}>Cancel</Button>
        </div>
      )}

      {showContact && picking && found && !found.length && <p className="bk-note">{NO_MATCH}</p>}
      {showContact && picking && found && found.map((c) => (
        <div className="bk-row" key={c.id}>
          <span>{contactLine(c)}{!contactLinkable(c) && <span className="bk-muted"> (not AED, cannot be linked)</span>}</span>
          <Button busy={busy === `link-${c.id}`} disabled={working || !contactLinkable(c)} onClick={() => saveLink(c, false)}>Link</Button>
        </div>
      ))}

      {replace && (
        <Note tone="warn">
          <span>{replaceQuestion(replace.currentName)}</span>
          <span className="bk-actions">
            <Button disabled={working} busy={busy === `link-${replace.contact.id}`} onClick={() => saveLink(replace.contact, true)}>Replace</Button>
            <Button disabled={working} onClick={() => setReplace(null)}>Keep</Button>
          </span>
        </Note>
      )}

      {loaded && kinds.map((kind) => {
        const row = rows[kind];
        const mode = panelMode({ connected, linked: linkedOk, row });
        if (mode === "needs_contact" || mode === "not_connected") return null;
        const url = safeZohoUrl(row?.url);
        const actions = rowActions(mode, { canCreate: rights[kind], connected, linked: linkedOk, hasUrl: !!url, reissue: canReissue(sourceTable, row) });
        const name = KIND_LABEL[kind];
        return (
          <div className="bk-mt" key={kind}>
            <div className="bk-actions bk-wrap">
              <strong>{mode === "created" ? `${name} ${row.zoho_number || ""}`.trim() : name}</strong>
              {mode === "created" && row.zoho_status && <span className="bk-muted">{row.zoho_status}</span>}
              {mode === "created" && kind === "invoice" && row.balance != null && <span className="bk-muted">Balance AED {formatAmount(row.balance)}</span>}
              {mode === "ready" && <span className="bk-muted">No draft yet</span>}
              {mode === "failed" && <span className="bk-muted">Not created</span>}
              {mode === "unknown" && <span className="bk-muted">Not confirmed</span>}
              {mode === "gone" && <span className="bk-muted">No longer in Zoho</span>}
              {actions.create && <Button disabled={working} busy={busy === `create-${kind}`} onClick={() => create(kind)}>{actions.create}</Button>}
              {actions.viewPdf && <button type="button" className="bk-link" disabled={working} onClick={() => viewPdf(kind)}>{busy === `pdf-${kind}` ? "Opening…" : "View PDF"}</button>}
              {actions.openZoho && <a className="bk-link" href={url} target="_blank" rel="noopener noreferrer">Open in Zoho</a>}
            </div>
            {rowNotes(row, mode).map((n) => <Note key={n.text} tone={n.tone}>{n.text}</Note>)}
          </div>
        );
      })}

      {(loaded || error) && (
        <div className="bk-mt">
          <button type="button" className="bk-link" disabled={working} onClick={() => load(true)}>{loading ? "Refreshing…" : "Refresh"}</button>
        </div>
      )}
      {loading && !loaded && <p className="bk-note">Checking Zoho…</p>}
    </div>
  );
}
