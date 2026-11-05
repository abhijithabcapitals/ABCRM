// The list of generated library documents, shared by Company Library and the AB Capital generators.
// documents is the useLoad result from the parent, so a new document appears straight away.
// canNew(doc) says whether New from this shows; onNew(doc) opens the form from it.
import { useState } from "react";
import { saveAs } from "file-saver";
import { Button, DataTable, fmtDate, useLoad } from "@banking/components/shared";
import { profiles } from "@banking/services/bankingApi";
import { fileNameFor } from "../logic/serviceDocs";
import { openStored, storedBlob } from "../services/hubApi";
import { retryDesign, retryLibraryDocument } from "../services/libraryGenerate";
import { designDeps, libraryDeps } from "./LibraryForm";

export const companyOf = (key) => String(key || "").split("/")[0];
const nameOf = (key) => { const parts = String(key || "").split("/"); return parts.slice(2).join("/") || parts[parts.length - 1]; };

export default function LibraryRegister({ documents, rows, profile, canNew, onNew, onError, empty = "No documents generated yet." }) {
  const staff = useLoad(profiles, []);
  const [retrying, setRetrying] = useState(null);
  const staffName = (id) => (staff.data || []).find((p) => p.id === id)?.full_name || "–";
  const act = async (fn) => {
    onError(null);
    try { await fn(); } catch (e) { onError(e.message); }
  };
  const retry = async (doc) => {
    onError(null);
    setRetrying(doc.id);
    const out = doc.library_file_id ? await retryLibraryDocument(doc, libraryDeps(companyOf(doc.library_template))) : await retryDesign(doc, designDeps(doc.doc_type === "letter" ? "letter" : "quote"));
    setRetrying(null);
    if (out.error) onError(`${doc.document_number}: the file was not saved: ${out.error}`);
    else saveAs(out.file.blob, out.file.name);
    await documents.reload();
  };
  return (
    <DataTable
      rows={rows}
      search="Search documents"
      empty={empty}
      columns={[
        { key: "document_number", label: "Ref" },
        { key: "library_template", label: "Template", render: (d) => nameOf(d.library_template) },
        { key: "client_name", label: "Client" },
        { key: "created_at", label: "Date", render: (d) => fmtDate(d.created_at) },
        { key: "created_by", label: "Staff", render: (d) => staffName(d.created_by) },
        {
          key: "file", label: "File", render: (d) => (d.storage_path
            ? <span className="bk-actions">
                <button type="button" className="bk-link" onClick={() => act(() => openStored(d.storage_path))}>Open</button>
                <button type="button" className="bk-link" onClick={() => act(async () => saveAs(await storedBlob(d.storage_path), fileNameFor(d.document_number, d.client_name)))}>Download</button>
              </span>
            : d.created_by === profile?.id
              ? <Button busy={retrying === d.id} onClick={() => retry(d)}>Retry</Button>
              : <small className="bk-muted">File not saved</small>),
        },
        { key: "again", label: "", render: (d) => canNew(d) && <button type="button" className="bk-link" onClick={() => onNew(d)}>New from this</button> },
      ]}
    />
  );
}
