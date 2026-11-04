// One client: everything the department holds on them, one tab per subject.
import { useState } from "react";
import { Button, ErrorNote, PageHead, Spinner, useLoad } from "@banking/components/shared";
import { useSetup } from "./SetupContext";
import { workspace } from "../services/businessSetupApi";
import Overview from "./workspace/Overview";
import Kyc from "./workspace/Kyc";
import ClientCases from "./workspace/ClientCases";
import Services from "./workspace/Services";
import Visas from "./workspace/Visas";
import Quotes from "./workspace/Quotes";
import Payments from "./workspace/Payments";
import Files from "./workspace/Files";
import Activity from "./workspace/Activity";
import ClientLogin from "./workspace/ClientLogin";

const TABS = [["overview", "Overview", Overview, "setup.access"], ["kyc", "KYC", Kyc, "setup.access"], ["cases", "Cases", ClientCases, "setup.access"], ["services", "Services", Services, "setup.access"], ["visas", "Visas", Visas, "setup.access"], ["quotes", "Quotes & Agreements", Quotes, "setup.access"],
  ["payments", "Payments", Payments, "setup.access"], ["documents", "Documents", Files, "setup.access"], ["activity", "Tasks & Activity", Activity, "setup.access"], ["login", "Client Login", ClientLogin, "setup.portal.manage"]];

export default function Workspace({ clientId, onBack }) {
  const { can } = useSetup();
  const data = useLoad(() => workspace(clientId), [clientId]);
  const [tab, setTab] = useState("overview");
  const tabs = TABS.filter(([, , , perm]) => can(perm));
  const Current = tabs.find(([k]) => k === tab)?.[2] || Overview;
  return (
    <div>
      <PageHead title={data.data?.client?.legal_name || clientId} sub={clientId}><Button onClick={onBack}>Back to clients</Button></PageHead>
      <ErrorNote message={data.error} />
      <div className="bk-tabs" role="tablist" aria-label="Client">
        {tabs.map(([k, label]) => <button type="button" role="tab" aria-selected={tab === k} key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      {data.loading && !data.data ? <Spinner /> : data.data && <Current w={data.data} clientId={clientId} reload={data.reload} goTab={setTab} />}
    </div>
  );
}
