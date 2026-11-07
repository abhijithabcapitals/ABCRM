import { Badge, KeyVals, Panel, fmtDate } from "@banking/components/shared";
import { statusTone } from "../../logic/statuses";
import { kycLabel } from "../../logic/kyc";
import { aedMoney as money } from "@app/money";


export default function Overview({ w, goTab }) {
  const outstanding = w.quotes.filter((q) => q.status === "accepted").reduce((n, q) => n + Number(q.balance?.outstanding || 0), 0);
  const active = w.services.filter((s) => !["Completed", "Cancelled"].includes(s.status) && !s.historical);
  const missing = w.kyc_status?.missing || [];
  return (
    <div>
      {missing.length > 0 && w.kyc?.kyc_state !== "Done" && <div className="bk-alert bk-alert-warn">KYC is incomplete: {missing.join(", ")}. A quote cannot be accepted until these are filled. <button type="button" className="bk-link" onClick={() => goTab("kyc")}>Open KYC</button></div>}
      {(!w.client.email || !w.client.phone) && <div className="bk-alert bk-alert-warn">Email or phone is missing. A quote cannot be issued until they are in Client Master. <button type="button" className="bk-link" onClick={() => goTab("kyc")}>Add them</button></div>}
      <Panel title="Client">
        <KeyVals items={[["Email", w.client.email || "Missing"], ["Phone", w.client.phone || "Missing"], ["KYC", kycLabel(w.kyc?.kyc_state, missing)], ["Status", w.kyc?.client_status || "–"],
          ["Jurisdiction", w.kyc?.jurisdiction || "–"], ["Licence", w.kyc?.licence_number || "–"], ["Licence expiry", fmtDate(w.kyc?.licence_expiry)], ["Outstanding", money(outstanding)]]} />
      </Panel>
      <Panel title="Active services">
        {active.length ? active.map((s) => <div className="bk-row" key={s.id}><span>{s.name}</span><Badge tone={statusTone(s.status)}>{s.status}</Badge></div>) : <p className="bk-note">No active services.</p>}
      </Panel>
    </div>
  );
}
