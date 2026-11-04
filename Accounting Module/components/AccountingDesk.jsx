// The Accounting tab: pipeline, follow-ups and the quotes and agreements desk.
import { useState } from "react";
import { useLoad } from "@banking/components/shared";
import ServiceDesk from "@template-hub/components/ServiceDesk";
import { followUpsDueCount } from "../services/jobsApi";
import FollowUps from "./FollowUps";
import JobWorkspace from "./JobWorkspace";
import Pipeline from "./Pipeline";

const TABS = [["pipeline", "Pipeline"], ["followups", "Follow-ups"], ["quotes", "Quotes and Agreements"]];

export default function AccountingDesk({ profile }) {
  const [tab, setTab] = useState("pipeline");
  const [openJobId, setOpenJobId] = useState(null);
  const [listKey, setListKey] = useState(0); // the list reloads after a job was open, since the workspace may have changed it
  const due = useLoad(followUpsDueCount, []);
  return (
    <div>
      <div className="bk-tabs" role="tablist" aria-label="Accounting desk">
        {TABS.map(([k, label]) => (
          <button type="button" role="tab" key={k} aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
            {label}{k === "followups" && due.data > 0 && <> <span className="bk-tab-count">{due.data}</span></>}
          </button>
        ))}
      </div>
      {tab === "pipeline" && <Pipeline key={listKey} onOpen={setOpenJobId} />}
      {tab === "followups" && <FollowUps key={listKey} onOpen={setOpenJobId} />}
      {openJobId && <JobWorkspace jobId={openJobId} profile={profile} onClose={() => { setOpenJobId(null); setListKey((k) => k + 1); due.reload(); }} />}
      {tab === "quotes" && <ServiceDesk department="Accounting" profile={profile} />}
    </div>
  );
}
