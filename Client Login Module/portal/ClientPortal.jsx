// The only screen a client ever sees. An admin sees the same screen read-only in Clients > Client Portal.
import { useState } from "react";
import "@banking/components/banking.css";
import "./portal.css";
import { Button, ErrorNote, PageHead, Spinner, useLoad } from "@banking/components/shared";
import { portalApi } from "./portalApi";
import ServicesTab from "./ServicesTab";
import AccountsTab from "./AccountsTab";
import DocumentsTab from "./DocumentsTab";
import InformationTab from "./InformationTab";
import SetupView from "./SetupView";
import TermsGate from "./TermsGate";
import RequestsPanel from "./RequestsPanel";

// Kept here because Client Inputs imports it from this file.
export { fmtSize } from "./format";

const TABS = [["services", "Services"], ["accounts", "Accounts"], ["documents", "Documents"], ["information", "My Information"]];

// The Terms come first: nothing else loads until this login has agreed. An admin's read-only preview skips them.
export default function ClientPortal({ api = portalApi, readOnly }) {
  const terms = useLoad(() => (readOnly ? Promise.resolve({ required: false }) : api.terms()), [api, readOnly]);
  if (terms.error) return <div className="bk-root"><ErrorNote message={terms.error} /><div className="bk-actions"><Button onClick={() => terms.reload()}>Try again</Button> <Button onClick={() => api.logout()}>Sign out</Button></div></div>;
  if (!terms.data) return <div className="bk-root"><Spinner /></div>;
  if (terms.data.required) return <TermsGate terms={terms.data} api={api} onAgreed={terms.reload} />;
  return <PortalScreen api={api} readOnly={readOnly} />;
}

function PortalScreen({ api, readOnly }) {
  const me = useLoad(() => api.load(), [api]);
  const [tab, setTab] = useState("services");
  const props = { me: me.data, api, readOnly, reload: me.reload };
  return (
    <div className="bk-root">
      <PageHead title={me.data?.display_name || "Client Portal"} sub={readOnly ? "Preview of what this client sees. Nothing can be changed here." : "Your record with AB Capital Services FZE, and a safe place to send us documents."} />
      {!readOnly && <div className="bk-actions bk-mb"><Button onClick={() => api.logout()}>Sign out</Button></div>}
      <ErrorNote message={me.error} />
      {!readOnly && <RequestsPanel api={api} />}
      {!readOnly && <SetupView api={api} />}
      {me.loading && !me.data ? <Spinner /> : me.data && <>
        <div className="bk-tabs" role="tablist" aria-label="Your portal">
          {TABS.map(([k, label]) => <button type="button" role="tab" aria-selected={tab === k} key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{label}</button>)}
        </div>
        <div role="tabpanel">
          {tab === "services" && <ServicesTab {...props} />}
          {tab === "accounts" && <AccountsTab {...props} />}
          {tab === "documents" && <DocumentsTab {...props} />}
          {tab === "information" && <InformationTab {...props} />}
        </div>
      </>}
    </div>
  );
}
