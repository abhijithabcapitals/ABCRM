// Settings for the Accounting quote and agreement: saved packages, standard wording and contact (Hub admins),
// The approver list and signature image now live in Settings > Signing. The server checks every right again.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, Modal, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { isHubAdmin, loadHubSettings } from "../services/hubApi";
import { loadPackages, saveDefaults, savePackage } from "../services/accountingApi";
import { BASES } from "../logic/accountingQuote";
import { cleanLines, fromLines, moveRow, toLines } from "../logic/accountingUi";

const KEY = "accounting_proposal_defaults";
const isPriced = (basis) => !!BASES.find((b) => b.key === basis)?.priced;

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const blankPackage = () => ({ package_key: "", name: "", description: "", active: true, services: [], notes: [], schedule1: [], isNew: true });

// One package, edited in a window. Amounts are typed; a service with sub services keeps them and shows their total.
function PackageModal({ pkg, taken, onClose, onSaved }) {
  const [p, setP] = useState({ ...pkg, services: (pkg.services || []).map((s) => ({ ...s, subs: s.subs || [] })), notes: pkg.notes || [], schedule1: pkg.schedule1 || [] });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setP((x) => ({ ...x, [k]: v }));
  const setService = (i, patch) => set("services", p.services.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const setRow = (i, patch) => set("schedule1", p.schedule1.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    const key = p.isNew ? slug(p.name) : p.package_key;
    try {
      if (!p.name.trim()) throw new Error("Enter the package name.");
      if (!key) throw new Error("The package name needs letters or numbers.");
      if (p.isNew && taken.includes(key)) throw new Error("A package with this name already exists.");
      const services = p.services.map((s, i) => {
        const name = String(s.name).trim();
        if (!name) throw new Error(`Service ${i + 1} needs a name.`);
        if (!isPriced(s.basis)) return { name, basis: s.basis, amount: null, subs: [] };
        const subs = (s.subs || []).map((b) => ({ name: b.name, amount: b.amount }));
        const text = String(s.amount ?? "").replace(/[,\s]/g, "");
        if (!subs.length && text !== "" && !/^\d+(\.\d+)?$/.test(text)) throw new Error(`Enter the fee of ${name} as a number, or leave it empty.`);
        return { name, basis: s.basis, amount: subs.length || text === "" ? null : Number(text), subs };
      });
      const schedule1 = p.schedule1.map((r) => ({ name: String(r.name).trim(), description: String(r.description || "").trim() })).filter((r) => r.name);
      setBusy(true);
      await savePackage({ package_key: key, name: p.name.trim(), description: p.description.trim(), active: p.active, services, notes: cleanLines(p.notes), schedule1 });
      await onSaved();
      onClose();
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <Modal title={p.isNew ? "Add Accounting package" : `Package: ${pkg.name}`} onClose={onClose} wide>
      <form onSubmit={save}>
        <ErrorNote message={error} />
        <div className="bk-grid">
          <div className="bk-field"><label htmlFor="ap-name">Package name <em>*</em></label><input id="ap-name" value={p.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div className="bk-field"><label htmlFor="ap-active">Status</label>
            <select id="ap-active" value={p.active ? "yes" : "no"} onChange={(e) => set("active", e.target.value === "yes")}><option value="yes">Active</option><option value="no">Archived</option></select>
          </div>
          <div className="bk-field bk-full"><label htmlFor="ap-desc">Description</label><textarea id="ap-desc" rows={2} value={p.description} onChange={(e) => set("description", e.target.value)} /></div>
        </div>

        <div className="bk-table-wrap bk-mt">
          <table className="bk-table">
            <thead><tr><th>#</th><th>Service</th><th>Fee basis</th><th className="bk-right">Amount (AED, excl. VAT)</th><th /></tr></thead>
            <tbody>
              {p.services.map((s, i) => {
                const subTotal = (s.subs || []).reduce((t, b) => t + Number(b.amount || 0), 0);
                return (
                  <tr key={i}>
                    <td data-label="#">{i + 1}</td>
                    <td data-label="Service"><input aria-label={`Service ${i + 1} name`} value={s.name} onChange={(e) => setService(i, { name: e.target.value })} /></td>
                    <td data-label="Fee basis">
                      <select aria-label={`Service ${i + 1} fee basis`} value={s.basis} onChange={(e) => setService(i, isPriced(e.target.value) ? { basis: e.target.value } : { basis: e.target.value, amount: null, subs: [] })}>
                        {BASES.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
                      </select>
                    </td>
                    <td data-label="Amount" className="bk-right">
                      {!isPriced(s.basis) ? <small className="bk-muted">No amount</small>
                        : s.subs.length ? <small className="bk-muted">{subTotal.toLocaleString("en-AE", { maximumFractionDigits: 2 })} from sub services</small>
                          : <input aria-label={`Service ${i + 1} amount`} inputMode="decimal" value={s.amount ?? ""} onChange={(e) => setService(i, { amount: e.target.value })} />}
                    </td>
                    <td className="bk-actions">
                      <Button onClick={() => set("services", moveRow(p.services, i, -1))} disabled={i === 0}>Up</Button>
                      <Button onClick={() => set("services", moveRow(p.services, i, 1))} disabled={i === p.services.length - 1}>Down</Button>
                      <Button onClick={() => set("services", p.services.filter((_, j) => j !== i))}>Remove</Button>
                    </td>
                  </tr>
                );
              })}
              {!p.services.length && <tr><td colSpan={5}><small className="bk-muted">No services yet.</small></td></tr>}
            </tbody>
          </table>
        </div>
        <div className="bk-actions bk-mt"><Button onClick={() => set("services", [...p.services, { name: "", basis: "month", amount: "", subs: [] }])}>+ Add service</Button></div>

        <h4 className="bk-mt">Schedule 1: Scope of Services</h4>
        <p className="bk-note">The description printed beside each service in the agreement.</p>
        {p.schedule1.map((r, i) => (
          <div className="bk-row" key={i}>
            <input aria-label={`Scope row ${i + 1} service`} placeholder="Service" value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} />
            <textarea aria-label={`Scope row ${i + 1} description`} rows={2} placeholder="Description" value={r.description || ""} onChange={(e) => setRow(i, { description: e.target.value })} />
            <Button onClick={() => set("schedule1", p.schedule1.filter((_, j) => j !== i))}>Remove</Button>
          </div>
        ))}
        <div className="bk-actions"><Button onClick={() => set("schedule1", [...p.schedule1, { name: "", description: "" }])}>+ Add row</Button></div>

        <div className="bk-field bk-mt"><label htmlFor="ap-notes">Notes (one per line)</label><textarea id="ap-notes" rows={3} value={fromLines(p.notes)} onChange={(e) => set("notes", toLines(e.target.value))} /></div>
        <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>Save package</Button></div>
      </form>
    </Modal>
  );
}

function Packages() {
  const list = useLoad(loadPackages, []);
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const rows = list.data || [];
  const toggle = async (p) => {
    setBusy(p.package_key); setError(null);
    try {
      await savePackage({ package_key: p.package_key, name: p.name, description: p.description, active: !p.active, services: p.services, notes: p.notes, schedule1: p.schedule1 });
      await list.reload();
    } catch (e) { setError(e.message); }
    setBusy(null);
  };
  const columns = [
    { label: "Package", render: (p) => <>{p.name} {!p.active && <Badge>Archived</Badge>}</> },
    { label: "Services", render: (p) => (p.services || []).length },
    { label: "Updated", render: (p) => fmtDate(p.updated_at) },
    { label: "", render: (p) => (
      <span className="bk-actions">
        <Button onClick={() => setEdit(p)}>Edit</Button>
        <Button busy={busy === p.package_key} onClick={() => toggle(p)}>{p.active ? "Archive" : "Restore"}</Button>
      </span>
    ) },
  ];
  return (
    <Panel title="Accounting packages" sub="Saved packages start each option of an Accounting quote. A quote keeps its own copy, so changes here never alter quotes already made." actions={<Button onClick={() => setEdit(blankPackage())}>Add package</Button>}>
      <ErrorNote message={error || list.error} onClose={() => setError(null)} />
      {list.loading && !list.data ? <Spinner /> : <DataTable columns={columns} rows={rows} pageSize={25} search="Search packages" empty="No Accounting packages yet." />}
      {edit && <PackageModal pkg={edit} taken={rows.map((r) => r.package_key)} onClose={() => setEdit(null)} onSaved={list.reload} />}
    </Panel>
  );
}

// Standard notes, billing wording and contact: they start each new agreement and are printed on it.
function Standard({ value, onSaved }) {
  const std = value?.standard || {};
  const [f, setF] = useState({
    scope_notes: fromLines(std.scope_notes), fee_notes: fromLines(std.fee_notes), please_note: fromLines(std.please_note),
    monthly: std.billing?.monthly || "", quarterly: std.billing?.quarterly || "", commencement: std.billing?.commencement || "",
    ...{ name: "", phone: "", email: "", website: "", ...(value?.contact || {}) },
  });
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    try {
      await saveDefaults({
        standard: { scope_notes: cleanLines(toLines(f.scope_notes)), fee_notes: cleanLines(toLines(f.fee_notes)), please_note: cleanLines(toLines(f.please_note)),
          billing: { monthly: f.monthly, quarterly: f.quarterly, commencement: f.commencement } },
        contact: { name: f.name, phone: f.phone, email: f.email, website: f.website },
      });
      await onSaved();
      setNotice("Saved. New agreements use this wording; agreements already made keep theirs.");
    } catch (err) { setError(err.message); }
    setBusy(false);
  };
  const area = (k, label, rows = 3) => <div className="bk-field bk-full"><label htmlFor={`as-${k}`}>{label}</label><textarea id={`as-${k}`} rows={rows} value={f[k]} onChange={set(k)} /></div>;
  const line = (k, label) => <div className="bk-field"><label htmlFor={`as-${k}`}>{label}</label><input id={`as-${k}`} value={f[k]} onChange={set(k)} /></div>;
  return (
    <Panel title="Accounting standard wording and contact" sub="Notes are one per line. Prices are never kept here.">
      <form onSubmit={save}>
        <ErrorNote message={error} onClose={() => setError(null)} />
        {notice && <div className="bk-alert">{notice}</div>}
        <div className="bk-grid">
          {area("scope_notes", "Scope notes (under Schedule 1: Scope of Services)")}
          {area("fee_notes", "Fee notes (under Schedule 2: Fees for Services)")}
          {area("please_note", "Please note")}
          {area("monthly", "Billing: monthly", 2)}
          {area("quarterly", "Billing: quarterly", 2)}
          {area("commencement", "Billing: on commencement", 2)}
          {line("name", "Contact name")}{line("phone", "Contact mobile")}{line("email", "Contact email")}{line("website", "Contact website")}
        </div>
        <div className="bk-actions bk-mt"><Button type="submit" variant="primary" busy={busy}>Save wording and contact</Button></div>
      </form>
    </Panel>
  );
}

export default function AccountingSettings() {
  const admin = useLoad(isHubAdmin, []);
  const settings = useLoad(loadHubSettings, []);
  if (!admin.data) return null;   // the server checks again on every save
  if (settings.loading && !settings.data) return <Spinner />;
  const value = settings.data?.[KEY] || {};
  return (
    <div>
      <ErrorNote message={settings.error} />
      <Packages />
      <Standard value={value} onSaved={settings.reload} />
      <p className="bk-note">The approvers and the signature image are set in Settings &gt; Signing.</p>
    </div>
  );
}
