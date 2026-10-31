import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Badge, Button, DataTable, ErrorNote, FilePick, Modal, PageHead, Panel, Spinner, fmtDateTime, useAction, useLoad } from "./shared";
import { listAll, loadSettings, rpc, run, stageImport, table, updateRow } from "../services/bankingApi";
import { DEFAULT_MAPPING, FIELD_LABELS, isCleanRow, markDuplicates, readSheet, sheetColumns } from "../logic/excelImport";
import { APP_STATUSES } from "../logic/constants";
import { exportReportXlsx } from "../logic/documents";

const DEFAULT_SHEETS = ["Monthly Bank Account", "Completed Bank"];
const IGNORED = ["Working Bank Account", "POS MACHINE", "GATEWAY", "MOFA", "CT", "AML", "CREDIT CARD"];

async function sha256(buf) {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function ExcelImport() {
  const history = useLoad(() => listAll("banking_excel_imports"), []);
  const [wizard, setWizard] = useState(null);
  const [openImport, setOpenImport] = useState(null);
  const [error, setError] = useState(null);

  const onFile = async (file) => {
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellStyles: true, cellNF: true });
      setWizard({ wb, name: file.name, sha: await sha256(buf), sheets: wb.SheetNames.filter((s) => DEFAULT_SHEETS.includes(s)) });
    } catch (e) { setError(`Could not read the file: ${e.message}`); }
  };

  if (openImport) return <ImportReview imp={openImport} onBack={() => { setOpenImport(null); history.reload(); }} />;
  if (wizard) return <Wizard wizard={wizard} setWizard={setWizard} onCancel={() => setWizard(null)} onStaged={(imp) => { setWizard(null); setOpenImport(imp); }} />;
  return (
    <div>
      <PageHead title="Excel Import" sub="Upload, map, preview, review, then commit. Nothing reaches live records until a person approves it."><FilePick label="Upload workbook" accept=".xlsx,.xls" onFile={onFile} /></PageHead>
      <ErrorNote message={error || history.error} />
      <Panel title="Import history">
        <DataTable rows={history.data || []} onRow={setOpenImport} empty="No imports yet." columns={[{ key: "created_at", label: "When", render: (r) => fmtDateTime(r.created_at) }, { key: "file_name", label: "File" }, { key: "sheets", label: "Sheets", render: (r) => r.sheets.join(", ") }, { key: "total_rows", label: "Rows", right: true }, { key: "committed_rows", label: "Committed", right: true }, { key: "skipped_rows", label: "Skipped", right: true }, { key: "error_rows", label: "Errors", right: true }, { key: "status", label: "Status", render: (r) => <Badge>{r.status}</Badge> }]} />
      </Panel>
    </div>
  );
}

function Wizard({ wizard, setWizard, onCancel, onStaged }) {
  const partners = useLoad(() => listAll("banking_partners", "bank_code, bank_name, aliases", "bank_name", true), []);
  const settings = useLoad(() => loadSettings(), []);
  const [mapping, setMapping] = useState(DEFAULT_MAPPING);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const { wb, sheets } = wizard;
  const columns = useMemo(() => [...new Set(sheets.flatMap((s) => sheetColumns(wb.Sheets[s], XLSX)))].sort(), [sheets, wb]);

  const preview = useMemo(() => {
    if (!partners.data || !settings.data) return null;
    const summaries = [];
    const rows = [];
    for (const s of sheets) {
      const r = readSheet(wb.Sheets[s], s, XLSX, { mapping, partners: partners.data, statusMap: settings.data.legacy_status_map });
      summaries.push(r.summary);
      rows.push(...r.rows);
    }
    markDuplicates(rows);
    return { rows, summaries, clean: rows.filter(isCleanRow).length };
  }, [sheets, wb, mapping, partners.data, settings.data]);

  const toggle = (s) => setWizard({ ...wizard, sheets: sheets.includes(s) ? sheets.filter((x) => x !== s) : [...sheets, s] });
  const stage = async () => {
    setError(null);
    try {
      const imp = await stageImport({ file_name: wizard.name, file_sha256: wizard.sha, sheets, column_mapping: mapping, total_rows: preview.rows.length }, preview.rows, (done, all) => setBusy(`Staging ${done} of ${all}`));
      onStaged(imp);
    } catch (e) { setError(e.message); setBusy(null); }
  };
  return (
    <div>
      <PageHead title={`Import · ${wizard.name}`}><Button onClick={onCancel}>Cancel</Button><Button variant="primary" busy={!!busy} disabled={!preview?.rows.length} onClick={stage}>{busy || "Stage for review"}</Button></PageHead>
      <ErrorNote message={error || partners.error || settings.error} />
      <Panel title="1. Sheets" sub="Working Bank Account, POS, Payment Gateway and MOFA stay out of the initial scope.">
        <div className="bk-checks">{wb.SheetNames.map((s) => <label className="bk-check" key={s}><input type="checkbox" checked={sheets.includes(s)} onChange={() => toggle(s)} /> {s}{IGNORED.includes(s) ? <small className="bk-muted"> (out of scope)</small> : ""}</label>)}</div>
      </Panel>
      <Panel title="2. Column mapping" sub="Matched by header text. Change one if a sheet names a column differently.">
        <div className="bk-grid">
          {Object.entries(FIELD_LABELS).map(([field, label]) => (
            <div className="bk-field" key={field}>
              <label htmlFor={`m-${field}`}>{label}</label>
              <select id={`m-${field}`} value={(mapping[field] || []).find((c) => columns.includes(c)) || ""} onChange={(e) => setMapping({ ...mapping, [field]: e.target.value ? [e.target.value] : [] })}>
                <option value="">Not mapped</option>{columns.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="3. Preview">
        {!preview ? <Spinner /> : (
          <>
            <p className="bk-note">{preview.rows.length} rows read · {preview.clean} clean · {preview.rows.length - preview.clean} need a look · {preview.summaries.reduce((a, s) => a + s.skippedService, 0)} non-bank services skipped (POS, CT filing, …) · {preview.summaries.reduce((a, s) => a + s.notData, 0)} summary rows ignored.</p>
            <DataTable pageSize={15} rows={preview.rows} columns={rowColumns} />
          </>
        )}
      </Panel>
    </div>
  );
}

const rowColumns = [
  { key: "src", label: "Source", render: (r) => `${r.source_sheet} #${r.source_row}` }, { key: "c", label: "Company", render: (r) => r.mapped.company }, { key: "b", label: "Bank", render: (r) => r.mapped.bank_resolved || <Badge tone="warn">{r.mapped.bank_raw}</Badge> },
  { key: "s", label: "Excel status", render: (r) => r.mapped.status_raw }, { key: "col", label: "Colour", render: (r) => <span className={`bk-swatch bk-swatch-${r.colour_meaning}`}>{r.colour_meaning}</span> }, { key: "suggested_status", label: "Suggested", render: (r) => r.suggested_status || <Badge tone="warn">Confirm</Badge> },
  { key: "confidence", label: "Confidence", render: (r) => <Badge tone={r.confidence === "High" ? "good" : r.confidence === "Medium" ? "plain" : "warn"}>{r.confidence}</Badge> }, { key: "i", label: "Issues", render: (r) => (r.issues || []).join("; ") || "–" },
];

function ImportReview({ imp, onBack }) {
  const rows = useLoad(async () => {
    const all = [];
    for (let from = 0; ; from += 1000) {
      const part = await run(table("banking_excel_import_rows").select("*").eq("import_id", imp.id).order("source_sheet").order("source_row").range(from, from + 999));
      all.push(...part);
      if (part.length < 1000) break;
    }
    return all;
  }, [imp.id]);
  const [filter, setFilter] = useState("Pending");
  const [edit, setEdit] = useState(null);
  const [notes, setNotes] = useState(null);
  const [msg, setMsg] = useState(null);
  const { error, busy, act } = useAction(rows.reload);
  const data = rows.data || [];
  const counts = data.reduce((a, r) => { a[r.decision] = (a[r.decision] || 0) + 1; return a; }, {});
  const noteRows = data.filter((r) => r.decision === "Committed" && r.payment_review === "Pending");
  const shown = filter === "Notes" ? noteRows : data.filter((r) => !filter || r.decision === filter);

  const approveClean = () => act(async () => {
    const ids = data.filter((r) => r.decision === "Pending" && r.suggested_status && r.confidence === "High" && r.mapped.bank_resolved).map((r) => r.id);
    for (let i = 0; i < ids.length; i += 200) await run(table("banking_excel_import_rows").update({ decision: "Approved" }).in("id", ids.slice(i, i + 200)));
    setMsg(`${ids.length} clean rows approved. Commit when ready.`);
  });
  const commit = () => act(async () => {
    let total = 0, errors = 0;
    for (;;) {
      const r = await rpc("banking_import_commit", { p_import: imp.id, p_limit: 100 });
      total += r.committed; errors += r.errors;
      if (r.committed + r.errors === 0) break;
      setMsg(`Committed ${total}…`);
    }
    setMsg(`Committed ${total} rows. ${errors} errors.`);
  });
  return (
    <div>
      <PageHead title={`Review · ${imp.file_name}`} sub={`Pending ${counts.Pending || 0} · Approved ${counts.Approved || 0} · Committed ${counts.Committed || 0} · Skipped ${counts.Skipped || 0} · Errors ${counts.Error || 0}`}>
        <Button onClick={onBack}>Back</Button>
        <Button onClick={() => exportReportXlsx(`Import errors ${imp.file_name}`, data.filter((r) => r.decision === "Error" || r.issues?.length).map((r) => ({ Sheet: r.source_sheet, Row: r.source_row, Company: r.mapped.company, Bank: r.mapped.bank_raw, Status: r.mapped.status_raw, Colour: r.cell_colour, Decision: r.decision, Error: r.error, Issues: (r.issues || []).join("; ") })))}>Error report</Button>
        <Button busy={busy} onClick={approveClean}>Approve clean rows</Button>
        <Button variant="primary" busy={busy} disabled={!counts.Approved} onClick={commit}>Commit approved</Button>
      </PageHead>
      <ErrorNote message={rows.error || error} />
      {msg && <div className="bk-alert bk-alert-ok">{msg}</div>}
      <div className="bk-filter">
        {["Pending", "Approved", "Error", "Committed", "Skipped"].map((d) => <button type="button" key={d} className={`bk-chip ${filter === d ? "active" : ""}`} onClick={() => setFilter(d)}>{d} ({counts[d] || 0})</button>)}
        <button type="button" className={`bk-chip ${filter === "Notes" ? "active" : ""}`} onClick={() => setFilter("Notes")}>Payment notes to review ({noteRows.length})</button>
      </div>
      {rows.loading && !rows.data ? <Spinner /> : (
        <DataTable search="Search…" rows={shown} columns={[...rowColumns, { key: "error", label: "Error" }, { key: "a", label: "", render: (r) => (
          <span className="bk-actions">
            {filter === "Notes" ? <Button onClick={() => setNotes(r)}>Review note</Button> : r.decision !== "Committed" && <Button onClick={() => setEdit(r)}>Decide</Button>}
          </span>
        ) }]} />
      )}
      {edit && <RowDecision row={edit} onClose={() => setEdit(null)} onDone={rows.reload} />}
      {notes && <NoteReview row={notes} onClose={() => setNotes(null)} onDone={rows.reload} />}
    </div>
  );
}

function RowDecision({ row, onClose, onDone }) {
  const [status, setStatus] = useState(row.decided_status || row.suggested_status || "");
  const [allowDup, setAllowDup] = useState(!!row.mapped.allow_duplicate);
  const { error, busy, act } = useAction();
  const decide = (decision) => act(async () => {
    await updateRow("banking_excel_import_rows", row.id, { decision, decided_status: status || null, error: null, mapped: { ...row.mapped, allow_duplicate: allowDup } });
    await onDone(); onClose();
  });
  return (
    <Modal wide title={`${row.mapped.company} · ${row.source_sheet} row ${row.source_row}`} onClose={onClose}>
      <ErrorNote message={error || row.error} />
      {row.issues?.length > 0 && <ul className="bk-issues">{row.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
      <div className="bk-grid">
        <div className="bk-field"><label htmlFor="d-s">Application status</label><select id="d-s" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Choose…</option>{APP_STATUSES.map((s) => <option key={s}>{s}</option>)}</select><small>Payment Pending is not an application status: keep the status and let the balance show on the ledger.</small></div>
        <div className="bk-field"><label className="bk-check"><input type="checkbox" checked={allowDup} onChange={(e) => setAllowDup(e.target.checked)} /> This is a separate application, not a duplicate</label></div>
      </div>
      <details className="bk-mt"><summary>Original row</summary><pre className="bk-code">{JSON.stringify(row.raw, null, 2)}</pre></details>
      <div className="bk-modal-actions"><Button busy={busy} onClick={() => decide("Skipped")}>Skip row</Button><Button variant="primary" busy={busy} disabled={!status} onClick={() => decide("Approved")}>Approve</Button></div>
    </Modal>
  );
}

function NoteReview({ row, onClose, onDone }) {
  const [lines, setLines] = useState(() => (row.payment_candidates || []).map((p) => ({ amount: p.amount ?? "", date: p.date ?? "", method: p.method ?? "", assumed: p.year_assumed, amountAssumed: p.amount_assumed })));
  const { error, busy, act } = useAction();
  const set = (i, k, v) => setLines((ls) => ls.map((l, n) => (n === i ? { ...l, [k]: v } : l)));
  const post = () => act(async () => {
    await rpc("banking_import_post_payments", { p_row: row.id, p_payments: lines.map((l) => ({ amount: Number(l.amount), date: l.date, method: l.method || null })) });
    await onDone(); onClose();
  });
  const noPayments = () => act(async () => { await rpc("banking_import_post_payments", { p_row: row.id, p_payments: [] }); await onDone(); onClose(); });
  const valid = lines.length > 0 && lines.every((l) => Number(l.amount) > 0 && l.date);
  return (
    <Modal wide title={`Payment note · ${row.mapped.company}`} onClose={onClose}>
      <ErrorNote message={error} />
      <p><strong>Original note:</strong> <code className="bk-code">{row.payment_note}</code></p>
      <p className="bk-note">Fee in Excel: {row.mapped.fee ?? "–"}. Fill a date or amount only from evidence: a blank in the source is not a guess. A year or amount marked "check" was only suggested.</p>
      {(row.issues || []).length > 0 && <ul className="bk-issues">{row.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
      {lines.map((l, i) => (
        <div className="bk-note-line" key={i}>
          <label>Amount {l.amountAssumed && <Badge tone="warn">check</Badge>}<input type="number" value={l.amount} onChange={(e) => set(i, "amount", e.target.value)} /></label>
          <label>Date {l.assumed && <Badge tone="warn">check year</Badge>}<input type="date" value={l.date} onChange={(e) => set(i, "date", e.target.value)} /></label>
          <label>Method<input value={l.method} onChange={(e) => set(i, "method", e.target.value)} /></label>
          <button type="button" className="bk-link" onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))}>Remove</button>
        </div>
      ))}
      <Button onClick={() => setLines((l) => [...l, { amount: "", date: "", method: "" }])}>Add transaction</Button>
      <div className="bk-modal-actions"><Button busy={busy} onClick={noPayments}>Post nothing: not enough evidence</Button><Button variant="primary" busy={busy} disabled={!valid} onClick={post}>Post {lines.length} payment{lines.length === 1 ? "" : "s"}</Button></div>
    </Modal>
  );
}
