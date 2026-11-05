// Settings: Company Library Word templates, their files and saved fee rows.
import { useRef, useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FilePick, FormGrid, FormModal, Modal, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { libraryAccess, libraryFileUrl, listLibraryTemplates, saveLibraryTemplate, uploadLibraryFile } from "../services/hubApi";
import { readTags } from "../logic/libraryFields";
import { SECTIONS, cleanSections } from "../logic/libraryLetter";
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

// The saved wording of one AB Capital work type. It starts each new document and never changes documents already made.
function WordingModal({ template, onClose, onSaved }) {
  const [quote, setQuote] = useState(template.sections?.quote || {});
  const [letter, setLetter] = useState(template.sections?.letter || {});
  const [which, setWhich] = useState("quote");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await saveLibraryTemplate(saveParams(template, { sections: { quote: cleanSections(quote), letter: cleanSections(letter) } }));
      await onSaved();
      onClose();
    } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Modal title={`Wording: ${template.name}`} onClose={onClose} wide>
      <form onSubmit={save}>
        <p className="bk-note">An empty box uses the default from the saved terms. Bank details are added from Settings, so leave them out here.</p>
        <ErrorNote message={error} />
        <label>Wording for{" "}
          <select value={which} onChange={(e) => setWhich(e.target.value)} style={{ width: "auto" }}>
            <option value="quote">Quotation</option>
            <option value="letter">Engagement letter</option>
          </select>
        </label>
        {which === "quote"
          ? <FormGrid key="quote" fields={SECTIONS.quote} values={quote} setValues={setQuote} />
          : <FormGrid key="letter" fields={SECTIONS.letter} values={letter} setValues={setLetter} />}
        <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>Save</Button></div>
      </form>
    </Modal>
  );
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
      const clean = [];
      rows.forEach((r, i) => {
        const label = String(r.label).trim(), amt = String(r.amount).trim();
        if (!label && !amt) return;   // blank row, skipped
        if (!label) throw new Error(`Row ${i + 1} has an AED amount but no label. Add a label or remove the row.`);
        if (amt === "" || !Number.isFinite(Number(amt))) throw new Error(`Row ${i + 1} (${label}) needs an AED amount as a number.`);
        clean.push({ label, amount: Number(amt), remarks: String(r.remarks).trim(), rate: String(r.rate).trim() });
      });
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

export default function LibrarySettings() {
  const access = useLoad(libraryAccess, []);
  const manage = !!access.data?.manage;
  const list = useLoad(listLibraryTemplates, []);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [adding, setAdding] = useState(null);   // { file, tags } once a file is chosen for a new template
  const [fees, setFees] = useState(null);
  const [wording, setWording] = useState(null);
  const [addingWork, setAddingWork] = useState(false);
  const isAb = (t) => t.company === "AB Capital";
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
  const addWorkType = async (v) => {
    const name = (v.name || "").trim();
    if (!name) throw new Error("A work type needs a name.");
    if (name.includes("/")) throw new Error("The name must not contain /.");
    const key = keyOf("AB Capital", "Work types", name);
    if ((list.data || []).some((t) => t.template_key === key)) throw new Error("That work type already exists.");
    await saveLibraryTemplate({ template_key: key, company: "AB Capital", folder: "Work types", name, fee_rows: [], usd_rate: null, active: true });
    await list.reload();
  };
  const addTemplate = async (v) => {
    const company = "Ardentax", folder = (v.folder || "").trim(), name = (v.name || "").trim();
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
    { label: "File", render: (t) => (isAb(t) ? <span className="bk-muted">Built-in design</span> : t.file ? t.file.file_name : <span className="bk-muted">No file yet</span>) },
    { label: "Uploaded", render: (t) => (t.file ? fmtDate(t.file.uploaded_at) : "–") },
    { label: "Fee rows", render: (t) => `${(t.fee_rows || []).length}${t.usd_rate ? ` · USD ${t.usd_rate}` : ""}` },
    { label: "", render: (t) => (
      <span className="bk-actions">
        {t.file && <Button busy={busy === `d-${t.template_key}`} onClick={() => download(t)}>Download</Button>}
        {manage && !isAb(t) && <FilePick label={t.file ? "Replace file" : "Add file"} accept=".docx" busy={busy === `r-${t.template_key}`} onFile={(f) => replace(t, f)} />}
        {manage && isAb(t) && <Button onClick={() => setWording(t)}>Wording</Button>}
        {manage && <Button onClick={() => setFees(t)}>Fee rows</Button>}
        {manage && <Button busy={busy === `a-${t.template_key}`} onClick={() => retire(t, !t.active)}>{t.active ? "Retire" : "Restore"}</Button>}
      </span>
    ) },
  ];

  return (
    <Panel title="Library templates" sub="AB Capital work types set the wording and fees that start each quote and engagement letter. Ardentax Word files are filled from the Company Library." actions={manage && <span className="bk-actions"><Button onClick={() => setAddingWork(true)}>Add AB Capital work type</Button><FilePick label="Add Ardentax template" accept=".docx" onFile={pickNew} /></span>}>
      <ErrorNote message={error || list.error} onClose={() => setError(null)} />
      {notice && <div className="bk-alert bk-alert-warn">{notice}</div>}
      {list.loading && !list.data ? <Spinner /> : <DataTable columns={columns} rows={list.data || []} pageSize={50} search="Search templates" empty="No library templates yet." />}
      {adding && (
        <FormModal
          title="Add Ardentax template"
          note={`File: ${adding.file.name}. The template is saved first and the file uploaded after it.`}
          fields={[
            { name: "folder", label: "Folder", type: "text", required: true },
            { name: "name", label: "Name", type: "text", required: true },
          ]}
          onSubmit={addTemplate}
          onClose={() => setAdding(null)}
          submitLabel="Add template"
        />
      )}
      {addingWork && <FormModal title="Add AB Capital work type" fields={[{ name: "name", label: "Name", type: "text", required: true }]} onSubmit={addWorkType} onClose={() => setAddingWork(false)} submitLabel="Add work type" />}
      {wording && <WordingModal template={wording} onClose={() => setWording(null)} onSaved={list.reload} />}
      {fees && <FeeRowsModal template={fees} onClose={() => setFees(null)} onSaved={list.reload} />}
    </Panel>
  );
}
