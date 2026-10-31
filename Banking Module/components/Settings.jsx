import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, PageHead, Panel, fmtDate, fmtDateTime, useAction, useBanking, useLoad } from "./shared";
import { insertRow, listAll, rpc, run, table, updateRow } from "../services/bankingApi";
import { ROLES, VERIFICATION } from "../logic/constants";
import { money } from "../logic/pricing";

export default function Settings() {
  const { can } = useBanking();
  const [tab, setTab] = useState("numbering");
  const tabs = [["numbering", "Document Numbering"], ["commercial", "Commercial"], ["services", "Supplementary Services"], ["risk", "Risk Rules & Notes"], ...(can("settings.manage") ? [["access", "Users & Permissions"]] : []), ...(can("audit.view") ? [["audit", "Audit Trail"]] : [])];
  return (
    <div>
      <PageHead title="Settings" />
      <div className="bk-tabs">{tabs.map(([k, l]) => <button type="button" key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === "numbering" && <Numbering />}
      {tab === "commercial" && <Commercial />}
      {tab === "services" && <Services />}
      {tab === "risk" && <Risk />}
      {tab === "access" && <Access />}
      {tab === "audit" && <Audit />}
    </div>
  );
}

function Numbering() {
  const { can } = useBanking();
  const status = useLoad(() => rpc("banking_numbering_status"), []);
  const [edit, setEdit] = useState(null);
  const manage = can("settings.manage");
  const kinds = [["quote", "Quotations"], ["letter", "Engagement Letters"]];
  return (
    <div>
      <ErrorNote message={status.error} />
      {kinds.map(([k, label]) => {
        const d = status.data?.[k];
        return (
          <Panel key={k} title={label} sub="Numbers are given automatically, in order. Issued documents keep their number." actions={manage && d && <Button variant="primary" onClick={() => setEdit({ k, label, ...d })}>Edit</Button>}>
            {d && <dl className="bk-kv"><div><dt>Next number</dt><dd>{d.preview}</dd></div><div><dt>Format</dt><dd>{d.format}</dd></div><div><dt>Next serial</dt><dd>{d.next_serial}</dd></div><div><dt>Digits</dt><dd>{d.digits}</dd></div><div><dt>Serial restarts</dt><dd>{{ never: "Never: runs on continuously", year: "Each year", month: "Each month" }[d.restart]}</dd></div></dl>}
          </Panel>
        );
      })}
      {edit && <FormModal title={`Numbering · ${edit.label}`} initial={edit} onClose={() => setEdit(null)} note="In the format, {YYYY} is the year, {MM} the month and {SERIAL} the serial number. A number already used is skipped."
        fields={[{ name: "format", label: "Format", required: true, full: true }, { name: "next_serial", label: "Next serial", type: "number", required: true }, { name: "digits", label: "Digits", type: "number", required: true }, { name: "restart", label: "Serial restarts", type: "select", required: true, options: [{ value: "never", label: "Never: runs on continuously" }, { value: "year", label: "Each year" }, { value: "month", label: "Each month" }] }]}
        onSubmit={async (v) => { await rpc("banking_numbering_save", { p_kind: edit.k, p_format: v.format, p_digits: v.digits, p_restart: v.restart, p_next: v.next_serial }); await status.reload(); }} />}
    </div>
  );
}

function Commercial() {
  const { can } = useBanking();
  const s = useLoad(() => run(table("banking_settings").select("*").order("key")), []);
  const [edit, setEdit] = useState(null);
  const manage = can("settings.manage");
  const byKey = Object.fromEntries((s.data || []).map((r) => [r.key, r.value]));
  const saveKey = async (key, value) => { await updateRow2(key, value); await s.reload(); };
  return (
    <div>
      <ErrorNote message={s.error} />
      <Panel title="Pricing defaults" actions={manage && <Button variant="primary" onClick={() => setEdit("pricing")}>Edit</Button>}>
        <dl className="bk-kv"><div><dt>Default AB Capital service fee</dt><dd>{money(byKey.default_service_fee)}</dd></div><div><dt>VAT</dt><dd>{byKey.vat?.mode}, {byKey.vat?.rate}%</dd></div><div><dt>Quotation validity</dt><dd>{byKey.quotation_validity_days} days</dd></div><div><dt>Discount approval above</dt><dd>{byKey.discount_approval_percent}%</dd></div><div><dt>Payment required before submission</dt><dd>{byKey.require_payment_before_submission ? "Yes" : "No"}</dd></div></dl>
      </Panel>
      <Panel title="All settings" sub="Lists, letterhead, payment details and engagement letter wording. Edit as JSON.">
        <DataTable rows={s.data || []} onRow={manage ? (r) => setEdit(r) : undefined} columns={[{ key: "key", label: "Setting" }, { key: "description", label: "Meaning" }, { key: "updated_at", label: "Updated", render: (r) => fmtDate(r.updated_at) }]} />
      </Panel>
      {edit === "pricing" && <FormModal title="Pricing defaults" initial={{ fee: byKey.default_service_fee, mode: byKey.vat?.mode, rate: byKey.vat?.rate, days: byKey.quotation_validity_days, disc: byKey.discount_approval_percent, pay: !!byKey.require_payment_before_submission }} onClose={() => setEdit(null)} fields={[{ name: "fee", label: "Default service fee (AED)", type: "number", required: true }, { name: "mode", label: "VAT treatment", type: "select", options: ["inclusive", "exclusive", "none"], required: true }, { name: "rate", label: "VAT rate %", type: "number", required: true }, { name: "days", label: "Quotation validity days", type: "number", required: true }, { name: "disc", label: "Discount approval above %", type: "number", required: true }, { name: "pay", label: "Payment required before submission", type: "bool" }]}
        onSubmit={async (v) => { await saveKey("default_service_fee", v.fee); await saveKey("vat", { mode: v.mode, rate: v.rate }); await saveKey("quotation_validity_days", v.days); await saveKey("discount_approval_percent", v.disc); await saveKey("require_payment_before_submission", !!v.pay); }} />}
      {edit && edit !== "pricing" && <JsonEdit row={edit} onClose={() => setEdit(null)} onSave={(v) => saveKey(edit.key, v)} />}
    </div>
  );
}

const updateRow2 = (key, value) => run(table("banking_settings").update({ value }).eq("key", key));

function JsonEdit({ row, onClose, onSave }) {
  return <FormModal wide title={row.key} note={row.description} initial={{ text: JSON.stringify(row.value, null, 2) }} onClose={onClose} fields={[{ name: "text", label: "Value (JSON)", type: "textarea", rows: 18, full: true, required: true }]}
    onSubmit={async (v) => { let parsed; try { parsed = JSON.parse(v.text); } catch { throw new Error("That is not valid JSON"); } await onSave(parsed); }} />;
}

function Services() {
  const { can } = useBanking();
  const list = useLoad(() => listAll("banking_supplementary_services", "*", "service_name", true), []);
  const [edit, setEdit] = useState(null);
  const manage = can("pricing.manage");
  return (
    <Panel title="Supplementary services" sub="Never added automatically. A quotation line is added only when selected." actions={manage && <Button variant="primary" onClick={() => setEdit({ is_active: true })}>Add service</Button>}>
      <ErrorNote message={list.error} />
      <DataTable rows={list.data || []} onRow={manage ? setEdit : undefined} columns={[{ key: "service_name", label: "Service" }, { key: "default_fee", label: "Default fee", right: true, render: (r) => money(r.default_fee) }, { key: "creates_task_type", label: "Task on acceptance" }, { key: "is_active", label: "Status", render: (r) => <Badge>{r.is_active ? "Active" : "Inactive"}</Badge> }]} />
      {edit && <FormModal title="Service" initial={edit} onClose={() => setEdit(null)} fields={[{ name: "service_code", label: "Code", required: true }, { name: "service_name", label: "Name", required: true }, { name: "default_fee", label: "Default fee (AED)", type: "number", required: true }, { name: "creates_task_type", label: "Task type on acceptance" }, { name: "is_active", label: "Active", type: "bool" }]} onSubmit={async (v) => { if (edit.id) await updateRow("banking_supplementary_services", edit.id, v); else await insertRow("banking_supplementary_services", v); await list.reload(); }} />}
    </Panel>
  );
}

function Risk() {
  const { can } = useBanking();
  const rules = useLoad(() => listAll("banking_risk_rules"), []);
  const notes = useLoad(() => run(table("banking_eligibility_notes").select("*, banking_partners(bank_name)").order("created_at")), []);
  const banks = useLoad(() => listAll("banking_partners", "id, bank_name", "bank_name", true), []);
  const [editRule, setEditRule] = useState(null);
  const [editNote, setEditNote] = useState(null);
  const manage = can("masters.manage");
  const verify = [{ name: "source", label: "Source" }, { name: "last_verified_date", label: "Last verified date", type: "date" }, { name: "reviewer", label: "Reviewer" }, { name: "verification_status", label: "Verification", type: "select", options: VERIFICATION, required: true }, { name: "is_active", label: "Active", type: "bool" }];
  return (
    <div>
      <Panel title="Risk rules" sub="From the Setup Guide deck. They raise a flag for staff to review; they never reject a client." actions={manage && <Button variant="primary" onClick={() => setEditRule({ rule_type: "Nationality", risk_level: "Enhanced Due Diligence", verification_status: "Unverified", is_active: true })}>Add rule</Button>}>
        <ErrorNote message={rules.error} />
        <DataTable rows={rules.data || []} onRow={manage ? setEditRule : undefined} columns={[{ key: "rule_type", label: "Type" }, { key: "match_values", label: "Matches", render: (r) => r.match_values.join(", ") }, { key: "risk_level", label: "Level", render: (r) => <Badge>{r.risk_level}</Badge> }, { key: "requirement", label: "What it asks for" }, { key: "verification_status", label: "Data", render: (r) => <Badge>{r.verification_status}</Badge> }]} />
      </Panel>
      <Panel title="Internal eligibility notes" sub="Shown beside the bank comparison as considerations." actions={manage && <Button variant="primary" onClick={() => setEditNote({ note_type: "General", verification_status: "Unverified", is_active: true })}>Add note</Button>}>
        <ErrorNote message={notes.error} />
        <DataTable rows={notes.data || []} onRow={manage ? setEditNote : undefined} columns={[{ key: "b", label: "Bank", render: (r) => r.banking_partners?.bank_name || "Any" }, { key: "note_type", label: "Type" }, { key: "note", label: "Note" }, { key: "verification_status", label: "Data", render: (r) => <Badge>{r.verification_status}</Badge> }, { key: "last_verified_date", label: "Last verified", render: (r) => fmtDate(r.last_verified_date) }]} />
      </Panel>
      {editRule && <FormModal wide title="Risk rule" initial={editRule} onClose={() => setEditRule(null)} fields={[{ name: "rule_type", label: "Type", type: "select", options: ["Nationality", "Activity", "Structure"], required: true }, { name: "match_values", label: "Matches (comma separated)", type: "list", full: true, required: true }, { name: "risk_level", label: "Level", type: "select", options: ["Low", "Enhanced Due Diligence"], required: true }, { name: "requirement", label: "What it asks for", type: "textarea", full: true }, ...verify]} onSubmit={async (v) => { if (editRule.id) await updateRow("banking_risk_rules", editRule.id, v); else await insertRow("banking_risk_rules", v); await rules.reload(); }} />}
      {editNote && <FormModal wide title="Eligibility note" initial={editNote} onClose={() => setEditNote(null)} fields={[{ name: "bank_id", label: "Bank", type: "select", placeholder: "Any bank", options: (banks.data || []).map((b) => ({ value: b.id, label: b.bank_name })) }, { name: "note_type", label: "Type", type: "select", options: ["Nationality", "Activity", "Office", "General"], required: true }, { name: "match_values", label: "Relevant to (comma separated)", type: "list", full: true }, { name: "note", label: "Note", type: "textarea", full: true, required: true }, ...verify]} onSubmit={async (v) => { if (editNote.id) await updateRow("banking_eligibility_notes", editNote.id, v); else await insertRow("banking_eligibility_notes", v); await notes.reload(); }} />}
    </div>
  );
}

function Access() {
  const { people } = useBanking();
  const roles = useLoad(() => run(table("banking_user_roles").select("*")), []);
  const perms = useLoad(() => run(table("banking_role_permissions").select("*")), []);
  const { error, busy, act } = useAction(async () => { await roles.reload(); await perms.reload(); });
  const roleOf = (id) => (roles.data || []).find((r) => r.user_id === id)?.role || "";
  const setRole = (id, role) => act(async () => {
    if (role) await run(table("banking_user_roles").upsert({ user_id: id, role }));
    else await run(table("banking_user_roles").delete().eq("user_id", id));
  });
  const allPerms = [...new Set((perms.data || []).map((p) => p.permission))].sort();
  const has = (role, perm) => (perms.data || []).some((p) => p.role === role && p.permission === perm && p.allowed);
  const toggle = (role, perm) => act(() => run(table("banking_role_permissions").upsert({ role, permission: perm, allowed: !has(role, perm) })));
  return (
    <div>
      <Panel title="Users" sub="CRM admins always have full access here.">
        <ErrorNote message={roles.error || perms.error || error} />
        <DataTable rows={people} search="Search users…" columns={[{ key: "full_name", label: "User" }, { key: "role", label: "CRM role" }, { key: "b", label: "Banking role", render: (u) => <select aria-label={`Banking role of ${u.full_name}`} value={roleOf(u.id)} disabled={busy} onChange={(e) => setRole(u.id, e.target.value)}><option value="">No access</option>{ROLES.map((r) => <option key={r}>{r}</option>)}</select> }]} />
      </Panel>
      <Panel title="Permissions by role" sub="Changes apply at once.">
        <div className="bk-table-wrap"><table className="bk-table bk-matrix"><thead><tr><th>Permission</th>{ROLES.map((r) => <th key={r}>{r.replace("_", " ")}</th>)}</tr></thead>
          <tbody>{allPerms.map((p) => <tr key={p}><td>{p}</td>{ROLES.map((r) => <td key={r}><input type="checkbox" aria-label={`${r} ${p}`} checked={has(r, p)} disabled={busy} onChange={() => toggle(r, p)} /></td>)}</tr>)}</tbody></table></div>
      </Panel>
    </div>
  );
}

function Audit() {
  const { personName } = useBanking();
  const logs = useLoad(() => run(table("banking_activity_logs").select("*").order("occurred_at", { ascending: false }).limit(1000)), []);
  return (
    <Panel title="Audit trail" sub="Latest 1,000 changes. It cannot be edited. Passport and Emirates ID values are masked.">
      <ErrorNote message={logs.error} />
      <DataTable search="Search…" rows={logs.data || []} columns={[{ key: "occurred_at", label: "When", render: (r) => fmtDateTime(r.occurred_at) }, { key: "actor", label: "By", render: (r) => personName(r.actor) }, { key: "action", label: "Action" }, { key: "entity_table", label: "Record", render: (r) => r.entity_table.replace("banking_", "") }, { key: "d", label: "Changed", render: (r) => <code className="bk-code">{r.action === "UPDATE" ? JSON.stringify(r.new_data) : ""}</code> }]} />
    </Panel>
  );
}
