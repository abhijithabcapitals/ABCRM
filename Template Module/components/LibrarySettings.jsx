// Settings: Company Library Word templates, their files and saved fee rows.
import { useRef, useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FilePick, FormModal, Modal, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { libraryFileUrl, listLibraryTemplates, saveLibraryTemplate, uploadLibraryFile } from "../services/hubApi";
import { COMPANIES, readTags } from "../logic/libraryFields";
import { renderDocx } from "../logic/renderDocx";

const isDocx = (f) => /\.docx$/i.test(f?.name || "");
const keyOf = (company, folder, name) => `${company}/${folder}/${name}`;

// A file is refused when it is not a Word file or a tag in it is broken. Files with no tags are allowed (download only).
async function checkFile(file) {
  if (!isDocx(file)) throw new Error("A library template must be a Word (.docx) file.");
  const buffer = await file.arrayBuffer();
  const { default: JSZip } = await import("jszip");
  let tags;
  try { tags = await readTags(buffer, JSZip); } catch { throw new Error(`${file.name} cannot be used: it is not a valid Word file.`); }
  try { await renderDocx(buffer, {}); } catch { throw new Error(`${file.name} cannot be used: a {{tag}} in it is broken.`); }
  return tags;
}

function saveParams(t, over = {}) {
  return { template_key: t.template_key, company: t.company, folder: t.folder, name: t.name, fee_rows: t.fee_rows || [], usd_rate: t.usd_rate ?? null, active: t.active, ...over };
}

function FeeRowsModal({ template, onClose, onSaved }) {
  const [rows, setRows] = useState((template.fee_rows || []).map((r) => ({ label: r.label ?? "", amount: r.amount ?? "", remarks: r.remarks ?? "", rate: r.rate ?? "" })));
  const [usd, setUsd] = useState(template.usd_rate ?? "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (i, k, v) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const clean = rows.filter((r) => String(r.label).trim() || String(r.amount).trim()).map((r) => ({
        label: String(r.label).trim(), amount: r.amount === "" ? null : Number(r.amount), remarks: String(r.remarks).trim(), rate: String(r.rate).trim(),
      }));
      if (clean.some((r) => r.amount != null && !Number.isFinite(r.amount))) throw new Error("Each AED amount must be a number.");
      const rate = String(usd).trim() === "" ? null : Number(usd);
      if (rate != null && !(rate > 0)) throw new Error("The USD rate must be more than zero, or left empty.");
      await saveLibraryTemplate(saveParams(template, { fee_rows: clean, usd_rate: rate }));
      await onSaved();
      onClose();
    } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Modal title={`Fee rows: ${template.name}`} onClose={onClose} wide>
      <form onSubmit={save}>
        <p className="bk-note">These rows start every new document made from this template. Staff can change them when filling it.</p>
        <ErrorNote message={error} />
        {rows.map((r, i) => (
          <div className="bk-row" key={i}>
            <input aria-label={`Row ${i + 1} label`} placeholder="Label" value={r.label} onChange={(e) => set(i, "label", e.target.value)} />
            <input aria-label={`Row ${i + 1} AED`} placeholder="AED" type="number" step="any" value={r.amount} onChange={(e) => set(i, "amount", e.target.value)} />
            <input aria-label={`Row ${i + 1} remarks`} placeholder="Remarks" value={r.remarks} onChange={(e) => set(i, "remarks", e.target.value)} />
            <input aria-label={`Row ${i + 1} rate`} placeholder="Rate" value={r.rate} onChange={(e) => set(i, "rate", e.target.value)} />
            <Button onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>Remove</Button>
          </div>
        ))}
        <div className="bk-actions"><Button onClick={() => setRows((x) => [...x, { label: "", amount: "", remarks: "", rate: "" }])}>Add row</Button></div>
        <label className="bk-mt">USD rate (AED per USD, empty for the default){" "}
          <input aria-label="USD rate" type="number" step="any" value={usd} onChange={(e) => setUsd(e.target.value)} />
        </label>
        <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>Save</Button></div>
      </form>
    </Modal>
  );
}

export default function LibrarySettings({ manage }) {
  const list = useLoad(listLibraryTemplates, []);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [adding, setAdding] = useState(null);   // { file, tags } once a file is chosen for a new template
  const [fees, setFees] = useState(null);
  const addFile = useRef(null);

  const act = async (id, fn) => {
    setBusy(id); setError(null);
    try { await fn(); await list.reload(); } catch (e) { setError(e.message); await list.reload(); }
    setBusy(null);
  };
  const tagNote = (tags, name) => setNotice(tags.hasTags ? null : `${name}: This file has no fields, so it can only be downloaded.`);

  const replace = (t, f) => act(`r-${t.template_key}`, async () => {
    const tags = await checkFile(f);
    tagNote(tags, f.name);
    await uploadLibraryFile(t.template_key, t.company, f);
  });
  const download = (t) => act(`d-${t.template_key}`, async () => {
    const url = await libraryFileUrl(t.file.id);
    window.open(url, "_blank", "noopener");
  });
  const retire = (t, active) => act(`a-${t.template_key}`, () => saveLibraryTemplate(saveParams(t, { active })));

  const pickNew = async (f) => {
    setError(null);
    try { const tags = await checkFile(f); tagNote(tags, f.name); setAdding({ file: f }); } catch (e) { setError(e.message); }
  };
  const addTemplate = async (v) => {
    const company = v.company, folder = (v.folder || "").trim(), name = (v.name || "").trim();
    if (!COMPANIES.includes(company)) throw new Error("Choose a company.");
    if (!folder || !name) throw new Error("A template needs a folder and a name.");
    if (folder.includes("/") || name.includes("/")) throw new Error("The folder and name must not contain /.");
    const key = keyOf(company, folder, name);
    if ((list.data || []).some((t) => t.template_key === key)) throw new Error("A template with this company, folder and name already exists. Use Replace file on it.");
    await saveLibraryTemplate({ template_key: key, company, folder, name, fee_rows: [], usd_rate: null, active: true });
    await list.reload();
    try { await uploadLibraryFile(key, company, adding.file); }
    catch (e) { await list.reload(); throw new Error(`The template was saved but its file was not uploaded (${e.message}). Use Replace file on it.`); }
    await list.reload();
  };

  const columns = [
    { label: "Company", key: "company" },
    { label: "Folder", key: "folder" },
    { label: "Name", render: (t) => <>{t.name} {!t.active && <Badge>Retired</Badge>}</> },
    { label: "File", render: (t) => (t.file ? t.file.file_name : <span className="bk-muted">No file yet</span>) },
    { label: "Uploaded", render: (t) => (t.file ? fmtDate(t.file.uploaded_at) : "–") },
    { label: "Fee rows", render: (t) => `${(t.fee_rows || []).length}${t.usd_rate ? ` · USD ${t.usd_rate}` : ""}` },
    { label: "", render: (t) => (
      <span className="bk-actions">
        {t.file && <Button busy={busy === `d-${t.template_key}`} onClick={() => download(t)}>Download</Button>}
        {manage && <FilePick label={t.file ? "Replace file" : "Add file"} accept=".docx" busy={busy === `r-${t.template_key}`} onFile={(f) => replace(t, f)} />}
        {manage && <Button onClick={() => setFees(t)}>Fee rows</Button>}
        {manage && <Button busy={busy === `a-${t.template_key}`} onClick={() => retire(t, !t.active)}>{t.active ? "Retire" : "Restore"}</Button>}
      </span>
    ) },
  ];

  return (
    <Panel title="Library templates" sub="The Word files staff fill from the Company Library. Each file keeps its {{tags}}; the fee rows set here start every new document." actions={manage && <FilePick label="Add template" accept=".docx" onFile={pickNew} />}>
      <ErrorNote message={error || list.error} onClose={() => setError(null)} />
      {notice && <div className="bk-alert bk-alert-warn">{notice}</div>}
      {list.loading && !list.data ? <Spinner /> : <DataTable columns={columns} rows={list.data || []} pageSize={50} search="Search templates" empty="No library templates yet." />}
      {adding && (
        <FormModal
          title="Add library template"
          note={`File: ${adding.file.name}. The template is saved first and the file uploaded after it.`}
          fields={[
            { name: "company", label: "Company", type: "select", options: COMPANIES, required: true },
            { name: "folder", label: "Folder", type: "text", required: true },
            { name: "name", label: "Name", type: "text", required: true },
          ]}
          onSubmit={addTemplate}
          onClose={() => setAdding(null)}
          submitLabel="Add template"
        />
      )}
      {fees && <FeeRowsModal template={fees} onClose={() => setFees(null)} onSaved={list.reload} />}
    </Panel>
  );
}
