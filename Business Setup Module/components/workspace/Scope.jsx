// Scope tab: what the client takes from us. Services (lines and fees) and Visas, one sub-tab each.
import ClientServices from "./ClientServices";
import Visas from "./Visas";

export const SCOPE_TABS = [["services", "Services", ClientServices], ["visas", "Visas", Visas]];

export default function Scope({ sub = "services", setSub, ...props }) {
  const Current = SCOPE_TABS.find(([k]) => k === sub)?.[2] || ClientServices;
  return (
    <div>
      <div className="bk-tabs" role="tablist" aria-label="Scope">
        {SCOPE_TABS.map(([k, label]) => <button type="button" role="tab" aria-selected={sub === k} key={k} className={sub === k ? "active" : ""} onClick={() => setSub(k)}>{label}</button>)}
      </div>
      <Current {...props} />
    </div>
  );
}
