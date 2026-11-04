import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ErrorNote } from "@banking/components/shared";
import {
  KIND_LABEL, NO_MASTER, NO_MATCH, NO_QUOTE, contactLine, contactLinkable, createRights, formatAmount, panelMode, panelNotes, pdfReply,
  replaceQuestion, rowActions, rowNotes,
} from "../logic/zohoPanel";

// The Zoho step on a quote: link the client's Zoho contact, make draft estimates and invoices, and read them back.
// It never blocks the handover buttons. When Zoho is down or not connected, the rest of the screen works as before.
async function call(supabase, body) {
  const { data, error } = await supabase.functions.invoke("zoho-books", { body });
  if (error) {
    let message = error.message;
    try { message = (await error.context?.json())?.error || message; } catch { /* keep message */ }
    throw new Error(message);
  }
  if (data && typeof data === "object" && typeof data.error === "string") throw new Error(data.error);
  return data;
}

const Note = ({ tone, children }) => <div className={`bk-alert bk-alert-${tone}`} role="note">{children}</div>;

export default function ZohoPanel({ supabase, department, sourceTable, sourceId, clientId, kinds = ["estimate", "invoice"], canCreate }) {
  const rights = createRights(canCreate);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState({ connected: undefined, readError: null });
  const [rows, setRows] = useState({});
  const [link, setLink] = useState({ known: false, linked: false, name: "" });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(null);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState(null);
  const [replace, setReplace] = useState(null);
  const seq = useRef(0);

  const load = useCallback(async (force) => {
    const mine = ++seq.current;
    setLoading(true); setError(null);
    try {
      const out = await call(supabase, { action: "document_state", source_table: sourceTable, source_id: sourceId, force: !!force });
      if (mine !== seq.current) return;
      setRows(Object.fromEntries((out.rows || []).map((r) => [r.kind, r])));
      setInfo({ connected: out.connected, readError: out.read_error || null });
      if (out.connected !== false && clientId) {
        const c = await call(supabase, { action: "contact_get", client_id: clientId, department });
        if (mine !== seq.current) return;
        setLink({ known: true, linked: !!c.linked, name: c.zoho_contact_name || "" });
      }
      setLoaded(true);
    } catch (e) {
      if (mine === seq.current) setError(e.message);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [supabase, sourceTable, sourceId, clientId, department]);

  useEffect(() => {
    if (sourceId) load(false);
    return () => { seq.current += 1; };
  }, [sourceId, load]);

  async function run(key, fn) {
    setBusy(key); setError(null);
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(""); }
  }

  const search = () => run("search", async () => {
    const out = await call(supabase, { action: "contacts_search", query: query.trim(), department });
    setFound(out.contacts || []);
  });

  const saveLink = (contact, replaceIt) => run(`link-${contact.id}`, async () => {
    const out = await call(supabase, { action: "contact_link", client_id: clientId, zoho_contact_id: contact.id, department, ...(replaceIt ? { replace: true } : {}) });
    if (out.needs_replace) { setReplace({ contact, currentName: out.current_name }); return; }
    setReplace(null); setPicking(false); setFound(null); setQuery("");
    setLink({ known: true, linked: true, name: out.zoho_contact_name || contact.name });
  });

  const create = (kind) => run(`create-${kind}`, async () => {
    const out = await call(supabase, { action: "document_create", source_table: sourceTable, source_id: sourceId, kind });
    if (out.needs_contact) {
      setLink({ known: true, linked: false, name: "" });
      setError("Link the Zoho contact for this client first.");
      return;
    }
    setRows((r) => ({ ...r, [kind]: { ...out, kind } }));
  });

  // The tab opens on the click itself, so pop-up blockers allow it. It is pointed at the file once that arrives.
  function viewPdf(kind) {
    const tab = window.open("", "_blank");
    if (!tab) { setError("Your browser blocked the new tab. Allow pop-ups for this site and try again."); return; }
    try { tab.opener = null; } catch { /* ignore */ }
    return run(`pdf-${kind}`, async () => {
      try {
        const data = await call(supabase, { action: "document_pdf", source_table: sourceTable, source_id: sourceId, kind });
        const reply = pdfReply(data);
        if (!reply.ok) throw new Error(reply.message);
        const url = URL.createObjectURL(data);
        tab.location.href = url;
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (e) {
        tab.close();
        throw e;
      }
    });
  }

  if (!sourceId) return <div className="bk-note">{NO_QUOTE}</div>;

  const working = !!busy || loading;
  const connected = info.connected;
  const linkedOk = link.known && link.linked;
  const canLink = rights.estimate && !!clientId;
  const showContact = loaded && connected !== false;

  return (
    <div className="bk-mt">
      <ErrorNote message={error} />
      {loaded && panelNotes({ connected, readError: info.readError }).map((n) => <Note key={n.text} tone={n.tone}>{n.text}</Note>)}

      {showContact && (
        <div className="bk-note">
          {!clientId ? NO_MASTER : linkedOk ? <>Zoho contact: <strong>{link.name}</strong>{" "}</> : "No Zoho contact is linked to this client yet. "}
          {canLink && !picking && <button type="button" className="bk-link" disabled={working} onClick={() => setPicking(true)}>{linkedOk ? "Change" : "Find in Zoho"}</button>}
          {!canLink && !linkedOk && clientId ? "Someone who manages this must link it." : null}
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
        const actions = rowActions(mode, { canCreate: rights[kind], connected, linked: linkedOk, hasUrl: !!row?.url });
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
              {actions.openZoho && <a className="bk-link" href={row.url} target="_blank" rel="noopener noreferrer">Open in Zoho</a>}
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
