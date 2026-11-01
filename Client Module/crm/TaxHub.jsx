// The CRM's Tax Compliance page: the local compliance tracker, plus the department's services and documents.
import { useState } from "react";
import "@banking/components/banking.css";
import Clients from "@app/components/Clients";
import ServiceDesk from "@template-hub/components/ServiceDesk";

export default function TaxHub({ profile }) {
  const [view, setView] = useState("compliance");
  return (
    <div>
      <div className="bk-root bk-hub-tabs">
        <nav className="bk-nav" aria-label="Tax Compliance">
          {[["compliance", "Compliance"], ["services", "Services & Documents"]].map(([k, label]) => <button type="button" key={k} data-label={label} aria-current={view === k ? "page" : undefined} className={view === k ? "active" : ""} onClick={() => setView(k)}>{label}</button>)}
        </nav>
      </div>
      {view === "compliance" ? <Clients profile={profile} page="/tax" title="Tax Compliance" subtitle="Tax Agent · VAT, Corporate Tax & renewals" /> : <div className="bk-root"><ServiceDesk department="Tax Compliance" profile={profile} /></div>}
    </div>
  );
}
