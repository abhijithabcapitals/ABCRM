// Fills one Company Library template: client details from Client Master or OCR, then typed, then fees, then Generate.
// ID documents are read in this browser and are not kept; only values left in the form are stored.
import { useEffect, useMemo, useState } from "react";
import { saveAs } from "file-saver";
import { Button, ErrorNote, FilePick, FormGrid, Modal, Spinner } from "@banking/components/shared";
import { readDocuments } from "@banking/services/bankingApi";
import { buildAutofill } from "@banking/logic/kycAutofill";
import { fieldsFor, readTags } from "../logic/libraryFields";
import { fromClientMaster, mergeAutofill } from "../logic/libraryOcr";
import { renderDocx } from "../logic/renderDocx";
import { createLibraryDocument, libraryFileBuffer, saveFile, searchClients } from "../services/hubApi";
import { generateLibraryDocument } from "../services/libraryGenerate";

const dubaiToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
const emptyRow = () => ({ label: "", amount: "", remarks: "", rate: "" });
const reading = (r) => r.replace(/ \([^()]*\)$/, "");
// Where the Client Module, when running on this PC, files a copy. Ardentax has no folder, so its copy stays in storage only.
export const pcKind = (company) => (company === "AB Capital" ? "setup_quote" : "ardentax_document");

export const libraryDeps = (company) => ({
  loadFile: libraryFileBuffer,
  create: createLibraryDocument,
  render: renderDocx,
  save: (doc, blob, name) => saveFile(doc, pcKind(company), blob, name),
});

export default function LibraryFill({ template, fileId, start, onClose, onDone }) {
  const [fields, setFields] = useState(null);
  const [values, setValues] = useState(() => ({ date: dubaiToday(), ...(start?.values || {}) }));
  const [rows, setRows] = useState(() => {
    const saved = start?.rows || template.fee_rows || [];
    return saved.length ? saved.map((r) => ({ ...emptyRow(), ...r })) : [emptyRow()];
  });
  const [clientId, setClientId] = useState(start?.clientId || null);
  const [search, setSearch] = useState("");
  const [found, setFound] = useState(null);
  const [docs, setDocs] = useState([]);
  const [filled, setFilled] = useState([]);
  const [conflicts, setConflicts] = useState({});
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const company = template.company;

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [{ default: JSZip }, buffer] = await Promise.all([import("jszip"), libraryFileBuffer(fileId)]);
        const tags = await readTags(buffer, JSZip);
        if (live) setFields(tags.hasTags ? fieldsFor(tags, company) : []);
      } catch (e) {
        if (live) setError(`This template could not be read: ${e.message}`);
      }
    })();
    return () => { live = false; };
  }, [fileId, company]);

  // Client address is kept on the record for the engagement letter, even where the template does not print it.
  const shown = useMemo(() => {
    if (!fields) return [];
    const has = fields.some((f) => f.name === "client_address");
    return has || company !== "AB Capital" ? fields : [...fields, { name: "client_address", label: "Client address (kept on the record, not printed)", full: true, type: "text" }];
  }, [fields, company]);

  const findClients = async () => {
    setError(null);
    setBusy("search");
    try { setFound(await searchClients(search)); } catch (e) { setError(e.message); }
    setBusy(null);
  };
  const pickClient = (row) => {
    const { client_id: id, ...master } = fromClientMaster(row);
    setClientId(id);
    setValues((v) => {
      const out = { ...v };
      for (const [k, val] of Object.entries(master)) if (!String(out[k] ?? "").trim()) out[k] = val;
      return out;
    });
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
      const merged = mergeAutofill(values, buildAutofill(all));
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
    const out = await generateLibraryDocument({ template, fileId, fields: shown, values, rows, usdRate: template.usd_rate, clientId }, libraryDeps(company));
    setBusy(null);
    if (!out.doc) return setError(out.error);
    if (out.error) {
      await onDone();
      return setError(`${out.doc.document_number} is saved, but its file was not: ${out.error} Use Retry in the list below.`);
    }
    saveAs(out.file.blob, out.file.name);
    await onDone();
    return onClose();
  };

  return (
    <Modal wide title={`Fill: ${template.name}`} onClose={onClose}>
      <ErrorNote message={error} onClose={() => setError(null)} />
      {!fields && !error && <Spinner />}
      {fields && !fields.length && <p className="bk-note">This template has no fields, so it can only be downloaded.</p>}
      {fields && fields.length > 0 && (
        <>
          <div className="bk-row">
            <input className="bk-search" type="search" placeholder="Search Client Master" aria-label="Search Client Master" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Button busy={busy === "search"} onClick={findClients} disabled={!search.trim()}>Search</Button>
            <FilePick label="Read passport, Emirates ID or licence" busy={busy === "ocr"} accept=".pdf,.jpg,.jpeg,.png,.bmp,.webp,.tif,.tiff" onFile={readFile} />
          </div>
          {found && (found.length
            ? <div className="bk-row">{found.map((c) => <Button key={c.client_id} onClick={() => pickClient(c)}>{c.data?.["Client Legal Name"] || c.client_id}</Button>)}</div>
            : <p className="bk-note">No client found.</p>)}
          {clientId && company === "AB Capital" && <p className="bk-note">Linked to client {clientId}. This document will show in their Business Setup workspace and client login.</p>}
          {note && <p className="bk-note">{note}</p>}
          {filled.length > 0 && <p className="bk-note">Filled by OCR: {filled.map((n) => shown.find((f) => f.name === n)?.label).filter(Boolean).join(", ") || "none on this template"}.</p>}
          {Object.entries(conflicts).filter(([tag]) => shown.some((f) => f.name === tag)).map(([tag, list]) => (
            <div className="bk-row" key={tag}>
              <span><strong>{shown.find((f) => f.name === tag).label}</strong>: documents disagree.</span>
              {list.map((r) => <Button key={r} onClick={() => setValues((v) => ({ ...v, [tag]: reading(r) }))}>{r}</Button>)}
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
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" busy={busy === "generate"} onClick={generate}>Generate</Button>
          </div>
        </>
      )}
    </Modal>
  );
}
