// One card per banking case: the step the case is at, as a bar, or its final outcome.
import { Empty, KeyVals, Panel } from "@banking/components/shared";
import { bankingProgress } from "../logic/progress";
import { showDate } from "./format";

function ServiceCard({ s }) {
  const p = bankingProgress(s);
  const a = s.account;
  return (
    <article className="pt-card">
      <h4>{s.account_kind || "Business banking"}</h4>
      {s.bank && <span className="pt-muted">{s.bank}</span>}
      <strong>{p.label}</strong>
      {p.percent !== null && (
        <>
          <div className="pt-bar" role="progressbar" aria-label={`${s.account_kind || "Business banking"} progress`} aria-valuenow={p.percent} aria-valuemin="0" aria-valuemax="100">
            <div className="pt-bar-fill" style={{ width: `${p.percent}%` }} />
          </div>
          <small>{p.percent}% complete</small>
        </>
      )}
      {a && <KeyVals items={[["Bank", a.bank], ["Account name", a.account_name], ["Opened on", showDate(a.opened_on)], ["IBAN", a.iban_masked]]} />}
    </article>
  );
}

export default function ServicesTab({ me }) {
  const services = me.banking_services || [];
  return (
    <>
      <Panel title="Your services" sub="Where each application with AB Capital Services FZE stands.">
        {services.length ? <div className="pt-cards">{services.map((s) => <ServiceCard key={s.case_id} s={s} />)}</div> : <Empty>Nothing recorded yet.</Empty>}
      </Panel>
      {me.master_services && <Panel title="Services provided"><p>{me.master_services}</p></Panel>}
    </>
  );
}
