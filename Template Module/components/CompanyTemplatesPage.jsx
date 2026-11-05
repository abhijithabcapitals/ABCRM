import { Suspense, lazy, useEffect, useState } from "react";
import defaultManifest from "../Template Docs/manifest.json";
import { COMPANIES, TEMPLATE_TYPES, templatesFor } from "../logic/companyTemplates";

// Brings in the Word and PDF tools, so it loads only when opened.
const ArdentTaxTab = lazy(() => import("../ardentax/components/ArdentTaxTab"));
const AbCapitalGenerator = lazy(() => import("./AbCapitalGenerator"));

// The columns of a company that open a generator, by template type.
const GENERATORS = { ardentax: { quote: "quote", el: "letter" }, ab_capital: { quote: "quote", el: "letter" } };

// Company template library: pick a company, see its Quote / EL / Email /
// Social templates side by side. The Quote and Engagement Letter of Ardentax and
// AB Capital open their generators; other columns are structure only for now.
// ArdentaxPane: the development page passes one with the fake backend.
export default function CompanyTemplatesPage({ manifest = defaultManifest, canArdentax = false, ArdentaxPane = ArdentTaxTab, profile }) {
  const [companyKey, setCompanyKey] = useState(COMPANIES[0].key);
  const [openType, setOpenType] = useState(null);
  const company = COMPANIES.find((c) => c.key === companyKey) || COMPANIES[0];
  const generators = GENERATORS[company.key] || {};
  const opened = TEMPLATE_TYPES.find((t) => t.key === openType && generators[t.key]);
  const isAb = company.key === "ab_capital";
  // Asked only when AB Capital is chosen. The database checks this again when a document is made.
  const [abAllowed, setAbAllowed] = useState(false);
  useEffect(() => {
    if (!isAb) return undefined;
    let live = true;
    import("../services/hubApi").then((m) => m.libraryAccess()).then((a) => { if (live) setAbAllowed(!!a?.ab); }).catch(() => { if (live) setAbAllowed(false); });
    return () => { live = false; };
  }, [isAb]);
  const allowed = isAb ? abAllowed : canArdentax;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "calc(100vh - var(--brand-footer-h))", overflow: "hidden", background: "#f7f8fa" }}>
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
            onChange={(e) => { setCompanyKey(e.target.value); setOpenType(null); }}
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

      {opened ? (
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 40px 28px" }}>
          <button type="button" onClick={() => setOpenType(null)} style={{ border: "none", background: "none", padding: 0, marginBottom: 14, color: "var(--accent)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            ← All {company.label} templates
          </button>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#1a1a1a", margin: "0 0 14px" }}>{opened.label}</h2>
          <Suspense fallback={<div style={{ color: "#9ca3af", fontSize: 13 }}>Loading…</div>}>
            {isAb ? <AbCapitalGenerator key={opened.key} docType={generators[opened.key]} profile={profile} /> : <ArdentaxPane key={opened.key} docType={generators[opened.key]} />}
          </Suspense>
        </div>
      ) : (
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
                {generators[type.key] ? (
                  allowed ? (
                    <button type="button" onClick={() => setOpenType(type.key)} style={{ alignSelf: "flex-start", padding: "8px 12px", border: "1px solid var(--accent)", borderRadius: 7, background: "#fff", color: "var(--accent)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      Open {type.label}
                    </button>
                  ) : (
                    <div style={{ fontSize: 13, color: "#9ca3af" }}>{isAb ? "Needs the Business Setup quotes right from an admin." : "Needs the ArdentTax (ASP) access from an admin."}</div>
                  )
                ) : items.length === 0 ? (
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
      )}
    </div>
  );
}
