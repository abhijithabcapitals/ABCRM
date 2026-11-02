// Client Master: one row per client, kept in the CRM database so every employee sees the same record.
// Documents are read in the browser, so all of this works from anywhere.
import { useMemo, useRef, useState } from "react";
import "@banking/components/banking.css";
import { Badge, Button, DataTable, ErrorNote, KeyVals, PageHead, Panel, Spinner, useLoad } from "@banking/components/shared";
import { readDocuments, rpc, run, table } from "@banking/services/bankingApi";
import { useClientLookup } from "@banking/components/ClientLookup";
import { flagMissing } from "@banking/components/Attention";
import { ProgressRing } from "@banking/components/ReadingWidget";
import { findClient } from "@banking/logic/clientLookup";
import { COLUMNS, DOC_STATUSES, NA, STAGES, VR, VR_SUFFIX, applies, blank, complete, docsFromCell, docsToCell, fillFromClient, fillFromDocuments, listFromCell, listToCell, needsVerification, parseUaeDate, plain, splitCell, unknown } from "./masterLogic";

const empties = ["Not Provided", VR];
const shown = (v) => (empties.includes(v) ? "" : plain(v));
const iso = (v) => { const d = parseUaeDate(v); return d ? d.toISOString().slice(0, 10) : ""; };
const uae = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; };

export default function ClientMaster() {
  const access = useLoad(() => rpc("banking_my_access"), []);
  const list = useLoad(() => run(table("client_master").select("*").order("updated_at", { ascending: false }).limit(5000)), []);
  const [open, setOpen] = useState(null);
  const perms = access.data?.permissions || [];
  const canEdit = perms.includes("kyc.manage");
  const rows = list.data || [];
  const exportXlsx = async () => {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([COLUMNS, ...rows.map((r) => COLUMNS.map((c) => String(r.data[c] ?? "")))]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Client Master");
    XLSX.writeFile(wb, "Client_Master.xlsx");
  };
  if (open) return <ClientForm key={open.client_id || "new"} row={open} canEdit={canEdit} onClose={async () => { setOpen(null); await list.reload(); }} />;
  return (
    <div className="bk-root">
      <PageHead title="Client Master" sub="One record per client, shared across the CRM.">
        {rows.length > 0 && <Button onClick={exportXlsx}>Export Excel</Button>}
        {canEdit && <Button variant="primary" onClick={() => setOpen({})}>+ New client</Button>}
      </PageHead>
      <ErrorNote message={list.error || access.error} />
      {list.loading && !list.data ? <Spinner /> : (
        <DataTable search="Search client, licence, TRN…" rows={rows.map((r) => ({ ...r, licence: r.data["Trade License Number"], trn: r.data.TRN, status: r.data["Onboarding Status"], score: r.data["Onboarding Completion %"], risk: r.data["Risk Level"], expiry: r.data["License Expiry Date"], changed: r.data["Last Updated"] }))} onRow={setOpen} empty="No clients in the Client Master yet." columns={[
          { key: "client_id", label: "ID" }, { key: "legal_name", label: "Client" }, { key: "licence", label: "Licence", render: (r) => shown(r.licence) }, { key: "trn", label: "TRN", render: (r) => shown(r.trn) },
          { key: "status", label: "Onboarding", render: (r) => shown(r.status) }, { key: "score", label: "Complete", right: true }, { key: "risk", label: "Risk", render: (r) => shown(r.risk) }, { key: "expiry", label: "Licence expiry", render: (r) => shown(r.expiry) }, { key: "changed", label: "Updated" },
        ]} />
      )}
    </div>
  );
}

function ClientForm({ row, canEdit, onClose }) {
  const existing = row.data || null;
  const [values, setValues] = useState(existing || {});
  const [stage, setStage] = useState(0);
  const [review, setReview] = useState(false);
  const [dups, setDups] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [percent, setPercent] = useState(0);
  const [conflicts, setConflicts] = useState([]);
  const files = useRef(null);
  const clients = useClientLookup(!existing);
  const history = useLoad(() => (row.client_id ? run(table("client_master_history").select("*").eq("client_id", row.client_id).order("changed_at", { ascending: false }).limit(200)) : Promise.resolve([])), [row.client_id]);
  const result = useMemo(() => complete(values, existing), [values, existing]);
  const rec = result.record;
  const set = (col, v) => {
    setValues((s) => {
      const next = { ...s, [col]: v };
      // Naming a client the CRM already knows fills the empty fields; everything stays editable.
      if (!existing && col === "Client Legal Name") { const c = findClient(clients, "name", v); if (c) return fillFromClient(next, c); }
      return next;
    });
    setDups(null);
  };

  const readFiles = async (list) => {
    setBusy("read"); setError(null); setNote(null); setPercent(0);
    try {
      const docs = await readDocuments([...list], null, (p) => setPercent((now) => Math.max(now, Math.min(99, Math.floor(p)))));
      const r = fillFromDocuments(values, docs);
      setValues(r.values); setConflicts(r.conflicts);
      setNote(`${docs.length} document(s) read, ${r.filled.length} field(s) filled. Check each one marked for verification.`);
    } catch (e) { setError(`${e.message} You can type the details instead.`); }
    setBusy(null);
    if (files.current) files.current.value = "";
  };

  const save = async (allow = false) => {
    if (result.errors.length) {
      setError(result.errors.join(" "));
      const nameMissing = result.errors[0].includes("Legal Name");
      setStage(nameMissing ? 0 : STAGES.findIndex((s) => s.id === "risk")); setReview(false);
      setTimeout(() => flagMissing([nameMissing ? "cm-Client-Legal-Name" : "cm-Risk-Reason"]), 0);
      return;
    }
    setBusy("save"); setError(null);
    try {
      const r = await rpc("client_master_save", { p_id: row.client_id || null, p_data: rec, p_version: row.version ?? null, p_allow_duplicate: allow });
      if (!r.ok && r.duplicates) { setDups(r.duplicates); setBusy(null); return; }
      await onClose();
    } catch (e) { setError(e.message); setBusy(null); }
  };

  return (
    <div className="bk-root">
      <PageHead title={plain(rec["Client Legal Name"]) && rec["Client Legal Name"] !== "Not Provided" ? plain(rec["Client Legal Name"]) : "New client"} sub={`${row.client_id ? `${row.client_id} · ` : ""}${result.score}% complete · ${result.band}`}><Button onClick={onClose}>Back</Button></PageHead>
      <ErrorNote message={error} onClose={error ? () => setError(null) : undefined} />
      {note && <div className="bk-alert bk-alert-ok">{note}</div>}
      {conflicts.length > 0 && <div className="bk-alert bk-alert-warn"><strong>Different readings, left for you to decide:</strong><ul>{conflicts.map((c) => <li key={c}>{c}</li>)}</ul></div>}
      {canEdit && (
        <Panel title="Fill from documents" sub="Read in this browser. Files stay on this PC and are not stored by this page.">
          <input ref={files} type="file" multiple aria-label="Client documents" onChange={(e) => e.target.files.length && readFiles(e.target.files)} disabled={busy === "read"} />
          {busy === "read" && <div className="crm-reading-inline"><ProgressRing percent={percent} /><div><strong>Reading documents…</strong><small>Stay on this page until it finishes.</small></div></div>}
        </Panel>
      )}
      <div className="bk-tabs bk-cm-stages" role="tablist" aria-label="Onboarding stage">
        {STAGES.map((s, i) => <button type="button" role="tab" key={s.id} aria-selected={!review && stage === i} className={!review && stage === i ? "active" : ""} onClick={() => { setStage(i); setReview(false); }}>{i + 1}. {s.title}</button>)}
        <button type="button" role="tab" aria-selected={review} className={review ? "active" : ""} onClick={() => setReview(true)}>Final review</button>
      </div>
      {review ? (
        <Panel title="Final review" sub="Please confirm this is correct before saving.">
          <KeyVals items={[["Legal name", shown(rec["Client Legal Name"])], ["Trade licence", shown(rec["Trade License Number"])], ["Jurisdiction", shown(rec.Jurisdiction)], ["Industry", shown(rec.Industry)], ["Services", shown(rec["Services Provided"])], ["VAT", shown(rec["VAT Registered"])], ["Corporate Tax", shown(rec["Corporate Tax Registered"])], ["Accounting software", shown(rec["Accounting Software"])], ["Audit", shown(rec["Audit Required"])]]} />
          <h4>Missing ({result.missing.length})</h4><p className="bk-note">{result.missing.join("; ") || "None"}</p>
          <h4>Requiring review ({result.review.length})</h4><p className="bk-note">{result.review.join("; ") || "None"}</p>
          {dups && <div className="bk-alert bk-alert-warn"><strong>Likely duplicate, not saved:</strong><ul>{dups.map((d) => <li key={d.id}>{d.id} · {d.name} ({d.matches.join(", ")})</li>)}</ul><Button onClick={() => save(true)}>It is a different entity, save anyway</Button></div>}
          {canEdit && !dups && <div className="bk-actions bk-mt"><Button variant="primary" busy={busy === "save"} onClick={() => save(false)}>Confirm and save</Button></div>}
        </Panel>
      ) : (
        <Panel title={STAGES[stage].title} sub={STAGES[stage].intro}>
          <div className="bk-grid">{STAGES[stage].fields.map((f) => <MasterField key={f.col} field={f} rec={rec} value={values[f.col] ?? (existing ? rec[f.col] : "")} set={set} readOnly={!canEdit} />)}</div>
          <div className="bk-actions bk-mt">
            {stage > 0 && <Button onClick={() => setStage(stage - 1)}>Previous</Button>}
            {stage < STAGES.length - 1 ? <Button variant="primary" onClick={() => setStage(stage + 1)}>Next</Button> : <Button variant="primary" onClick={() => setReview(true)}>Final review</Button>}
          </div>
        </Panel>
      )}
      {row.client_id && (
        <Panel title="History"><DataTable rows={history.data || []} empty="No changes." columns={[{ key: "changed_at", label: "When", render: (h) => new Date(h.changed_at).toLocaleString("en-AE", { timeZone: "Asia/Dubai" }) }, { key: "action", label: "Action" }, { key: "field", label: "Field" }, { key: "old_value", label: "Old" }, { key: "new_value", label: "New" }]} /></Panel>
      )}
    </div>
  );
}

function MasterField({ field: f, rec, value, set, readOnly }) {
  const id = `cm-${f.col.replace(/\W+/g, "-")}`;
  const on = applies(f, rec);
  const label = <label htmlFor={id}>{f.col}{f.req && on && <em> *</em>}</label>;
  const wrap = (input, full) => <div className={`bk-field ${full ? "bk-full" : ""}`}>{label}{input}{f.hint && <small>{f.hint}</small>}</div>;
  if (f.type === "derived") return wrap(<input id={id} value={shown(rec[f.col])} readOnly placeholder="Filled from the contacts' roles" />);
  if (!on) return wrap(<input id={id} value={NA} readOnly />);
  if (f.type === "list") return <ListField field={f} id={id} value={value} set={set} readOnly={readOnly} />;
  if (f.type === "docs") return <DocsField field={f} value={value} set={set} readOnly={readOnly} />;
  if (f.type === "multi") {
    const cur = splitCell(value);
    const toggle = (o) => set(f.col, (cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]).join("; "));
    return <div className="bk-field bk-full"><span className="bk-cm-label">{f.col}{f.req && <em> *</em>}</span><div className="bk-cm-checks">{f.opts.map((o) => <label className="bk-check" key={o}><input type="checkbox" checked={cur.includes(o)} disabled={readOnly} onChange={() => toggle(o)} /> {o}</label>)}</div></div>;
  }
  const flagged = needsVerification(value);
  const change = (v) => set(f.col, blank(v) ? "" : flagged ? v + VR_SUFFIX : v);
  const common = { id, disabled: readOnly, onChange: (e) => change(e.target.value) };
  let input;
  const text = unknown(value) || value === NA ? "" : plain(value);
  if (f.type === "textarea" || f.type === "review") input = <textarea rows={3} {...common} value={f.type === "review" ? splitCell(value).join("\n") : text} onChange={(e) => set(f.col, e.target.value)} />;
  else if (f.type === "select" || f.type === "yesno") input = <select {...common} value={text}><option value="">Select…</option>{(f.type === "yesno" ? ["Yes", "No"] : f.opts).map((o) => <option key={o}>{o}</option>)}</select>;
  else if (f.type === "date") input = <input type="date" {...common} value={iso(value)} onChange={(e) => change(uae(e.target.value))} />;
  else input = <><input type={f.type === "email" ? "email" : "text"} {...common} value={text} list={f.suggest ? `${id}-s` : undefined} />{f.suggest && <datalist id={`${id}-s`}>{f.suggest.map((o) => <option key={o} value={o} />)}</datalist>}</>;
  return wrap(<>{input}{f.type !== "review" && !readOnly && <label className="bk-check bk-cm-verify"><input type="checkbox" checked={flagged} disabled={!text} onChange={(e) => set(f.col, e.target.checked ? text + VR_SUFFIX : text)} /> Needs verification</label>}</>, f.type === "textarea" || f.type === "review");
}

function ListField({ field: f, value, set, readOnly }) {
  const [items, setItems] = useState(() => listFromCell(value, f));
  const update = (next) => { setItems(next); set(f.col, listToCell(next, f)); };
  const setPart = (i, k, v) => update(items.map((x, n) => (n === i ? { ...x, [k]: v } : x)));
  return (
    <div className="bk-field bk-full">
      <span className="bk-cm-label">{f.col}{f.req && <em> *</em>}</span>
      {items.map((it, i) => (
        <div className="bk-cm-item" key={i}>
          {f.sub.map((s) => (
            <div className="bk-field" key={s.key}><label htmlFor={`${f.col}-${i}-${s.key}`}>{s.label || s.key}</label>
              {s.type === "select" ? <select id={`${f.col}-${i}-${s.key}`} disabled={readOnly} value={it[s.key] || ""} onChange={(e) => setPart(i, s.key, e.target.value)}><option value="">Select…</option>{s.opts.map((o) => <option key={o}>{o}</option>)}</select>
                : s.type === "multi" ? <div className="bk-cm-checks">{s.opts.map((o) => { const cur = (it[s.key] || "").split("/").filter(Boolean); return <label className="bk-check" key={o}><input type="checkbox" disabled={readOnly} checked={cur.includes(o)} onChange={() => setPart(i, s.key, (cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]).join("/"))} /> {o}</label>; })}</div>
                  : <input id={`${f.col}-${i}-${s.key}`} disabled={readOnly} maxLength={s.type === "last4" ? 4 : undefined} value={it[s.key] || ""} onChange={(e) => setPart(i, s.key, s.type === "last4" ? e.target.value.replace(/\D/g, "") : e.target.value)} />}
            </div>
          ))}
          {!readOnly && <button type="button" className="bk-link" onClick={() => update(items.filter((_, n) => n !== i))}>Remove</button>}
        </div>
      ))}
      {!readOnly && <div><Button onClick={() => setItems([...items, Object.fromEntries(f.sub.filter((s) => s.default).map((s) => [s.key, s.default]))])}>+ Add {f.item}</Button></div>}
    </div>
  );
}

function DocsField({ field: f, value, set, readOnly }) {
  const st = docsFromCell(value);
  return (
    <div className="bk-field bk-full">
      <span className="bk-cm-label">{f.col}{f.req && <em> *</em>}</span>
      <div className="bk-grid">{f.docs.map((d) => <div className="bk-field" key={d}><label htmlFor={`${f.col}-${d}`}>{d}</label><select id={`${f.col}-${d}`} disabled={readOnly} value={st[d] || ""} onChange={(e) => set(f.col, docsToCell({ ...st, [d]: e.target.value }, f))}><option value="">Not set</option>{DOC_STATUSES.map((o) => <option key={o}>{o}</option>)}</select></div>)}</div>
    </div>
  );
}
