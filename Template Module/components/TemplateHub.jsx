import { useState } from "react";
import "@banking/components/banking.css";
import CompanyLibrary from "./CompanyLibrary";
import ServiceDesk from "./ServiceDesk";
import HubNumbering from "./HubNumbering";
import VoucherRegister from "./VoucherRegister";

const TABS = [
  { key: "services", label: "Service Documents" },
  { key: "library", label: "Company Library" },
  { key: "vouchers", label: "Voucher Register" },
  { key: "settings", label: "⚙ Settings" },
];

export default function TemplateHub({ profile }) {
  const [tab, setTab] = useState("services");
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "calc(100vh - var(--brand-footer-h))", overflow: "hidden", background: "#f7f8fa" }}>
      <div style={{ padding: "22px 40px 0", background: "#fff", borderBottom: "1px solid #ebebeb" }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#1a1a1a", margin: 0, letterSpacing: "-0.3px" }}>
          Template Hub
        </h1>
        <div style={{ fontSize: 13, color: "#999", marginTop: 4 }}>
          Generate quotations, engagement letters and mail drafts for every service.
        </div>
        <div style={{ display: "flex", gap: 22, marginTop: 16 }}>
          {TABS.map((t) => (
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
        {tab === "vouchers" ? (
          <div className="bk-root" style={{ overflowY: "auto", flex: 1 }}><VoucherRegister /></div>
        ) : tab === "settings" ? (
          <div className="bk-root" style={{ overflowY: "auto", flex: 1 }}><HubNumbering /></div>
        ) : tab === "services" ? (
          <div className="bk-root" style={{ overflowY: "auto", flex: 1 }}><ServiceDesk profile={profile} /></div>
        ) : (
          <CompanyLibrary />
        )}
      </div>
    </div>
  );
}
