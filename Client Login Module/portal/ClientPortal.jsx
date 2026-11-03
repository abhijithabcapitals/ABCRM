// The only screen a client ever sees. An admin sees the same screen read-only in Clients > Client Portal.
import { useState } from "react";
import "@banking/components/banking.css";
import "./portal.css";
import { Button, ErrorNote, FormModal, PageHead, Spinner, useLoad } from "@banking/components/shared";
import { portalApi } from "./portalApi";
import ServicesTab from "./ServicesTab";
import AccountsTab from "./AccountsTab";
import DocumentsTab from "./DocumentsTab";
import InformationTab from "./InformationTab";
import SetupView from "./SetupView";

// Kept here because Client Inputs imports it from this file.
export { fmtSize } from "./format";

const TABS = [["services", "Services"], ["accounts", "Accounts"], ["documents", "Documents"], ["information", "My Information"]];

export default function ClientPortal({ api = portalApi, readOnly }) {
  const me = useLoad(() => api.load(), [api]);
  const [tab, setTab] = useState("services");
  const [changing, setChanging] = useState(false);
  const props = { me: me.data, api, readOnly, reload: me.reload };
  return (
    <div className="bk-root">
      <PageHead title={me.data?.display_name || "Client Portal"} sub={readOnly ? "Preview of what this client sees. Nothing can be changed here." : "Your record with AB Capital, and a safe place to send us documents."} />
      {!readOnly && <div className="bk-actions bk-mb"><Button onClick={() => setChanging(true)}>Change password</Button><Button onClick={() => api.logout()}>Sign out</Button></div>}
      <ErrorNote message={me.error} />
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
      {changing && !readOnly && (
        <FormModal title="Change password" submitLabel="Change password" onClose={() => setChanging(false)}
          fields={[{ name: "current", label: "Current password", type: "password", required: true, full: true }, { name: "next", label: "New password", type: "password", required: true, full: true, help: "At least 10 characters." }]}
          onSubmit={async (v) => { await api.changePassword(v.current, v.next); setChanging(false); }} />
      )}
    </div>
  );
}
