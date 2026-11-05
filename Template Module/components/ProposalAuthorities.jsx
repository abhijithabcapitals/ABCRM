// Settings: the saved licence authority sets that start each Business Formation Proposal option, plus the USD rate and contact. Hub admins only.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FilePick, FormGrid, Modal, Panel, Spinner, useLoad } from "@banking/components/shared";
import { loadHubSettings } from "../services/hubApi";
import { loadAuthorities, saveAuthority, saveDefaults, uploadProposalAsset } from "../services/proposalApi";

const KINDS = [{ value: "free_zone", label: "Free zone" }, { value: "mainland", label: "Mainland" }];
const LISTS = [
  ["package_includes", "Package includes"], ["red_notes", "Red notes"], ["documents", "Documents required"],
  ["payment", "Payment terms"], ["scope", "Scope of work"], ["notes", "Notes"],
];
const KEY_OK = /^[a-z0-9_-]+$/;
const asText = (list) => (Array.isArray(list) ? list : []).join("\n");
const asList = (text) => String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);

// Rows as the form holds them: every amount is a string, so a half-typed number is not lost.
const toRows = (services) => (services || []).map((s) => ({ name: s.name || "", remarks: s.remarks || "", amount: s.amount ?? "", subs: (s.subs || []).map((b) => ({ name: b.name || "", amount: b.amount ?? "" })) }));
const toAddons = (addons) => (addons || []).map((a) => ({ name: a.name || "", amount: a.amount ?? "", text: a.text || "" }));
const num = (v, what) => {
  const t = String(v ?? "").trim().replace(/,/g, "");
  if (!/^[0-9]+(\.[0-9]+)?$/.test(t)) throw new Error(`Enter ${what} as a number, zero or more.`);
  return Number(t);
};

// The payload the server takes. Throws the first problem in plain words.
export function buildPayload(f) {
  const key = String(f.authority_key || "").trim();
  if (!KEY_OK.test(key)) throw new Error("The key must be lower case letters, digits, - or _.");
  if (!String(f.name || "").trim()) throw new Error("Enter the name of the authority.");
  const services = [];
  f.services.forEach((s, i) => {
    const name = String(s.name || "").trim();
    if (!name) throw new Error(`Service row ${i + 1} needs a name.`);
    const subs = s.subs.map((b) => {
      if (!String(b.name || "").trim()) throw new Error(`Each sub service of ${name} needs a name.`);
      return { name: b.name.trim(), amount: num(b.amount, `the amount of ${b.name.trim()}`) };
    });
    // A service with sub services takes the sum of them, so it carries no amount of its own.
    services.push({ name, remarks: String(s.remarks || "").trim(), amount: subs.length ? null : num(s.amount, `the amount of ${name}`), subs });
  });
  const addons = f.addons.map((a, i) => {
    const name = String(a.name || "").trim();
    if (!name) throw new Error(`Add-on row ${i + 1} needs a name.`);
    const blank = String(a.amount ?? "").trim() === "";
    return { name, amount: blank ? null : num(a.amount, `the amount of ${name}`), text: String(a.text || "").trim() };
  });
  const lists = Object.fromEntries(LISTS.map(([k]) => [k, asList(f[k])]));
  return {
    authority_key: key, name: f.name.trim(), kind: f.kind, description: f.description || "", logo_path: f.logo_path || null, timeline_path: f.timeline_path || null,
    table_title: f.table_title || "", services, addons, active: f.active !== false, ...lists,
  };
}

const toForm = (a) => ({
  authority_key: a?.authority_key || "", name: a?.name || "", kind: a?.kind || "free_zone", table_title: a?.table_title || "", description: a?.description || "",
  logo_path: a?.logo_path || null, timeline_path: a?.timeline_path || null, services: toRows(a?.services), addons: toAddons(a?.addons), active: a ? a.active !== false : true,
  ...Object.fromEntries(LISTS.map(([k]) => [k, asText(a?.[k])])),
});

function ImagePick({ label, path, onPath, authorityKey }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pick = async (file) => {
    setBusy(true); setError(null);
    try { onPath(await uploadProposalAsset(authorityKey, label.toLowerCase(), file)); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  return (
    <div className="bk-row">
      <span><strong>{label}:</strong> {path ? <code className="bk-code">{path.split("/").pop()}</code> : <span className="bk-muted">None</span>}</span>
      <span className="bk-actions">
        <FilePick label={path ? "Replace" : "Upload"} accept="image/png,image/jpeg" busy={busy} onFile={pick} />
        {path && <Button onClick={() => onPath(null)}>Remove</Button>}
      </span>
      {error && <ErrorNote message={error} onClose={() => setError(null)} />}
    </div>
  );
}

function AuthorityModal({ authority, onClose, onSaved }) {
  const isNew = !authority;
  const [f, setF] = useState(() => toForm(authority));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setRow = (key, i, patch) => setF((x) => ({ ...x, [key]: x[key].map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const dropRow = (key, i) => setF((x) => ({ ...x, [key]: x[key].filter((_, j) => j !== i) }));
  const setSub = (i, j, patch) => setF((x) => ({ ...x, services: x.services.map((s, k) => (k === i ? { ...s, subs: s.subs.map((b, m) => (m === j ? { ...b, ...patch } : b)) } : s)) }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await saveAuthority(buildPayload(f));
      await onSaved();
      onClose();
    } catch (err) { setError(err.message); setBusy(false); }
  };
  const top = [
    ...(isNew ? [{ name: "authority_key", label: "Key (lower case letters, digits, - or _; cannot change later)", type: "text", required: true }] : []),
    { name: "name", label: "Authority name", type: "text", required: true },
    { name: "kind", label: "Kind", type: "select", required: true, options: KINDS },
    { name: "table_title", label: "Table title", type: "text" },
    { name: "description", label: "Description", type: "textarea", full: true },
  ];
  return (
    <Modal title={isNew ? "Add authority set" : `Authority set: ${authority.name}`} onClose={onClose} wide>
      <form onSubmit={save}>
        <p className="bk-note">A set starts each new proposal option. Staff can change it per quote, and a proposal already made never changes. The business activity is typed per quote, so it is not kept here. Bank details and contact come from the defaults below.</p>
        <ErrorNote message={error} />
        {!isNew && <p className="bk-note">Key: <code className="bk-code">{authority.authority_key}</code></p>}
        <FormGrid fields={top} values={f} setValues={setF} />
        <h4 className="bk-mt">Images</h4>
        {KEY_OK.test(f.authority_key)
          ? <><ImagePick label="Logo" path={f.logo_path} onPath={(p) => set("logo_path", p)} authorityKey={f.authority_key} />
            <ImagePick label="Timeline" path={f.timeline_path} onPath={(p) => set("timeline_path", p)} authorityKey={f.authority_key} /></>
          : <p className="bk-muted">Enter a valid key to upload images. PNG or JPEG only.</p>}

        <h4 className="bk-mt">Costing rows</h4>
        <p className="bk-note">A service with sub services (for example a visa's government fee and service fee) takes their sum.</p>
        {f.services.map((s, i) => (
          <div key={i} className="bk-mt">
            <div className="bk-row">
              <input aria-label={`Service ${i + 1} name`} placeholder="Particulars" value={s.name} onChange={(e) => setRow("services", i, { name: e.target.value })} />
              <input aria-label={`Service ${i + 1} remarks`} placeholder="Remarks" value={s.remarks} onChange={(e) => setRow("services", i, { remarks: e.target.value })} />
              {s.subs.length
                ? <span className="bk-muted">Sum of sub services</span>
                : <input aria-label={`Service ${i + 1} AED`} placeholder="AED" inputMode="decimal" value={s.amount} onChange={(e) => setRow("services", i, { amount: e.target.value })} />}
              <Button onClick={() => setRow("services", i, { subs: [...s.subs, { name: "", amount: "" }], amount: "" })}>Add sub service</Button>
              <Button onClick={() => dropRow("services", i)}>Remove</Button>
            </div>
            {s.subs.map((b, j) => (
              <div className="bk-row" key={j} style={{ marginLeft: 24 }}>
                <input aria-label={`Service ${i + 1} sub ${j + 1} name`} placeholder="Sub service" value={b.name} onChange={(e) => setSub(i, j, { name: e.target.value })} />
                <input aria-label={`Service ${i + 1} sub ${j + 1} AED`} placeholder="AED" inputMode="decimal" value={b.amount} onChange={(e) => setSub(i, j, { amount: e.target.value })} />
                <Button onClick={() => setRow("services", i, { subs: s.subs.filter((_, m) => m !== j) })}>Remove</Button>
              </div>
            ))}
          </div>
        ))}
        <div className="bk-actions"><Button onClick={() => set("services", [...f.services, { name: "", remarks: "", amount: "", subs: [] }])}>Add row</Button></div>

        <h4 className="bk-mt">Add-on services</h4>
        {f.addons.map((a, i) => (
          <div className="bk-row" key={i}>
            <input aria-label={`Add-on ${i + 1} name`} placeholder="Particulars" value={a.name} onChange={(e) => setRow("addons", i, { name: e.target.value })} />
            <input aria-label={`Add-on ${i + 1} AED`} placeholder="AED (empty for text only)" inputMode="decimal" value={a.amount} onChange={(e) => setRow("addons", i, { amount: e.target.value })} />
            <input aria-label={`Add-on ${i + 1} text`} placeholder="Text instead of an amount" value={a.text} onChange={(e) => setRow("addons", i, { text: e.target.value })} />
            <Button onClick={() => dropRow("addons", i)}>Remove</Button>
          </div>
        ))}
        <div className="bk-actions"><Button onClick={() => set("addons", [...f.addons, { name: "", amount: "", text: "" }])}>Add add-on</Button></div>

        <h4 className="bk-mt">Notes and lists (one item per line)</h4>
        {LISTS.map(([k, label]) => (
          <label key={k} className="bk-mt" style={{ display: "block" }}>{label}
            <textarea aria-label={label} rows={4} value={f[k]} onChange={(e) => set(k, e.target.value)} style={{ width: "100%" }} />
          </label>
        ))}
        <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>Save</Button></div>
      </form>
    </Modal>
  );
}

function DefaultsModal({ defaults, onClose, onSaved }) {
  const c = defaults?.contact || {};
  const [v, setV] = useState({ usd_rate: defaults?.usd_rate ?? "", name: c.name || "", phone: c.phone || "", email: c.email || "", website: c.website || "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const fields = [
    { name: "usd_rate", label: "USD rate (AED per USD)", type: "text", required: true },
    { name: "name", label: "Contact name", type: "text" }, { name: "phone", label: "Contact phone", type: "text" },
    { name: "email", label: "Contact email", type: "text" }, { name: "website", label: "Contact website", type: "text" },
  ];
  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const rate = String(v.usd_rate).trim();
      if (!/^[0-9]+(\.[0-9]+)?$/.test(rate) || Number(rate) <= 0) throw new Error("The USD rate must be a number more than zero.");
      await saveDefaults({ usd_rate: rate, contact: { name: v.name, phone: v.phone, email: v.email, website: v.website } });
      await onSaved();
      onClose();
    } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Modal title="Proposal defaults" onClose={onClose}>
      <form onSubmit={save}>
        <p className="bk-note">The USD rate starts each new proposal and can be changed per quote. The contact prints on every proposal.</p>
        <ErrorNote message={error} />
        <FormGrid fields={fields} values={v} setValues={setV} />
        <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>Save</Button></div>
      </form>
    </Modal>
  );
}

export default function ProposalAuthorities() {
  const list = useLoad(loadAuthorities, []);
  const settings = useLoad(loadHubSettings, []);
  const [edit, setEdit] = useState(null);       // { authority } (authority null = new)
  const [defaults, setDefaults] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const d = settings.data?.proposal_defaults;

  const toggle = async (a) => {
    setBusy(a.authority_key); setError(null);
    try { await saveAuthority(buildPayload({ ...toForm(a), active: a.active === false })); } catch (e) { setError(e.message); }
    await list.reload();
    setBusy(null);
  };
  const columns = [
    { label: "Name", render: (a) => <>{a.name} {a.active === false && <Badge>Archived</Badge>}</> },
    { label: "Key", key: "authority_key" },
    { label: "Kind", render: (a) => (a.kind === "mainland" ? "Mainland" : "Free zone") },
    { label: "Rows", render: (a) => (a.services || []).length },
    { label: "Images", render: (a) => [a.logo_path && "Logo", a.timeline_path && "Timeline"].filter(Boolean).join(", ") || "–" },
    { label: "", render: (a) => (
      <span className="bk-actions">
        <Button onClick={() => setEdit({ authority: a })}>Edit</Button>
        <Button busy={busy === a.authority_key} onClick={() => toggle(a)}>{a.active === false ? "Restore" : "Archive"}</Button>
      </span>
    ) },
  ];
  return (
    <Panel title="Business Formation Proposal sets" sub={d ? `USD rate ${d.usd_rate}. Contact: ${[d.contact?.name, d.contact?.phone, d.contact?.email].filter(Boolean).join(" · ") || "not set"}.` : "Saved licence authority sets, the USD rate and the contact."}
      actions={<span className="bk-actions"><Button onClick={() => setDefaults(true)}>USD rate and contact</Button><Button onClick={() => setEdit({ authority: null })}>Add authority set</Button></span>}>
      <ErrorNote message={error || list.error || settings.error} onClose={() => setError(null)} />
      {list.loading && !list.data ? <Spinner /> : <DataTable columns={columns} rows={list.data || []} pageSize={50} search="Search sets" empty="No authority sets yet." />}
      {edit && <AuthorityModal authority={edit.authority} onClose={() => setEdit(null)} onSaved={list.reload} />}
      {defaults && <DefaultsModal defaults={d} onClose={() => setDefaults(false)} onSaved={settings.reload} />}
    </Panel>
  );
}
