// Services & Fees: the price list, editable without a software change. Quote templates live in Template Hub.
// Fee items show in two levels, Category then Group (025, logic/feeGroups.js). A service's checklist opens from its row.
import { useMemo, useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, PageHead, Panel, Spinner, useLoad } from "@banking/components/shared";
import { useSetup } from "./SetupContext";
import { checkpointLists, listFees, saveFee } from "../services/businessSetupApi";
import { ListEditor } from "./ChecklistLists";
import { applyCategoryOrder, categoryOptions, groupFees, moveCategory, readCategoryOrder, saveCategoryOrder, unlinkedLists } from "../logic/feeGroups";
import { usageUser } from "@crm-jsx/selectUsage.js";
import "./feeMaster.css";

const feeFields = (fees, current) => [
  { name: "category", label: "Category", type: "select", options: categoryOptions(fees, current), required: true },
  { name: "grp", label: "Group", required: true }, { name: "name", label: "Item", required: true, full: true },
  { name: "default_amount", label: "Default amount (AED)", type: "number", help: "Leave empty when the price is set on each quote." },
  { name: "vat_rate", label: "VAT rate", type: "select", options: [{ value: 5, label: "5%" }, { value: 0, label: "0%" }], required: true },
  { name: "is_service", label: "A service (untick for a cost billed to the client; it then creates no service when the quote is accepted)", type: "bool", full: true },
  { name: "active", label: "In use", type: "bool" },
];
const amount = (r) => (r.default_amount === null || r.default_amount === undefined ? "–" : Number(r.default_amount).toLocaleString("en-AE"));
const NEW_LIST = { department: "Business Setup", category: "", name: "", active: true, steps: [{ label: "", stage: "", requirement: "Mandatory" }] };

export default function FeeMaster() {
  const { can } = useSetup();
  const fees = useLoad(() => listFees(), []);
  const lists = useLoad(() => checkpointLists(), []);
  const [fee, setFee] = useState(null);
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(() => new Set());
  const manage = can("setup.fees.manage");
  const user = usageUser();
  const [order, setOrder] = useState(() => readCategoryOrder(user));
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const cats = useMemo(() => applyCategoryOrder(groupFees(fees.data || [], lists.data || [], q), order), [fees.data, lists.data, q, order]);
  const keepOrder = (keys) => { setOrder(keys); saveCategoryOrder(user, keys); };
  // Moves a section onto another's place. The full current order is saved, so hidden sections keep theirs too.
  const move = (from, to) => {
    const all = applyCategoryOrder(groupFees(fees.data || [], lists.data || []), order).map((c) => c.category);
    keepOrder(moveCategory(all, from, to));
  };
  const step = (key, d) => { const keys = cats.map((c) => c.category); const to = keys[keys.indexOf(key) + d]; if (to) move(key, to); };
  // The header is the handle; the whole section is the drop target.
  const handleProps = (key) => ({
    draggable: true,
    onDragStart: (e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", key); setDrag(key); },
    onDragEnd: () => { setDrag(null); setOver(null); },
  });
  const dropProps = (key) => ({
    onDragOver: (e) => { if (!drag) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (over !== key) setOver(key); },
    onDrop: (e) => { e.preventDefault(); if (drag) move(drag, key); setDrag(null); setOver(null); },
  });
  const side = (key) => { if (!drag || over !== key || drag === key) return ""; const k = cats.map((c) => c.category); return k.indexOf(drag) < k.indexOf(key) ? " bs-fee-over-after" : " bs-fee-over-before"; };
  const loose = useMemo(() => unlinkedLists(fees.data || [], lists.data || []), [fees.data, lists.data]);
  const searching = !!q.trim();
  const toggle = (c) => setOpen((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; });
  const editFee = (r) => { const { list, ...rest } = r; setFee({ ...rest, category: rest.category || list?.category || rest.grp }); };
  return (
    <div>
      <PageHead title="Services & Fees" sub="Amounts here show as suggestions on new quotes, and the VAT rate is added to each line. Both can be changed on each quote.">
        {manage && <Button onClick={() => setEditing(NEW_LIST)}>+ Checklist</Button>}
        {manage && <Button variant="primary" onClick={() => setFee({ active: true, vat_rate: 5, is_service: true })}>+ Fee item</Button>}
      </PageHead>
      <ErrorNote message={fees.error || lists.error} />
      <Panel title="Fee list" sub="Grouped by category, then group. Drag a category by its header to change the order, or use Alt + arrow keys on it. The order is yours, kept in this browser. Accepting a quote copies a service's checklist onto it; later edits leave running services unchanged."
        actions={<>{order.length > 0 && <Button onClick={() => keepOrder([])}>Reset order</Button>}<Button onClick={() => setOpen(new Set(cats.map((c) => c.category)))}>Expand all</Button><Button onClick={() => setOpen(new Set())}>Collapse all</Button></>}>
        <input className="bk-search" type="search" placeholder="Search item, group or category…" aria-label="Search fee items" value={q} onChange={(e) => setQ(e.target.value)} />
        {fees.loading && !fees.data ? <Spinner /> : !cats.length ? <p className="bs-fee-empty">{searching ? "No fee item matches." : "No fee items yet."}</p> : cats.map((c) => (
          <details key={c.category} className={`bs-fee-cat${drag === c.category ? " bs-fee-dragging" : ""}${side(c.category)}`} open={searching || open.has(c.category)} {...dropProps(c.category)}>
            <summary className="bs-fee-handle" title="Drag to move this category" {...handleProps(c.category)}
              onClick={(e) => { e.preventDefault(); if (!searching) toggle(c.category); }}
              onKeyDown={(e) => { if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); step(c.category, e.key === "ArrowUp" ? -1 : 1); } }}
            >{c.category} <span className="bs-fee-count">{c.count}</span></summary>
            {c.groups.map((g) => (
              <div key={g.grp} className="bs-fee-grp">
                {(c.groups.length > 1 || g.grp !== c.category) && <h4>{g.grp} <span className="bs-fee-count">{g.items.length}</span></h4>}
                <table className="bk-table">
                  <thead><tr><th>Item</th><th className="bk-right">AED</th><th className="bk-right">VAT</th><th>Type</th><th>Checklist</th><th>State</th></tr></thead>
                  <tbody>{g.items.map((r) => (
                    <tr key={r.id} className={manage ? "bk-click" : ""} onClick={manage ? () => editFee(r) : undefined}>
                      <td data-label="Item">{r.name}</td>
                      <td data-label="AED" className="bk-right">{amount(r)}</td>
                      <td data-label="VAT" className="bk-right">{`${Number(r.vat_rate ?? 5)}%`}</td>
                      <td data-label="Type">{r.is_service === false ? "Cost" : "Service"}</td>
                      <td data-label="Checklist">{!r.list ? "–" : manage
                        ? <Button onClick={(e) => { e.stopPropagation(); setEditing(r.list); }}>{r.list.steps.length} steps</Button>
                        : `${r.list.steps.length} steps`}</td>
                      <td data-label="State"><Badge tone={r.active ? "good" : undefined}>{r.active ? "In use" : "Not in use"}</Badge></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ))}
          </details>
        ))}
      </Panel>
      {loose.length > 0 && (
        <Panel title="Checklists without a fee item" sub="Lists made with + Checklist that no fee item uses yet.">
          <DataTable rows={loose} pageSize={50} onRow={manage ? (r) => setEditing(r) : undefined} columns={[
            { key: "category", label: "Category" }, { key: "name", label: "Service" },
            { key: "steps", label: "Steps", right: true, render: (r) => r.steps.length },
            { key: "active", label: "State", render: (r) => <Badge tone={r.active ? "good" : undefined}>{r.active ? "In use" : "Not in use"}</Badge> },
          ]} />
        </Panel>
      )}
      {fee && <FormModal title={fee.id ? "Edit fee item" : "New fee item"} fields={feeFields(fees.data || [], fee.category)} initial={fee} onClose={() => setFee(null)} onSubmit={async (v) => { await saveFee({ ...v, id: fee.id }); await fees.reload(); }} />}
      {editing && <ListEditor list={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await lists.reload(); }} />}
    </div>
  );
}
