import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtDate } from "@app/dateFormat";
import {
  CATEGORIES, STATUSES, STATUS_COLOURS, ALLOWED_TYPES, MAX_FILES, TITLE_MAX,
  addFiles, filterRows, formProblem, isImage, labelOf, namePasted,
} from "../logic/improvements.js";
import { createImprovement, deleteImprovement, listImprovements, reviewImprovement, signedUrls } from "../services/improvementsApi";
import "./improvements.css";

// The IMPROVEMENT page: every member writes ideas, problems and requests for the admin, with screenshots.
// A member sees their own and the admin's replies; an admin sees everyone's and sets a status and a reply.
export default function Improvements({ profile }) {
  const isAdmin = profile?.role === "admin";
  const [rows, setRows] = useState([]);
  const [urls, setUrls] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState(isAdmin ? "open" : "all");

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await listImprovements();
      setRows(data || []);
      const paths = (data || []).flatMap((r) => (r.attachments || []).map((a) => a.path));
      setUrls(await signedUrls(paths));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => filterRows(rows, filter), [rows, filter]);
  const newCount = rows.filter((r) => r.status === "new").length;

  return (
    <div className="imp-page">
      <div className="page-header">
        <div>
          <div className="page-title">Improvement</div>
          <div className="page-subtitle">
            {isAdmin ? "What the team has shared with you. Set a status and reply to each one." : "Share ideas, problems or requests with the admin. Add screenshots so they can see what you mean."}
          </div>
        </div>
        {isAdmin && newCount > 0 && <span className="imp-new-count">{newCount} new</span>}
      </div>

      <div className="imp-body">
        <NewImprovement profile={profile} onCreated={load} />

        <div className="imp-list-head">
          <h3>{isAdmin ? "All improvements" : "What you have shared"}</h3>
          <select className="imp-select" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by status">
            <option value="all">All</option>
            <option value="open">Open</option>
            {STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>

        {error && <div className="imp-error">{error}</div>}
        {loading ? (
          <div className="imp-empty">Loading…</div>
        ) : shown.length === 0 ? (
          <div className="imp-empty">{rows.length ? "Nothing matches this filter." : isAdmin ? "No one has shared an improvement yet." : "You have not shared anything yet."}</div>
        ) : (
          shown.map((row) => (
            <ImprovementCard key={row.id} row={row} urls={urls} isAdmin={isAdmin} isMine={row.created_by === profile?.id} onChanged={load} />
          ))
        )}
      </div>
    </div>
  );
}

function NewImprovement({ profile, onCreated }) {
  const [category, setCategory] = useState("idea");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [files, setFiles] = useState([]);
  const [notes, setNotes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const input = useRef(null);

  const previews = useMemo(() => files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null)), [files]);
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);

  const take = (list) => {
    const named = [...list].map((f, i) => namePasted(f, files.length + i));
    const { files: kept, errors } = addFiles(files, named);
    setFiles(kept);
    setNotes(errors);
  };

  // Ctrl+V of a screenshot anywhere in the form adds it.
  const onPaste = (e) => {
    const pasted = [...(e.clipboardData?.items || [])].filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter(Boolean);
    if (pasted.length) { e.preventDefault(); take(pasted); }
  };

  const submit = async (e) => {
    e.preventDefault();
    const problem = formProblem({ title, details });
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError("");
    try {
      await createImprovement(profile.id, { category, title, details, files });
      setTitle(""); setDetails(""); setFiles([]); setNotes([]); setCategory("idea");
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={`imp-card imp-form ${dragging ? "imp-dragging" : ""}`} onSubmit={submit} onPaste={onPaste}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
      onDrop={(e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); setDragging(false); take(e.dataTransfer.files); }}>
      <h3>Share an improvement</h3>
      <div className="imp-row">
        <label className="imp-field imp-cat">
          <span>Type</span>
          <select className="imp-select" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="imp-field imp-grow">
          <span>Title</span>
          <input className="imp-input" value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Add a filter by date on the Leads list" />
        </label>
      </div>
      <label className="imp-field">
        <span>Details</span>
        <textarea className="imp-input" rows={5} value={details} onChange={(e) => setDetails(e.target.value)}
          placeholder="What would you like changed, where in the CRM, and why it would help. Paste screenshots here with Ctrl+V." />
      </label>

      <div className="imp-drop" onClick={() => input.current?.click()} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.current?.click(); } }}>
        <strong>Add screenshots</strong> — click, drag files here, or paste with Ctrl+V. PNG, JPG, GIF, WebP or PDF, up to 10 MB each, {MAX_FILES} at most.
        <input ref={input} type="file" multiple accept={ALLOWED_TYPES.join(",")} hidden onChange={(e) => { take(e.target.files); e.target.value = ""; }} />
      </div>

      {files.length > 0 && (
        <div className="imp-thumbs">
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="imp-thumb">
              {previews[i] ? <img src={previews[i]} alt={f.name} /> : <div className="imp-file">PDF</div>}
              <span title={f.name}>{f.name}</span>
              <button type="button" className="imp-x" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
        </div>
      )}
      {notes.map((n) => <div key={n} className="imp-note">{n}</div>)}
      {error && <div className="imp-error">{error}</div>}
      <div className="imp-actions">
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Sending…" : "Send to admin"}</button>
      </div>
    </form>
  );
}

function ImprovementCard({ row, urls, isAdmin, isMine, onChanged }) {
  const [status, setStatus] = useState(row.status);
  const [reply, setReply] = useState(row.admin_reply || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setStatus(row.status); setReply(row.admin_reply || ""); }, [row.status, row.admin_reply]);

  const colours = STATUS_COLOURS[row.status] || STATUS_COLOURS.seen;
  const changed = status !== row.status || reply.trim() !== (row.admin_reply || "");

  const run = async (fn) => {
    setBusy(true); setError("");
    try { await fn(); onChanged(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="imp-card">
      <div className="imp-card-head">
        <span className="imp-badge" style={{ background: colours.bg, color: colours.fg }}>{labelOf(STATUSES, row.status)}</span>
        <span className="imp-tag">{labelOf(CATEGORIES, row.category)}</span>
        <span className="imp-title">{row.title}</span>
        <span className="imp-meta">{isAdmin && row.author_name ? `${row.author_name} · ` : ""}{fmtDate(row.created_at)}</span>
      </div>
      {row.details && <div className="imp-details">{row.details}</div>}

      {(row.attachments || []).length > 0 && (
        <div className="imp-thumbs">
          {row.attachments.map((a) => {
            const url = urls[a.path];
            return (
              <a key={a.path} className="imp-thumb" href={url || undefined} target="_blank" rel="noreferrer" title={a.name}>
                {url && isImage(a) ? <img src={url} alt={a.name} /> : <div className="imp-file">{isImage(a) ? "IMG" : "PDF"}</div>}
                <span>{a.name}</span>
              </a>
            );
          })}
        </div>
      )}

      {!isAdmin && row.admin_reply && (
        <div className="imp-reply"><strong>Admin reply</strong>{row.replied_at ? ` · ${fmtDate(row.replied_at)}` : ""}<div>{row.admin_reply}</div></div>
      )}

      {isAdmin && (
        <div className="imp-review">
          <select className="imp-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            {STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <textarea className="imp-input imp-grow" rows={2} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply to the member (optional)" />
          <button className="btn btn-primary btn-sm" disabled={busy || !changed} onClick={() => run(() => reviewImprovement(row.id, { status, admin_reply: reply }))}>Save</button>
        </div>
      )}

      {(isAdmin || (isMine && row.status === "new")) && (
        <div className="imp-actions">
          <button className="btn btn-sm btn-danger" disabled={busy}
            onClick={() => { if (window.confirm(isAdmin ? "Delete this improvement and its screenshots?" : "Withdraw this improvement?")) run(() => deleteImprovement(row)); }}>
            {isAdmin ? "Delete" : "Withdraw"}
          </button>
        </div>
      )}
      {error && <div className="imp-error">{error}</div>}
    </div>
  );
}
