// The fill form: client details from Client Master or OCR, then typed, then fees, then Generate.
// template and fileId fill a Word template. letter fills an AB Capital engagement letter, where start.parentId names its quote.
// ID documents are read in this browser and are not kept; only values left in the form are stored.
import { useEffect, useRef, useState } from "react";
import { saveAs } from "file-saver";
import { Button, ErrorNote, FilePick, FormGrid, Spinner } from "@banking/components/shared";
import { readDocuments } from "@banking/services/bankingApi";
import { buildAutofill } from "@banking/logic/kycAutofill";
import { formFields, readTags } from "../logic/libraryFields";
import { LETTER_TEMPLATE, letterFields } from "../logic/libraryLetter";
import { fromClientMaster, mergeAutofill } from "../logic/libraryOcr";
import { renderDocx } from "../logic/renderDocx";
import { createLibraryDocument, createLibraryLetter, libraryFileBuffer, loadHubSettings, renderTemplate, saveFile, searchClients } from "../services/hubApi";
import { generateLetter, generateLibraryDocument } from "../services/libraryGenerate";

const dubaiToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
const emptyRow = () => ({ label: "", amount: "", remarks: "", rate: "" });
// Where the Client Module, when running on this PC, files a copy. Ardentax has no folder, so its copy stays in storage only.
const pcKind = (company) => (company === "AB Capital" ? "setup_quote" : "ardentax_document");

// A conflict reads "value (file name)", and the file name itself may hold brackets.
const readingOf = (r, docs) => {
  const doc = docs.find((d) => r.endsWith(` (${d.name})`));
  return doc ? r.slice(0, -(doc.name.length + 3)) : r;
};

export const libraryDeps = (company) => ({
  loadFile: libraryFileBuffer,
  create: createLibraryDocument,
  render: renderDocx,
  save: (doc, blob, name) => saveFile(doc, pcKind(company), blob, name),
});

export const letterDeps = () => ({
  loadSettings: loadHubSettings,
  create: createLibraryLetter,
  render: (data) => renderTemplate(LETTER_TEMPLATE, data),
  save: (doc, blob, name) => saveFile(doc, "setup_letter", blob, name),
});

export default function LibraryForm({ template, fileId, letter = false, start, onClose, onDone, onFailed }) {
  const [fields, setFields] = useState(() => (letter ? letterFields() : null));
  const [values, setValues] = useState(() => ({ date: dubaiToday(), ...(start?.values || {}) }));
  const [rows, setRows] = useState(() => {
    const saved = start?.rows || template?.fee_rows || [];
    return saved.length ? saved.map((r) => ({ ...emptyRow(), ...r })) : [emptyRow()];
  });
  const [clientId, setClientId] = useState(start?.clientId || null);
  const [linkedName, setLinkedName] = useState(start?.clientId ? start?.values?.client_name || "" : "");
  const [search, setSearch] = useState("");
  const [found, setFound] = useState(null);
  const [docs, setDocs] = useState([]);
  const [filled, setFilled] = useState([]);
  const [conflicts, setConflicts] = useState({});
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0); // a repeated error must show again
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(null);
  const latest = useRef(values);
  latest.current = values;
  const company = letter ? "AB Capital" : template.company;

  useEffect(() => {
    if (letter) return undefined;
    let live = true;
    (async () => {
      try {
        const [{ default: JSZip }, buffer] = await Promise.all([import("jszip"), libraryFileBuffer(fileId)]);
        const tags = await readTags(buffer, JSZip);
        if (live) setFields(tags.hasTags ? formFields(tags, company) : []);
      } catch (e) {
        if (live) { setError(`This template could not be read: ${e.message}`); setLoadFailed(true); }
      }
    })();
    return () => { live = false; };
  }, [fileId, company, letter]);

  const shown = fields || [];

  const findClients = async () => {
    setError(null);
    setBusy("search");
    try { setFound(await searchClients(search)); } catch (e) { setError(e.message); }
    setBusy(null);
  };
  const pickClient = (row) => {
    const { client_id: id, ...master } = fromClientMaster(row);
    setClientId(id);
    setLinkedName(master.client_name || "");
    // Picking a client replaces the client details, so one client's name cannot go out under another's link.
    setValues((v) => ({ ...v, client_name: "", contact_name: "", contact_email: "", contact_phone: "", client_address: "", ...master }));
    setFound(null);
    setSearch(master.client_name || "");
  };
  const readFile = async (file) => {
    setBusy("ocr");
    setError(null);
    setNote(null);
    try {
      const [result] = await readDocuments([file]);
      const all = [...docs, result];
      const merged = mergeAutofill(latest.current, buildAutofill(all)); // read after the wait, so typing meanwhile is kept
      setDocs(all);
      setValues(merged.values);
      setConflicts(merged.conflicts);
      setFilled((f) => [...new Set([...f, ...merged.filled])]);
      setNote(merged.filled.length ? "Read. Please check the filled values." : `Nothing new was read from ${file.name}. Please type the details.`);
    } catch (e) {
      setNote(`${file.name} could not be read: ${e.message} Please type the details.`);
    }
    setBusy(null);
  };
  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const generate = async () => {
    setBusy("generate");
    setError(null);
    setAttempt((n) => n + 1);
    const out = letter
      ? await generateLetter({ fields: shown, values, rows, clientId, parentId: start?.parentId, linkedName }, letterDeps())
      : await generateLibraryDocument({ template, fileId, fields: shown, values, rows, usdRate: template.usd_rate, clientId, linkedName }, libraryDeps(company));
    setBusy(null);
    if (!out.doc) return setError(out.error);
    if (out.error) {
      // The number is taken. The form closes, so a second click cannot take another.
      await onDone();
      onFailed(`${out.doc.document_number} is saved, but its file was not: ${out.error} Use Retry in the list.`);
      return onClose();
    }
    saveAs(out.file.blob, out.file.name);
    await onDone();
    return onClose();
  };

  return (
    <>
      <ErrorNote key={attempt} message={error} onClose={() => setError(null)} />
      {!fields && !loadFailed && <Spinner />}
      {loadFailed && <p className="bk-note">This template could not be read. Replace its file in Settings.</p>}
      {fields && !fields.length && <p className="bk-note">This template has no fields, so it can only be downloaded.</p>}
      {fields && fields.length > 0 && (
        <>
          <div className="bk-row">
            <input className="bk-search" type="search" placeholder="Search Client Master" aria-label="Search Client Master" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Button busy={busy === "search"} onClick={findClients} disabled={!search.trim() || busy === "search"}>Search</Button>
            <FilePick label="Read passport, Emirates ID or licence" busy={busy === "ocr"} accept=".pdf,.jpg,.jpeg,.png,.bmp,.webp,.tif,.tiff" onFile={readFile} />
          </div>
          {found && (found.length
            ? <div className="bk-row">{found.map((c) => <Button key={c.client_id} onClick={() => pickClient(c)}>{c.data?.["Client Legal Name"] || c.client_id}</Button>)}</div>
            : <p className="bk-note">No client found.</p>)}
          {clientId && (
            <div className="bk-row">
              <span className="bk-note">Linked to client {clientId}{company === "AB Capital" && !letter ? ". This document will show in their Business Setup workspace and client login." : "."}</span>
              {!start?.parentId && <Button onClick={() => { setClientId(null); setLinkedName(""); }}>Unlink</Button>}
            </div>
          )}
          {note && <p className="bk-note">{note}</p>}
          {filled.length > 0 && <p className="bk-note">Filled by OCR: {filled.map((n) => shown.find((f) => f.name === n)?.label).filter(Boolean).join(", ") || "none on this template"}.</p>}
          {Object.entries(conflicts).filter(([tag]) => shown.some((f) => f.name === tag)).map(([tag, list]) => (
            <div className="bk-row" key={tag}>
              <span><strong>{shown.find((f) => f.name === tag).label}</strong>: documents disagree.</span>
              {list.map((r) => <Button key={r} onClick={() => setValues((v) => ({ ...v, [tag]: readingOf(r, docs) }))}>{r}</Button>)}
            </div>
          ))}
          <FormGrid fields={shown} values={values} setValues={setValues} />
          <h3>Fees</h3>
          <p className="bk-note">Changes here apply to this document only.</p>
          {rows.map((r, i) => (
            <div className="bk-row" key={i}>
              <input aria-label="Fee label" placeholder="Label" value={r.label} onChange={(e) => setRow(i, { label: e.target.value })} />
              <input aria-label="AED" placeholder="AED" inputMode="decimal" value={r.amount ?? ""} onChange={(e) => setRow(i, { amount: e.target.value })} />
              <input aria-label="Remarks" placeholder="Remarks" value={r.remarks ?? ""} onChange={(e) => setRow(i, { remarks: e.target.value })} />
              <Button onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : [emptyRow()]))}>Remove</Button>
            </div>
          ))}
          <Button onClick={() => setRows((rs) => [...rs, emptyRow()])}>Add fee row</Button>
          <div className="bk-modal-actions">
            <Button onClick={onClose}>{letter || !template ? "Clear" : "Cancel"}</Button>
            <Button variant="primary" busy={busy === "generate"} onClick={generate}>Generate</Button>
          </div>
        </>
      )}
    </>
  );
}
