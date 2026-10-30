import { useState } from "react";
import defaultManifest from "../Template Docs/manifest.json";
import { COMPANIES, TEMPLATE_TYPES, templatesFor } from "../logic/companyTemplates";

// Company template library: pick a company, see its Quote / EL / Email /
// Social templates side by side. Structure only for now — actions on each
// template (open, fill, copy) come later.
export default function CompanyTemplatesPage({ manifest = defaultManifest }) {
  const [companyKey, setCompanyKey] = useState(COMPANIES[0].key);
  const company = COMPANIES.find((c) => c.key === companyKey) || COMPANIES[0];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: "#f7f8fa" }}>
      {/* Header */}
      <div
        style={{
          padding: "22px 40px 18px",
          background: "#fff",
          borderBottom: "1px solid #ebebeb",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#1a1a1a", margin: 0, letterSpacing: "-0.3px" }}>
            Templates
          </h1>
          <div style={{ fontSize: 13, color: "#999", marginTop: 4 }}>
            Quotes, engagement letters, emails and social posts for each company.
          </div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#555" }}>
          Company
          <select
            value={companyKey}
            onChange={(e) => setCompanyKey(e.target.value)}
            style={{ padding: "7px 10px", borderRadius: 7, border: "1px solid #e0e0e0", fontSize: 13, background: "#fff", minWidth: 220 }}
          >
            {COMPANIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Columns */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "28px 40px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
          alignContent: "start",
        }}
      >
        {TEMPLATE_TYPES.map((type) => {
          const items = templatesFor(manifest, company, type);
          return (
            <div key={type.key} style={{ background: "#fff", border: "1px solid #ebebeb", borderRadius: 10, minHeight: 220 }}>
              <div style={{ padding: "14px 16px", borderBottom: "1px solid #f0f0f0" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a1a" }}>{type.label}</div>
                {type.sub && <div style={{ fontSize: 12, color: "#999", marginTop: 2 }}>{type.sub}</div>}
              </div>
              <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                {items.length === 0 ? (
                  <div style={{ fontSize: 13, color: "#9ca3af" }}>No templates yet.</div>
                ) : (
                  items.map((t) => (
                    <div
                      key={t.file}
                      style={{ fontSize: 13, color: "#333", padding: "8px 10px", border: "1px solid #f0f0f0", borderRadius: 7 }}
                    >
                      {t.name || t.file}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
