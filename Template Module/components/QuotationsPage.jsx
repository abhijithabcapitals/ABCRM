import { useState, useEffect } from "react";
import GenerateTab from "./GenerateTab";
import TemplatesTab from "./TemplatesTab";
import { fetchTemplates as loadTemplates, downloadTemplateBuffer } from "../services/templatesApi";

export default function Quotations({ profile }) {
  const [tab, setTab] = useState("generate");
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTemplates();
  }, []);

  async function fetchTemplates() {
    setLoading(true);
    setTemplates(await loadTemplates());
    setLoading(false);
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: "#f7f8fa" }}>
      {/* Header */}
      <div style={{ padding: "22px 40px 0", background: "#fff", borderBottom: "1px solid #ebebeb" }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#1a1a1a", margin: 0, letterSpacing: "-0.3px" }}>
          Quotations
        </h1>
        <div style={{ fontSize: 13, color: "#999", marginTop: 4 }}>
          Generate quotation documents from your freezone templates.
        </div>
        <div style={{ display: "flex", gap: 22, marginTop: 16 }}>
          {[
            { key: "generate", label: "Generate" },
            { key: "templates", label: "Templates" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                border: "none",
                background: "none",
                padding: "0 0 12px",
                fontSize: 14,
                fontWeight: tab === t.key ? 700 : 500,
                color: tab === t.key ? "var(--accent)" : "#888",
                borderBottom: `2px solid ${tab === t.key ? "var(--accent)" : "transparent"}`,
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "28px 40px" }}>
        {loading ? (
          <div style={{ color: "#9ca3af", fontSize: 13 }}>Loading…</div>
        ) : tab === "generate" ? (
          <GenerateTab templates={templates} downloadTemplateBuffer={downloadTemplateBuffer} profile={profile} />
        ) : (
          <TemplatesTab
            templates={templates}
            profile={profile}
            onChanged={fetchTemplates}
            downloadTemplateBuffer={downloadTemplateBuffer}
          />
        )}
      </div>
    </div>
  );
}
