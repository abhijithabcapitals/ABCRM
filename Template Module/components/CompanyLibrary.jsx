// The Word files kept under "Template Docs", grouped by company and type. Reads the folder at build time,
// so a .docx added there appears at the next deploy.
import { useState } from "react";
import { IconDownload, IconFile } from "@app/components/icons";

const FILES = import.meta.glob("../Template Docs/*/*/*.docx", { eager: true, query: "?url", import: "default" });

export const groupFiles = (files) => {
  const out = {};
  for (const [path, url] of Object.entries(files)) {
    const [company, folder, file] = path.split("Template Docs/")[1].split("/");
    ((out[company] ||= {})[folder] ||= []).push({ name: file.replace(/\.docx$/i, ""), file, url });
  }
  return out;
};

export default function CompanyLibrary() {
  const library = groupFiles(FILES);
  const companies = Object.keys(library).sort();
  const [company, setCompany] = useState(companies[0]);
  const folders = library[company] || {};
  return (
    <div style={{ padding: "24px 40px", overflowY: "auto" }}>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "#555", marginBottom: 18 }}>
        Company
        <select value={company || ""} onChange={(e) => setCompany(e.target.value)} style={{ width: "auto", padding: "7px 10px", borderRadius: 7, border: "1px solid #e0e0e0", fontSize: 13, background: "#fff" }}>
          {companies.map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      {!companies.length && <div style={{ color: "#999", fontSize: 13 }}>No company templates yet.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16, alignItems: "start" }}>
        {Object.keys(folders).sort().map((folder) => (
          <section key={folder} style={{ border: "1px solid #ebebeb", borderRadius: 10, background: "#fff", padding: 14 }}>
            <h3 style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 700, color: "#1a1a1a" }}>{folder}</h3>
            {folders[folder].map((f) => (
              <a key={f.file} href={f.url} download={f.file} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 2px", borderTop: "1px solid #f3f3f3", color: "#333", fontSize: 13, textDecoration: "none" }}>
                <IconFile size={15} /><span style={{ flex: 1 }}>{f.name}</span><IconDownload size={15} />
              </a>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
