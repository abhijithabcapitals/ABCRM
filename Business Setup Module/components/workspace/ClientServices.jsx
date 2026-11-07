// The client's Services tab. Staff add one line per service, chosen from the fee list (Services & Fees), with the fee agreed for this client.
// Lines are saved against the client; Quotes & Agreements builds the quote from the lines not yet quoted. A quoted line no longer changes.
// Below the lines, the tracker of services that started once a quote was accepted.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, Panel, Spinner, useAction, useLoad } from "@banking/components/shared";
import { useSetup } from "../SetupContext";
import { listFees, serviceLineDelete, serviceLineSave, serviceLines } from "../../services/businessSetupApi";
import { feeGroups } from "../../logic/serviceLines";
import { money } from "@app/money";
import Services from "./Services";

export default function ClientServices({ w, clientId, reload, goTab }) {
  const { can } = useSetup();
  const manage = can("setup.quotes.manage");
  const lines = useLoad(() => serviceLines(clientId), [clientId]);
  const fees = useLoad(() => (manage ? listFees() : Promise.resolve([])), [manage]);
  const { error, setError, busy, act } = useAction(lines.reload);
  const [editing, setEditing] = useState(null);
  const rows = lines.data || [];
  const open = rows.filter((l) => !l.quote_id);
  const openTotal = open.reduce((n, l) => n + Number(l.amount || 0), 0);
  const remove = (l) => window.confirm(`Remove ${l.service_name}?`) && act(() => serviceLineDelete(l.id));
  return (
    <div>
      <Panel title="Services" sub="Add each service the client takes, with its fee. Quotes & Agreements builds the quote from the lines not yet quoted."
        actions={manage && !editing && <Button variant="primary" onClick={() => setEditing({ fee_item_id: "", amount: "" })}>+ Add service</Button>}>
        <ErrorNote message={error || lines.error || fees.error} onClose={error ? () => setError(null) : undefined} />
        {lines.loading && !lines.data ? <Spinner /> : (
          <DataTable rows={rows} empty="No services added yet." columns={[
            { key: "service_name", label: "Service", render: (l) => <>{l.service_name}<div className="bk-muted"><small>{l.grp}</small></div></> },
            { key: "amount", label: "Fee (AED)", render: (l) => money(l.amount) },
            { key: "vat_rate", label: "VAT", render: (l) => `${Number(l.vat_rate)}%` },
            { key: "quote_number", label: "Quote", render: (l) => (l.quote_id ? <Badge tone="good">{l.quote_number || "Quoted"}</Badge> : <Badge tone="warn">Not quoted</Badge>) },
            { key: "x", label: "", render: (l) => manage && !l.quote_id && (
              <span className="bk-actions">
                <Button disabled={busy || !!editing} onClick={() => setEditing({ id: l.id, fee_item_id: l.fee_item_id, amount: String(l.amount) })}>Edit</Button>
                <Button disabled={busy || !!editing} onClick={() => remove(l)}>Remove</Button>
              </span>
            ) },
          ]} />
        )}
        {editing && <LineEditor line={editing} fees={fees.data} clientId={clientId} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await lines.reload(); }} />}
        {open.length > 0 && (
          <div className="bk-actions bk-mt">
            <strong>Not yet quoted: {open.length} {open.length === 1 ? "line" : "lines"}, AED {money(openTotal)} before VAT</strong>
            {goTab && <Button onClick={() => goTab("quotes")}>Go to Quotes &amp; Agreements</Button>}
          </div>
        )}
      </Panel>
      <Panel title="Service tracker" sub="Services start here once a quote is accepted.">
        <Services w={w} clientId={clientId} reload={reload} />
      </Panel>
    </div>
  );
}

// One line: the service from the fee list, grouped as in Services & Fees, and the fee. The list's stored fee is offered, never saved unless used or typed.
function LineEditor({ line, fees, clientId, onClose, onSaved }) {
  const [v, setV] = useState(line);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const groups = feeGroups(fees);
  const picked = (fees || []).find((f) => f.id === v.fee_item_id);
  const save = async () => {
    if (!v.fee_item_id) return setError("Choose a service from the list.");
    if (v.amount === "" || Number.isNaN(Number(v.amount)) || Number(v.amount) < 0) return setError("Enter the fee amount.");
    setBusy(true); setError(null);
    try { await serviceLineSave({ id: v.id || null, client_id: clientId, fee_item_id: v.fee_item_id, amount: Number(v.amount) }); await onSaved(); } catch (e) { setError(e.message); setBusy(false); }
    return null;
  };
  return (
    <div className="bk-mt">
      <ErrorNote message={error} />
      <div className="bk-grid">
        <div className="bk-field"><label htmlFor="bs-line-svc">Service <em>*</em></label>
          <select id="bs-line-svc" value={v.fee_item_id} onChange={(e) => setV({ ...v, fee_item_id: e.target.value })}>
            <option value="">Choose a service…</option>
            {groups.map(([grp, items]) => <optgroup key={grp} label={grp}>{items.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</optgroup>)}
          </select></div>
        <div className="bk-field"><label htmlFor="bs-line-fee">Fee (AED) <em>*</em></label>
          <input id="bs-line-fee" type="number" step="0.01" min="0" value={v.amount} placeholder={picked?.default_amount != null ? String(picked.default_amount) : ""} onChange={(e) => setV({ ...v, amount: e.target.value })} />
          {v.amount === "" && picked?.default_amount != null && <Button onClick={() => setV({ ...v, amount: String(picked.default_amount) })}>Use {money(picked.default_amount)}</Button>}</div>
      </div>
      <div className="bk-actions bk-mt"><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>{v.id ? "Save" : "Add"}</Button></div>
    </div>
  );
}
