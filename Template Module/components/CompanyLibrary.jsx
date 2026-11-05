// The Word templates uploaded in Template Hub > Settings, by company and folder, and the documents generated from them.
import { useMemo, useState } from "react";
import { saveAs } from "file-saver";
import "@banking/components/banking.css";
import { IconDownload, IconFile } from "@app/components/icons";
import { Button, DataTable, ErrorNote, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { profiles } from "@banking/services/bankingApi";
import { libraryAccess, libraryFileUrl, listLibraryDocuments, listLibraryTemplates, openStored, storedBlob } from "../services/hubApi";
import { retryLibraryDocument } from "../services/libraryGenerate";
import LibraryFill, { libraryDeps } from "./LibraryFill";

const companyOf = (key) => String(key || "").split("/")[0];
const nameOf = (key) => String(key || "").split("/").slice(2).join("/");

export const groupTemplates = (templates) => {
  const out = {};
  for (const t of templates) {
    if (!t.active) continue;
    ((out[t.company] ||= {})[t.folder] ||= []).push(t);
  }
  return out;
};

export default function CompanyLibrary({ profile }) {
  const access = useLoad(libraryAccess, []);
  const templates = useLoad(listLibraryTemplates, []);
  const documents = useLoad(listLibraryDocuments, []);
  const staff = useLoad(profiles, []);
  const library = useMemo(() => groupTemplates(templates.data || []), [templates.data]);
  const companies = Object.keys(library).sort();
  const [picked, setPicked] = useState(null);
  const company = picked && library[picked] ? picked : companies[0];
  const folders = library[company] || {};
  const [filter, setFilter] = useState("");
  const [fill, setFill] = useState(null);
  const [error, setError] = useState(null);
  const [retrying, setRetrying] = useState(null);

  const allowed = (t) => (t.company === "AB Capital" ? access.data?.ab : t.company === "Ardentax" ? access.data?.ardentax : false);
  const open = async (fileId) => {
    setError(null);
    try { window.open(await libraryFileUrl(fileId), "_blank", "noopener"); } catch (e) { setError(e.message); }
  };
  const act = async (fn) => {
    setError(null);
    try { await fn(); } catch (e) { setError(e.message); }
  };
  const retry = async (doc) => {
    setError(null);
    setRetrying(doc.id);
    const out = await retryLibraryDocument(doc, libraryDeps(companyOf(doc.library_template)));
    setRetrying(null);
    if (out.error) setError(`${doc.document_number}: the file was not saved: ${out.error}`);
    else saveAs(out.file.blob, out.file.name);
    await documents.reload();
  };
  const newFrom = (doc) => {
    const t = (templates.data || []).find((x) => x.template_key === doc.library_template);
    if (!t?.active || !t.file) return setError("That template is retired or has no file, so a new document cannot be made from it.");
    const { usd_rate: _rate, date: _date, ...values } = doc.field_values || {};
    return setFill({
      template: t,
      start: { values, clientId: doc.client_id, rows: (doc.lines || []).map((l) => ({ label: l.description, amount: l.amount, remarks: l.remarks, rate: l.rate })) },
    });
  };
  const staffName = (id) => (staff.data || []).find((p) => p.id === id)?.full_name || "–";
  const rows = (documents.data || []).filter((d) => !filter || companyOf(d.library_template) === filter);
  const docCompanies = [...new Set((documents.data || []).map((d) => companyOf(d.library_template)))].sort();

  if (templates.loading && !templates.data) return <Spinner />;
  return (
    <div className="bk-root" style={{ padding: "24px 40px", overflowY: "auto" }}>
      <ErrorNote message={error || templates.error || access.error || documents.error} onClose={() => setError(null)} />
      <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "#555", marginBottom: 18 }}>
        Company
        <select value={company || ""} onChange={(e) => setPicked(e.target.value)} style={{ width: "auto", padding: "7px 10px", borderRadius: 7, border: "1px solid #e0e0e0", fontSize: 13, background: "#fff" }}>
          {companies.map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      {!companies.length && <div style={{ color: "#999", fontSize: 13 }}>No company templates yet. They are uploaded in Settings.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16, alignItems: "start" }}>
        {Object.keys(folders).sort().map((folder) => (
          <section key={folder} style={{ border: "1px solid #ebebeb", borderRadius: 10, background: "#fff", padding: 14 }}>
            <h3 style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 700, color: "#1a1a1a" }}>{folder}</h3>
            {folders[folder].map((t) => (
              <div key={t.template_key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 2px", borderTop: "1px solid #f3f3f3", color: "#333", fontSize: 13 }}>
                <IconFile size={15} /><span style={{ flex: 1 }}>{t.name}</span>
                {!t.file && <small className="bk-muted">No file yet</small>}
                {t.file && allowed(t) && <Button onClick={() => setFill({ template: t })}>Fill</Button>}
                {t.file && <button type="button" className="bk-link" aria-label={`Download ${t.name}`} onClick={() => open(t.file.id)}><IconDownload size={15} /></button>}
              </div>
            ))}
          </section>
        ))}
      </div>

      <h3 style={{ margin: "28px 0 10px", fontSize: 14, fontWeight: 700, color: "#1a1a1a" }}>Generated documents</h3>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "#555", marginBottom: 12 }}>
        Company
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: "auto", padding: "7px 10px", borderRadius: 7, border: "1px solid #e0e0e0", fontSize: 13, background: "#fff" }}>
          <option value="">All</option>
          {docCompanies.map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      <DataTable
        rows={rows}
        search="Search documents"
        empty="No documents generated yet."
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
                  <button type="button" className="bk-link" onClick={() => act(async () => saveAs(await storedBlob(d.storage_path), `${String(d.document_number).replace(/[/\\]+/g, "-")}.docx`))}>Download</button>
                </span>
              : d.created_by === profile?.id
                ? <Button busy={retrying === d.id} onClick={() => retry(d)}>Retry</Button>
                : <small className="bk-muted">File not saved</small>),
          },
          { key: "again", label: "", render: (d) => <button type="button" className="bk-link" onClick={() => newFrom(d)}>New from this</button> },
        ]}
      />
      {fill && <LibraryFill template={fill.template} fileId={fill.template.file.id} start={fill.start} onClose={() => setFill(null)} onDone={documents.reload} />}
    </div>
  );
}
