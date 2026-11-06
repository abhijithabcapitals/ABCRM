// The list of generated library documents, shared by Company Library and the AB Capital generators.
// documents is the useLoad result from the parent, so a new document appears straight away.
// canNew(doc) says whether New from this shows; onNew(doc) opens the form from it.
// Signing (optional): the status, the signed copies and Sign for an approver of the row's own company (AB Capital, or Ardentax for
// Ardentax library templates). The rules are in ../logic/librarySigning.js.
import { useState } from "react";
import { saveAs } from "file-saver";
import { Button, DataTable, fmtDate, useLoad } from "@banking/components/shared";
import { profiles } from "@banking/services/bankingApi";
import { fileNameFor } from "../logic/serviceDocs";
import { libraryFileBuffer, loadHubSettings, openStored, renderTemplate, storedBlob } from "../services/hubApi";
import { retryDesign, retryLibraryDocument } from "../services/libraryGenerate";
import { canSignSafe, hubToPdf, loadHubSignatures, signHubDocument } from "../services/signingApi";
import { librarySignState, signLibraryDocument } from "../logic/librarySigning";
import { renderDocx } from "../logic/renderDocx";
import { designDeps, libraryDeps } from "./LibraryForm";
import HubSignCell from "./HubSignCell";

export const companyOf = (key) => String(key || "").split("/")[0];
const nameOf = (key) => { const parts = String(key || "").split("/"); return parts.slice(2).join("/") || parts[parts.length - 1]; };

export default function LibraryRegister({ documents, rows, profile, canNew, onNew, onError, empty = "No documents generated yet." }) {
  const staff = useLoad(profiles, []);
  const [retrying, setRetrying] = useState(null);
  const [signing, setSigning] = useState(null);
  const files = (rows || []).map((d) => `${d.id}:${d.storage_path || ""}`).join(",");
  const approvers = useLoad(async () => {
    const [ab, ax] = await Promise.all([canSignSafe("ab_capital"), canSignSafe("ardentax")]);
    return { ab_capital: ab, ardentax: ax };
  }, []);
  const sigs = useLoad(() => loadHubSignatures(files ? files.split(",").map((x) => x.split(":")[0]) : []), [files]);
  const signOf = (d) => ({ approvers: approvers.data || {}, signing: sigs.data?.[d.id] || null });
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
  // An approver signs a filed document: re-rendered from its row with the company signature, beside the unsigned file.
  const sign = async (doc) => {
    onError(null);
    setSigning(doc.id);
    const out = await signLibraryDocument(doc, {
      sign: (args) => signHubDocument(args, { toPdf: hubToPdf }), loadFile: libraryFileBuffer, loadSettings: loadHubSettings, renderFill: renderDocx, renderDesign: renderTemplate,
    });
    setSigning(null);
    if (out.error) onError(`${doc.document_number}: ${out.error}`);
    else await sigs.reload();
  };
  return (
    <>
    {sigs.error && <p className="bk-note">The signatures could not be loaded: {sigs.error}</p>}
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
                <button type="button" className="bk-link" onClick={() => act(() => openStored(d.storage_path))}>{librarySignState(d, signOf(d)).openLabel}</button>
                <button type="button" className="bk-link" onClick={() => act(async () => saveAs(await storedBlob(d.storage_path), fileNameFor(d.document_number, d.client_name)))}>{librarySignState(d, signOf(d)).copies.length ? "Download unsigned" : "Download"}</button>
              </span>
            : d.created_by === profile?.id
              ? <Button busy={retrying === d.id} onClick={() => retry(d)}>Retry</Button>
              : <small className="bk-muted">File not saved</small>),
        },
        {
          key: "signature", label: "Signature", render: (d) => <HubSignCell state={librarySignState(d, signOf(d))} signing={signOf(d).signing} busy={signing === d.id}
            onSign={() => sign(d)} onOpen={(path) => act(() => openStored(path))} />,
        },
        { key: "again", label: "", render: (d) => canNew(d) && <button type="button" className="bk-link" onClick={() => onNew(d)}>New from this</button> },
      ]}
    />
    </>
  );
}
