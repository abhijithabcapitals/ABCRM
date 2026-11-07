// One option of a proposal: authority, activity, text, services with sub services, and its totals.
import { useState } from "react";
import { Button, Panel, fmtDate } from "@banking/components/shared";
import { blankService, optionTotal, serviceAmount, toUsd } from "../logic/proposalModel";

const money = (n) => Number(n || 0).toLocaleString("en-AE", { maximumFractionDigits: 2 });
const lines = (list) => (list || []).join("\n");
const move = (list, i, d) => { const j = i + d; if (j < 0 || j >= list.length) return list; const c = [...list]; [c[i], c[j]] = [c[j], c[i]]; return c; };

// One text per line. Blank lines are dropped when the proposal is saved.
function ListBox({ id, label, value, onChange, help }) {
  return <div className="bk-field bk-full"><label htmlFor={id}>{label}</label><textarea id={id} rows={3} value={lines(value)} onChange={(e) => onChange(e.target.value.split("\n"))} />{help && <small>{help}</small>}</div>;
}

// Moves the item at `from` to position `to`, shifting the rows between.
const moveTo = (list, from, to) => { if (from === to || from < 0 || to < 0 || to >= list.length) return list; const c = [...list]; const [x] = c.splice(from, 1); c.splice(to, 0, x); return c; };

// A service and its sub services drag as one block. Only the handle arms the drag, so text in the inputs can still be selected.
function Service({ s, n, id, first, last, drag, onChange, onMove, onRemove }) {
  const [armed, setArmed] = useState(false);
  const hasSubs = s.subs.length > 0;
  const setSub = (j, patch) => onChange({ subs: s.subs.map((b, k) => (k === j ? { ...b, ...patch } : b)) });
  const keys = (e) => {
    if (e.key === "ArrowUp" && !first) { e.preventDefault(); onMove(-1); }
    if (e.key === "ArrowDown" && !last) { e.preventDefault(); onMove(1); }
  };
  return (
    <tbody draggable={armed} className={`${drag.dragging ? "bk-dragging" : ""} ${drag.over ? "bk-drop-target" : ""}`}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(n)); drag.onStart(); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; drag.onOver(); }}
      onDrop={(e) => { e.preventDefault(); drag.onDrop(); }}
      onDragEnd={() => { setArmed(false); drag.onEnd(); }}>
      <tr>
        <td data-label="#">
          <span className="bk-drag-handle" role="button" tabIndex={0} title="Drag to reorder (or use the arrow keys)" aria-label={`Reorder service ${n}. Drag, or press arrow up or down.`}
            onMouseDown={() => setArmed(true)} onMouseUp={() => setArmed(false)} onTouchStart={() => setArmed(true)} onKeyDown={keys}>⠿</span> {n}
        </td>
        <td data-label="Service"><input id={`${id}-name`} aria-label={`Service ${n} name`} value={s.name} onChange={(e) => onChange({ name: e.target.value })} /></td>
        <td data-label="Remarks"><input aria-label={`Service ${n} remarks`} value={s.remarks} onChange={(e) => onChange({ remarks: e.target.value })} /></td>
        <td data-label="Amount (AED)" className="bk-right">
          {hasSubs ? <input aria-label={`Service ${n} amount, from its sub services`} readOnly value={money(serviceAmount(s))} title="Taken from the sub services" />
            : <input id={`${id}-amount`} aria-label={`Service ${n} amount in AED`} inputMode="decimal" value={s.amount} onChange={(e) => onChange({ amount: e.target.value })} />}
        </td>
        <td className="bk-actions">
          <button type="button" className="bk-link" onClick={() => onChange({ subs: [...s.subs, { name: "", amount: "" }], amount: "" })}>+ Sub service</button>
          <button type="button" className="bk-link" onClick={onRemove}>Remove</button>
        </td>
      </tr>
      {s.subs.map((b, j) => (
        <tr key={j}>
          <td />
          <td data-label="Sub service"><input aria-label={`Sub service ${j + 1} of service ${n}`} placeholder="Sub service" value={b.name} onChange={(e) => setSub(j, { name: e.target.value })} /></td>
          <td />
          <td data-label="Amount (AED)" className="bk-right"><input aria-label={`Sub service ${j + 1} amount in AED`} inputMode="decimal" value={b.amount} onChange={(e) => setSub(j, { amount: e.target.value })} /></td>
          <td className="bk-actions"><button type="button" className="bk-link" onClick={() => onChange({ subs: s.subs.filter((_, k) => k !== j) })}>Remove sub service</button></td>
        </tr>
      ))}
    </tbody>
  );
}

// authorities: the saved sets. onAuthority(key) is checked by the screen first (it may need to warn).
export default function ProposalOption({ option, index, rate, authorities, onAuthority, onChange, onRemove, canRemove }) {
  const id = `p-o${index}`;
  const set = authorities.find((a) => a.authority_key === option.authority_key);
  const up = (patch) => onChange({ ...option, ...patch });
  const setService = (i, patch) => up({ services: option.services.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const [dragFrom, setDragFrom] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const dragFor = (i) => ({
    dragging: dragFrom === i, over: dragFrom !== null && dragOver === i && dragFrom !== i,
    onStart: () => setDragFrom(i), onOver: () => { if (dragOver !== i) setDragOver(i); },
    onDrop: () => { if (dragFrom !== null) up({ services: moveTo(option.services, dragFrom, i) }); setDragFrom(null); setDragOver(null); },
    onEnd: () => { setDragFrom(null); setDragOver(null); },
  });
  const total = optionTotal(option);
  const usd = Number(rate) > 0 ? toUsd(total, rate) : null;
  return (
    <Panel title={`Option ${index + 1}`} actions={canRemove ? <Button onClick={onRemove}>Remove option</Button> : null}>
      <div className="bk-grid">
        <div className="bk-field"><label htmlFor={`${id}-authority`}>Licence authority <em>*</em></label>
          <select id={`${id}-authority`} value={option.authority_key} onChange={(e) => onAuthority(e.target.value)}>
            <option value="">Select an authority…</option>
            {authorities.map((a) => <option key={a.authority_key} value={a.authority_key}>{a.name}</option>)}
          </select>
          {set?.updated_at && <small>This set was last updated {fmtDate(set.updated_at)}.</small>}
          {option.authority_key && !set && <small>This authority set is no longer in the list. The option keeps its own copy.</small>}
        </div>
        <div className="bk-field"><label htmlFor={`${id}-activity`}>Business activity <em>*</em></label><input id={`${id}-activity`} value={option.activity} onChange={(e) => up({ activity: e.target.value })} /></div>
        <div className="bk-field bk-full"><label htmlFor={`${id}-title`}>Table title</label><input id={`${id}-title`} value={option.title} onChange={(e) => up({ title: e.target.value })} /></div>
        <div className="bk-field bk-full"><label htmlFor={`${id}-desc`}>Description</label><textarea id={`${id}-desc`} rows={3} value={option.description} onChange={(e) => up({ description: e.target.value })} /></div>
        <ListBox id={`${id}-package`} label="Package includes" value={option.package_includes} onChange={(v) => up({ package_includes: v })} help="One item per line. Prints only if not empty." />
        <ListBox id={`${id}-red`} label="Red notes" value={option.red_notes} onChange={(v) => up({ red_notes: v })} help="One note per line." />
      </div>
      <h4 id={`${id}-services`} className="bk-mt">Services <em>*</em></h4>
      <div className="bk-table-wrap">
        <table className="bk-table">
          <thead><tr><th>#</th><th>Service</th><th>Remarks</th><th className="bk-right">Amount (AED)</th><th /></tr></thead>
          {option.services.map((s, i) => (
            <Service key={i} s={s} n={i + 1} id={`${id}-s${i}`} first={i === 0} last={i === option.services.length - 1} drag={dragFor(i)}
              onChange={(patch) => setService(i, patch)} onMove={(d) => up({ services: move(option.services, i, d) })} onRemove={() => up({ services: option.services.filter((_, k) => k !== i) })} />
          ))}
        </table>
      </div>
      <div className="bk-actions bk-mt"><Button onClick={() => up({ services: [...option.services, blankService()] })}>+ Add service</Button></div>
      <p className="bk-desk-total">Option {index + 1} total <strong>AED {money(total)}</strong>{usd !== null && <small className="bk-muted"> (USD {usd.toLocaleString("en-US")})</small>}</p>
    </Panel>
  );
}
