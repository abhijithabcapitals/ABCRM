// One option of an Accounting quote: package, description, notes, services with fee basis, sub services and totals per basis.
// Options and bases are never added together here.
import { Button, fmtDate } from "@banking/components/shared";
import { BASES, optionFromPackage, serviceAmount, totalsByBasis } from "../logic/accountingQuote";
import { fromLines, moveRow, toLines } from "../logic/accountingUi";

const plain = (n) => Number(n || 0).toLocaleString("en-AE", { maximumFractionDigits: 2 });
const isPriced = (basis) => !!BASES.find((b) => b.key === basis)?.priced;
const newService = () => ({ name: "", basis: "month", amount: "", subs: [] });

export default function AccountingOption({ option, index, count, packages, onChange, onRemove }) {
  const id = `ao-${index}`;
  const set = (k, v) => onChange({ ...option, [k]: v });
  const services = option.services || [];
  const setService = (i, patch) => set("services", services.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const pickPackage = (key) => {
    const pkg = packages.find((p) => p.package_key === key);
    onChange(pkg ? optionFromPackage(pkg) : { ...option, package_key: null });
  };
  const chosen = packages.find((p) => p.package_key === option.package_key);
  const totals = totalsByBasis(option);

  return (
    <div className="bk-panel" style={{ marginBottom: 12 }}>
      <div className="bk-panel-head">
        <div><h3>Option {index + 1}</h3></div>
        <div className="bk-actions">{count > 1 && <Button onClick={onRemove}>Remove option</Button>}</div>
      </div>
      <div className="bk-grid">
        <div className="bk-field">
          <label htmlFor={`${id}-pkg`}>Saved package</label>
          <select id={`${id}-pkg`} value={option.package_key || ""} onChange={(e) => pickPackage(e.target.value)}>
            <option value="">None: start from blank</option>
            {packages.map((p) => <option key={p.package_key} value={p.package_key}>{p.name}</option>)}
          </select>
          {chosen && <small className="bk-muted">Package last updated {fmtDate(chosen.updated_at)}. The quote keeps its own copy.</small>}
        </div>
        <div className="bk-field"><label htmlFor={`${id}-name`}>Package name <em>*</em></label><input id={`${id}-name`} value={option.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div className="bk-field bk-full"><label htmlFor={`${id}-desc`}>Description</label><textarea id={`${id}-desc`} rows={2} value={option.description} onChange={(e) => set("description", e.target.value)} /></div>
      </div>

      <div className="bk-table-wrap bk-mt">
        <table className="bk-table">
          <thead><tr><th>#</th><th>Service</th><th>Fee basis</th><th className="bk-right">Amount (AED, excl. VAT)</th><th /></tr></thead>
          <tbody>
            {services.map((s, i) => {
              const subs = s.subs || [];
              const priced = isPriced(s.basis);
              const setSub = (k, patch) => setService(i, { subs: subs.map((b, j) => (j === k ? { ...b, ...patch } : b)) });
              return [
                <tr key={`s${i}`}>
                  <td data-label="#">{i + 1}</td>
                  <td data-label="Service"><input aria-label={`Service ${i + 1} name`} value={s.name} onChange={(e) => setService(i, { name: e.target.value })} /></td>
                  <td data-label="Fee basis">
                    <select aria-label={`Service ${i + 1} fee basis`} value={s.basis} onChange={(e) => setService(i, isPriced(e.target.value) ? { basis: e.target.value } : { basis: e.target.value, amount: null, subs: [] })}>
                      {BASES.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
                    </select>
                  </td>
                  <td data-label="Amount" className="bk-right">
                    {!priced ? <small className="bk-muted">No amount</small>
                      : subs.length ? <span title="The sum of the sub services">{plain(serviceAmount(s))}</span>
                      : <input aria-label={`Service ${i + 1} amount`} type="number" min="0" step="any" value={s.amount ?? ""} onChange={(e) => setService(i, { amount: e.target.value })} />}
                  </td>
                  <td>
                    <span className="bk-actions">
                      <button type="button" className="bk-link" disabled={i === 0} onClick={() => set("services", moveRow(services, i, -1))}>Up</button>
                      <button type="button" className="bk-link" disabled={i === services.length - 1} onClick={() => set("services", moveRow(services, i, 1))}>Down</button>
                      {priced && <button type="button" className="bk-link" onClick={() => setService(i, { amount: null, subs: [...subs, { name: "", amount: "" }] })}>+ Sub service</button>}
                      <button type="button" className="bk-link" onClick={() => set("services", services.filter((_, j) => j !== i))}>Remove</button>
                    </span>
                  </td>
                </tr>,
                ...(priced ? subs : []).map((b, k) => (
                  <tr key={`s${i}-${k}`}>
                    <td />
                    <td data-label="Sub service"><input aria-label={`Sub service ${k + 1} of service ${i + 1} name`} style={{ marginLeft: 16, width: "calc(100% - 16px)" }} value={b.name} onChange={(e) => setSub(k, { name: e.target.value })} /></td>
                    <td data-label="Fee basis"><small className="bk-muted">Same as the service</small></td>
                    <td data-label="Amount" className="bk-right"><input aria-label={`Sub service ${k + 1} of service ${i + 1} amount`} type="number" min="0" step="any" value={b.amount ?? ""} onChange={(e) => setSub(k, { amount: e.target.value })} /></td>
                    <td><button type="button" className="bk-link" onClick={() => setService(i, { subs: subs.filter((_, j) => j !== k) })}>Remove</button></td>
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      </div>
      <div className="bk-actions bk-mt"><Button onClick={() => set("services", [...services, newService()])}>+ Add service</Button></div>

      {totals.length > 0 && (
        <p className="bk-desk-total bk-mt">
          Totals for option {index + 1} (excluding VAT, each basis on its own):{" "}
          {totals.map((t, i) => <span key={t.basis}>{i > 0 && " · "}<strong>AED {plain(t.total)}</strong> <small className="bk-muted">{BASES.find((b) => b.key === t.basis).printed}</small></span>)}
        </p>
      )}

      <div className="bk-field bk-mt"><label htmlFor={`${id}-notes`}>Notes for this option (one per line)</label><textarea id={`${id}-notes`} rows={2} value={fromLines(option.notes)} onChange={(e) => set("notes", toLines(e.target.value))} /></div>
    </div>
  );
}
