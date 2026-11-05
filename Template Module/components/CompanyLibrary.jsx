// The Word templates uploaded in Template Hub > Settings, by company and folder, and the documents generated from them.
// AB Capital documents are generated in Company Templates, so Fill here is for Ardentax.
import { useMemo, useState } from "react";
import "@banking/components/banking.css";
import { IconDownload, IconFile } from "@app/components/icons";
import { Button, ErrorNote, Spinner, useLoad } from "@banking/components/shared";
import { libraryAccess, libraryFileUrl, listLibraryDocuments, listLibraryTemplates } from "../services/hubApi";
import LibraryFill from "./LibraryFill";
import LibraryRegister, { companyOf } from "./LibraryRegister";

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
  const library = useMemo(() => groupTemplates(templates.data || []), [templates.data]);
  const companies = Object.keys(library).sort();
  const [picked, setPicked] = useState(null);
  const company = picked && library[picked] ? picked : companies[0];
  const folders = library[company] || {};
  const [filter, setFilter] = useState("");
  const [fill, setFill] = useState(null);
  const [error, setError] = useState(null);

  const open = async (fileId) => {
    setError(null);
    try { window.open(await libraryFileUrl(fileId), "_blank", "noopener"); } catch (e) { setError(e.message); }
  };
  const canNew = (doc) => companyOf(doc.library_template) === "Ardentax" && access.data?.ardentax;
  const newFrom = (doc) => {
    const t = (templates.data || []).find((x) => x.template_key === doc.library_template);
    if (!t?.active || !t.file) return setError("That template is retired or has no file, so a new document cannot be made from it.");
    const { usd_rate: _rate, date: _date, ...values } = doc.field_values || {};
    return setFill({
      template: t,
      start: { values, clientId: doc.client_id, rows: (doc.lines || []).map((l) => ({ label: l.description, amount: l.amount, remarks: l.remarks, rate: l.rate })) },
    });
  };
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
      {company === "AB Capital" && <p className="bk-note">AB Capital quotes and engagement letters are generated in Company Templates.</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16, alignItems: "start" }}>
        {Object.keys(folders).sort().map((folder) => (
          <section key={folder} style={{ border: "1px solid #ebebeb", borderRadius: 10, background: "#fff", padding: 14 }}>
            <h3 style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 700, color: "#1a1a1a" }}>{folder}</h3>
            {folders[folder].map((t) => (
              <div key={t.template_key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 2px", borderTop: "1px solid #f3f3f3", color: "#333", fontSize: 13 }}>
                <IconFile size={15} /><span style={{ flex: 1 }}>{t.name}</span>
                {!t.file && <small className="bk-muted">No file yet</small>}
                {t.file && t.company === "Ardentax" && access.data?.ardentax && <Button onClick={() => setFill({ template: t })}>Fill</Button>}
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
      <LibraryRegister documents={documents} rows={rows} profile={profile} canNew={canNew} onNew={newFrom} onError={setError} />
      {fill && <LibraryFill template={fill.template} fileId={fill.template.file.id} start={fill.start} onClose={() => setFill(null)} onDone={documents.reload} onFailed={setError} />}
    </div>
  );
}
