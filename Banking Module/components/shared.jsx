import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export const BankingContext = createContext(null);
export const useBanking = () => useContext(BankingContext);

export const fmtDate = (d) => {
  if (!d) return "–";
  const dt = new Date(String(d).length === 10 ? `${d}T00:00:00` : d);
  return Number.isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "–");
export const today = () => new Date().toISOString().slice(0, 10);

// Loads on mount and on reload(); errors are shown by the caller.
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const stable = useCallback(fn, deps); // eslint-disable-line react-hooks/exhaustive-deps
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await stable();
      setState({ data, loading: false, error: null });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e.message }));
    }
  }, [stable]);
  useEffect(() => {
    let live = true;
    stable().then((data) => live && setState({ data, loading: false, error: null })).catch((e) => live && setState((s) => ({ ...s, loading: false, error: e.message })));
    return () => { live = false; };
  }, [stable]);
  return { ...state, reload: load };
}

export const Spinner = ({ label = "Loading" }) => <div className="bk-loading"><span className="bk-spinner" />{label}</div>;
export const ErrorNote = ({ message, onClose }) => (message ? <div className="bk-alert bk-alert-error" role="alert"><span>{message}</span>{onClose && <button type="button" aria-label="Dismiss" onClick={onClose}>×</button>}</div> : null);
export const Empty = ({ children }) => <div className="bk-empty">{children}</div>;

const TONES = {
  good: ["Verified", "Approved", "Account Opened", "Accepted", "Signed", "Converted", "Completed", "Linked", "Reviewed", "Committed", "Active", "Issued "],
  bad: ["Rejected", "Returned", "Cancelled", "Lost", "Not Interested", "Expired", "Error", "Enhanced Due Diligence", "Resubmission Required", "Unreachable", "Inactive"],
  warn: ["Approval Required", "Pending", "On Hold", "Awaiting Signature", "To Confirm", "Unverified", "Follow-up Required", "Additional Documents Requested", "Pending Client Master", "Pending Review", "Low"],
};
export function Badge({ children, tone }) {
  const t = tone || Object.keys(TONES).find((k) => TONES[k].includes(String(children))) || "plain";
  return <span className={`bk-badge bk-badge-${t}`}>{children ?? "–"}</span>;
}

export function Button({ variant = "secondary", busy, children, ...rest }) {
  return <button type="button" className={`bk-btn bk-btn-${variant}`} disabled={busy || rest.disabled} {...rest}>{busy ? "Working…" : children}</button>;
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="bk-overlay" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`bk-modal ${wide ? "bk-modal-wide" : ""}`}>
        <div className="bk-modal-head"><h3>{title}</h3><button type="button" aria-label="Close" className="bk-x" onClick={onClose}>×</button></div>
        <div className="bk-modal-body">{children}</div>
      </div>
    </div>
  );
}

// field: { name, label, type: text|textarea|number|date|datetime|select|bool|tri|file, options, required, help, full }
export function Field({ field, value, onChange }) {
  const id = `f-${field.name}`;
  const common = { id, value: value ?? "", onChange: (e) => onChange(e.target.value), required: field.required };
  let input;
  switch (field.type) {
    case "textarea": input = <textarea rows={field.rows || 3} {...common} />; break;
    case "number": input = <input type="number" step="any" {...common} />; break;
    case "date": input = <input type="date" {...common} />; break;
    case "datetime": input = <input type="datetime-local" {...common} />; break;
    case "select":
      input = (
        <select {...common}>
          <option value="">{field.placeholder || "Select…"}</option>
          {(field.options || []).map((o) => (typeof o === "string" ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
        </select>
      );
      break;
    case "bool":
      input = <label className="bk-check"><input id={id} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {field.checkLabel || "Yes"}</label>;
      break;
    case "tri":
      input = (
        <select id={id} value={value === true ? "true" : value === false ? "false" : ""} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "true")}>
          <option value="">Not known yet</option><option value="true">Yes</option><option value="false">No</option>
        </select>
      );
      break;
    case "list": input = <input type="text" {...common} value={Array.isArray(value) ? value.join(", ") : value ?? ""} onChange={(e) => onChange(e.target.value)} />; break;
    default: input = <input type="text" {...common} />;
  }
  return (
    <div className={`bk-field ${field.full ? "bk-full" : ""}`}>
      <label htmlFor={id}>{field.label}{field.required && <em> *</em>}</label>
      {input}
      {field.help && <small>{field.help}</small>}
    </div>
  );
}

export const cleanValues = (fields, values) => {
  const out = {};
  for (const f of fields) {
    let v = values[f.name];
    if (v === "" || v === undefined) v = null;
    if (f.type === "number" && v !== null) v = Number(v);
    if (f.type === "list") v = typeof v === "string" ? v.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : v ?? [];
    if (f.type === "datetime" && v) v = new Date(v).toISOString();
    out[f.name] = v;
  }
  return out;
};

export function FormGrid({ fields, values, setValues }) {
  return <div className="bk-grid">{fields.map((f) => <Field key={f.name} field={f} value={values[f.name]} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} />)}</div>;
}

export function FormModal({ title, fields, initial, onSubmit, onClose, submitLabel = "Save", wide, note }) {
  const [values, setValues] = useState(initial || {});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await onSubmit(cleanValues(fields, values));
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={onClose} wide={wide}>
      <form onSubmit={submit}>
        {note && <p className="bk-note">{note}</p>}
        <ErrorNote message={error} />
        <FormGrid fields={fields} values={values} setValues={setValues} />
        <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>{submitLabel}</Button></div>
      </form>
    </Modal>
  );
}

// A prompt for one action that takes remarks and maybe a date or override.
export function useAction(reload) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const act = useCallback(async (fn, okMessage) => {
    setBusy(true); setError(null);
    try {
      const r = await fn();
      await reload?.();
      return r ?? okMessage ?? true;
    } catch (e) {
      setError(e.message);
      return null;
    } finally { setBusy(false); }
  }, [reload]);
  return { error, setError, busy, act };
}

// columns: [{ key, label, render, right }]
export function DataTable({ columns, rows, onRow, pageSize = 25, search, empty = "Nothing here yet." }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    if (!search || !q.trim()) return rows;
    const n = q.trim().toLowerCase();
    return rows.filter((r) => JSON.stringify(r).toLowerCase().includes(n));
  }, [rows, q, search]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safe = Math.min(page, pages - 1);
  const shown = filtered.slice(safe * pageSize, (safe + 1) * pageSize);
  return (
    <div>
      {search && <input className="bk-search" type="search" placeholder={typeof search === "string" ? search : "Search…"} aria-label="Search" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />}
      <div className="bk-table-wrap">
        <table className="bk-table">
          <thead><tr>{columns.map((c) => <th key={c.key || c.label} className={c.right ? "bk-right" : ""}>{c.label}</th>)}</tr></thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={r.id || i} className={onRow ? "bk-click" : ""} onClick={onRow ? () => onRow(r) : undefined} tabIndex={onRow ? 0 : undefined} onKeyDown={onRow ? (e) => e.key === "Enter" && onRow(r) : undefined}>
                {columns.map((c) => <td key={c.key || c.label} data-label={c.label} className={c.right ? "bk-right" : ""}>{c.render ? c.render(r) : r[c.key] ?? "–"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <Empty>{empty}</Empty>}
      </div>
      {pages > 1 && (
        <div className="bk-pager">
          <Button disabled={safe === 0} onClick={() => setPage(safe - 1)}>Previous</Button>
          <span>Page {safe + 1} of {pages} · {filtered.length} rows</span>
          <Button disabled={safe >= pages - 1} onClick={() => setPage(safe + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}

export const PageHead = ({ title, sub, children }) => (
  <div className="bk-page-head"><div><h2>{title}</h2>{sub && <p>{sub}</p>}</div><div className="bk-actions">{children}</div></div>
);
export const Panel = ({ title, sub, actions, children }) => (
  <section className="bk-panel">
    {(title || actions) && <div className="bk-panel-head"><div><h3>{title}</h3>{sub && <p>{sub}</p>}</div><div className="bk-actions">{actions}</div></div>}
    {children}
  </section>
);
export const KeyVals = ({ items }) => (
  <dl className="bk-kv">{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v === null || v === undefined || v === "" ? "–" : v}</dd></div>)}</dl>
);

export function FilePick({ label = "Choose file", onFile, busy, accept }) {
  return (
    <label className={`bk-btn bk-btn-secondary bk-file ${busy ? "bk-disabled" : ""}`}>
      {busy ? "Uploading…" : label}
      <input type="file" accept={accept} disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
    </label>
  );
}

// Bars built from real figures, with the value printed beside each.
export function BarList({ data, format = (v) => v, extra }) {
  const max = Math.max(1, ...data.map((d) => Number(d.value) || 0));
  if (!data.length) return <Empty>No data for this period.</Empty>;
  return (
    <div className="bk-bars">
      {data.map((d) => (
        <div className="bk-bar-row" key={d.label}>
          <span className="bk-bar-label" title={d.label}>{d.label}</span>
          <span className="bk-bar-track"><span className="bk-bar-fill" style={{ width: `${Math.max(1.5, (100 * Math.max(0, d.value)) / max)}%` }} /></span>
          <span className="bk-bar-value">{format(d.value)}{extra ? ` ${extra(d)}` : ""}</span>
        </div>
      ))}
    </div>
  );
}
