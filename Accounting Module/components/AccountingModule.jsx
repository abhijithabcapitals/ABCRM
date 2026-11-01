// The Accounting page: one tab per business line that hands work to Accounts.
import { useState } from "react";
import "@banking/components/banking.css";
import { ErrorNote, Spinner, useLoad } from "@banking/components/shared";
import { rpc } from "@banking/services/bankingApi";
import BankingValidation from "./BankingValidation";

const TABS = [["banking", "Business Banking"], ["setup", "Business Setup"]];

export default function AccountingModule() {
  const access = useLoad(() => rpc("banking_my_access"), []);
  const [tab, setTab] = useState("banking");
  if (access.loading && !access.data) return <div className="bk-root"><Spinner /></div>;
  if (!access.data?.permissions?.includes("accounts.review")) {
    return <div className="bk-root"><h1>Accounting</h1><ErrorNote message={access.error} /><p className="bk-note">Only the Accounts team can open this page. An administrator can assign the ACCOUNTS role in Business Banking settings.</p></div>;
  }
  return (
    <div className="bk-root">
      <header className="bk-header"><span className="bk-eyebrow">AB CAPITAL SERVICES FZE</span><h1>Accounting</h1></header>
      <nav className="bk-nav" aria-label="Accounting">
        {TABS.map(([k, label]) => <button type="button" key={k} data-label={label} aria-current={tab === k ? "page" : undefined} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{label}</button>)}
      </nav>
      {tab === "banking" && <BankingValidation />}
      {tab === "setup" && <p className="bk-note">Nothing here yet. Business Setup cases will appear once that module is built.</p>}
    </div>
  );
}
