import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, PageHead, Panel, Spinner, fmtDate, useAction, useBanking, useLoad } from "./shared";
import { insertRow, listAll, rpc, run, table, updateRow } from "../services/bankingApi";
import { VERIFICATION } from "../logic/constants";
import { money } from "../logic/pricing";

const NOT_POLICY = "Internal CRM data supplied by AB Capital. Not verified or current official bank policy unless marked Verified with a date and reviewer.";

const SCHEME_FIELDS = [
  ["minimum_balance", "Minimum balance", "number"], ["initial_deposit", "Initial deposit", "number"], ["monthly_fee", "Monthly maintenance fee", "number"], ["minimum_average_balance", "Minimum average balance", "number"], ["below_balance_fee", "Fee if below balance", "number"],
  ["physical_office_required", "Physical office requirement", "tri"], ["non_resident_eligible", "Non-resident eligibility", "tri"], ["client_visit_required", "Required client visit", "tri"], ["processing_time", "Processing time"], ["valid_from", "Valid from", "date"], ["valid_until", "Valid until", "date"],
  ["eligibility_conditions", "Eligibility conditions", "textarea"], ["supported_activities", "Supported business activities", "textarea"], ["nationality_restrictions", "Nationality restrictions", "textarea"], ["description", "Scheme description", "textarea"], ["internal_notes", "Internal notes", "textarea"],
  ["source", "Source"], ["last_verified_date", "Last verified date", "date"], ["reviewer", "Reviewer"], ["verification_status", "Verification", "select"],
].map(([name, label, type]) => ({ name, label, type: type || "text", full: type === "textarea", ...(type === "select" ? { options: VERIFICATION, required: true } : {}) }));

export function BankSchemes({ bankId }) {
  const { can } = useBanking();
  const schemes = useLoad(() => run(table("banking_schemes").select("*, banking_partners(bank_name), banking_scheme_versions(*)").is("deleted_at", null).order("scheme_name")), []);
  const [add, setAdd] = useState(false);
  const [ver, setVer] = useState(null);
  const [hist, setHist] = useState(null);
  const { error, act } = useAction(schemes.reload);
  const manage = can("masters.manage");
  const latest = (s) => [...s.banking_scheme_versions].sort((a, b) => b.version - a.version)[0] || {};
  return (
    <div>
      <PageHead title="Plans">{manage && <Button variant="primary" onClick={() => setAdd(true)}>Add plan</Button>}</PageHead>
      <ErrorNote message={schemes.error || error} />
      <DataTable search="Search plans…" rows={(schemes.data || []).filter((x) => x.bank_id === bankId)} empty="No plans recorded for this bank." columns={[
        { key: "scheme_name", label: "Plan" }, { key: "account_type", label: "Account type" },
        { key: "mab", label: "Min. avg balance", right: true, render: (s) => money(latest(s).minimum_average_balance) }, { key: "below", label: "Below-balance fee", right: true, render: (s) => money(latest(s).below_balance_fee) }, { key: "mf", label: "Monthly fee", right: true, render: (s) => money(latest(s).monthly_fee) },
        { key: "current_version", label: "Version" }, { key: "v", label: "Data", render: (s) => <Badge>{latest(s).verification_status}</Badge> }, { key: "lv", label: "Last verified", render: (s) => fmtDate(latest(s).last_verified_date) },
        { key: "is_active", label: "Status", render: (s) => <Badge>{s.is_active ? "Active" : "Inactive"}</Badge> },
        { key: "a", label: "", render: (s) => <span className="bk-actions"><Button onClick={() => setHist(s)}>History</Button>{manage && <><Button onClick={() => setVer(s)}>New version</Button><Button onClick={() => act(() => updateRow("banking_schemes", s.id, { is_active: !s.is_active }))}>{s.is_active ? "Deactivate" : "Activate"}</Button></>}</span> },
      ]} />
      {add && <FormModal title="Add plan" onClose={() => setAdd(false)} fields={[{ name: "scheme_name", label: "Plan name", required: true }, { name: "account_type", label: "Account type", help: "Zero Balance, Standard Business, Digital Business, …" }]} onSubmit={async (v) => { const s = await insertRow("banking_schemes", { ...v, bank_id: bankId }); await rpc("banking_scheme_save", { p_scheme: s.id, p: { source: "Entered in CRM" } }); await schemes.reload(); }} />}
      {ver && <FormModal wide title={`New version · ${ver.scheme_name}`} note="Saving creates a new version. Earlier versions stay on record." fields={SCHEME_FIELDS} initial={{ verification_status: "Unverified", ...latest(ver) }} onClose={() => setVer(null)} onSubmit={async (v) => { await rpc("banking_scheme_save", { p_scheme: ver.id, p: v }); await schemes.reload(); }} />}
      {hist && <Panel title={`Version history · ${hist.scheme_name}`} actions={<Button onClick={() => setHist(null)}>Close</Button>}>
        <DataTable rows={[...hist.banking_scheme_versions].sort((a, b) => b.version - a.version)} columns={[{ key: "version", label: "Version" }, { key: "minimum_average_balance", label: "MAB", render: (r) => money(r.minimum_average_balance) }, { key: "monthly_fee", label: "Monthly", render: (r) => money(r.monthly_fee) }, { key: "source", label: "Source" }, { key: "verification_status", label: "Data", render: (r) => <Badge>{r.verification_status}</Badge> }, { key: "created_at", label: "Created", render: (r) => fmtDate(r.created_at) }]} />
      </Panel>}
    </div>
  );
}

export function BankPricing({ bankId }) {
  const { can } = useBanking();
  const schemes = useLoad(() => listAll("banking_schemes", "id, bank_id, scheme_name", "scheme_name", true), []);
  const pricing = useLoad(() => listAll("banking_pricing", "*, banking_partners(bank_name), banking_schemes(scheme_name)", "effective_date"), []);
  const [edit, setEdit] = useState(null);
  const manage = can("pricing.manage");
  const fields = [
    { name: "scheme_id", label: "Plan", type: "select", placeholder: "All plans of this bank", options: (schemes.data || []).filter((s) => s.bank_id === bankId).map((s) => ({ value: s.id, label: s.scheme_name })) },
    { name: "account_opening_fee", label: "Bank account opening fee", type: "number", required: true }, { name: "other_bank_charges", label: "Other bank charges", type: "number", required: true },
    { name: "initial_deposit", label: "Initial deposit (never revenue)", type: "number" }, { name: "minimum_balance", label: "Minimum balance (never revenue)", type: "number" },
    { name: "bank_fee_collected_by_ab", label: "Bank fee collected through AB Capital", type: "bool", help: "Off: the client pays the bank directly." },
    { name: "service_fee", label: "AB Capital service fee", type: "number", help: "Blank uses the default in Settings." }, { name: "service_fee_min", label: "Guide: lowest service fee", type: "number" }, { name: "service_fee_max", label: "Guide: highest service fee", type: "number" },
    { name: "effective_date", label: "Effective date", type: "date", required: true }, { name: "expiry_date", label: "Expiry date", type: "date" }, { name: "source", label: "Source" }, { name: "remarks", label: "Remarks", type: "textarea", full: true },
  ];
  return (
    <div>
      <PageHead title="Pricing" sub="To change a price, add a new row with a new effective date; old rows are kept.">{manage && <Button variant="primary" onClick={() => setEdit({ account_opening_fee: 0, other_bank_charges: 0, bank_fee_collected_by_ab: true, effective_date: new Date().toISOString().slice(0, 10) })}>Add price</Button>}</PageHead>
      <ErrorNote message={pricing.error} />
      <DataTable rows={(pricing.data || []).filter((r) => r.bank_id === bankId)} onRow={manage ? (r) => setEdit({ ...r, id: undefined }) : undefined} empty="No pricing recorded for this bank. The default service fee from Settings applies." columns={[
        { key: "s", label: "Plan", render: (r) => r.banking_schemes?.scheme_name || "All" }, { key: "account_opening_fee", label: "Opening fee", right: true, render: (r) => money(r.account_opening_fee) }, { key: "other_bank_charges", label: "Other", right: true, render: (r) => money(r.other_bank_charges) },
        { key: "c", label: "Collected", render: (r) => (r.bank_fee_collected_by_ab ? "Through AB Capital" : "Client pays bank") }, { key: "service_fee", label: "Service fee", right: true, render: (r) => money(r.service_fee) }, { key: "g", label: "Guide range", render: (r) => (r.service_fee_min != null ? `${r.service_fee_min}–${r.service_fee_max}` : "–") },
        { key: "effective_date", label: "From", render: (r) => fmtDate(r.effective_date) }, { key: "expiry_date", label: "To", render: (r) => fmtDate(r.expiry_date) }, { key: "source", label: "Source" },
      ]} />
      {edit && <FormModal wide title="New price (copies the row you opened)" fields={fields} initial={edit} onClose={() => setEdit(null)} onSubmit={async (v) => { await insertRow("banking_pricing", { ...v, bank_id: bankId }); await pricing.reload(); }} />}
    </div>
  );
}

const CONDITIONS = [
  { value: "free_zone", label: "Free zone company" }, { value: "existing_company", label: "Existing company" }, { value: "imports_exports", label: "Imports / exports goods" }, { value: "goaml_required", label: "GoAML applies" }, { value: "vat_registered", label: "VAT registered" },
  { value: "corporate_shareholder", label: "Corporate shareholder" }, { value: "corporate_shareholder_ubo_resident", label: "Corporate shareholder, UBO resident in UAE" }, { value: "employed", label: "Applicant employed" }, { value: "self_employed", label: "Applicant self-employed" },
];

export function DocumentChecklists({ bankId = null, general = false }) {
  const { can } = useBanking();
  const tpl = useLoad(() => run(table("banking_checklist_templates").select("*, banking_partners(bank_name)").order("template_name")), []);
  const types = useLoad(() => run(table("banking_document_types").select("*").is("deleted_at", null).order("doc_name")), []);
  const [open, setOpen] = useState(null);
  const [editTpl, setEditTpl] = useState(null);
  const [editType, setEditType] = useState(null);
  const manage = can("masters.manage");
  const rows = (tpl.data || []).filter((t) => (general ? !t.bank_id : t.bank_id === bankId));
  const current = rows.find((t) => t.id === open) || (rows.length === 1 ? rows[0] : null);
  return (
    <div>
      <PageHead title="Document List">{manage && <><Button onClick={() => setEditType({ is_active: true })}>Add document type</Button><Button onClick={() => setEditTpl({ is_active: true, account_kind: "Business", verification_status: "Unverified", version: 1, bank_id: bankId })}>Add another list</Button></>}</PageHead>
      <ErrorNote message={tpl.error} />
      <DataTable rows={rows} onRow={(r) => setOpen(r.id)} empty="This bank uses the Standard list." columns={[
        { key: "template_name", label: "List" }, { key: "account_kind", label: "Kind" }, { key: "version", label: "Version" }, { key: "uses_standard", label: "List", render: (r) => (r.uses_standard ? "Uses Standard" : "Own items") },
        { key: "verification_status", label: "Data", render: (r) => <Badge>{r.verification_status}</Badge> }, { key: "last_verified_date", label: "Last verified", render: (r) => fmtDate(r.last_verified_date) }, { key: "reviewer", label: "Reviewer" }, { key: "source", label: "Source" },
      ]} />
      {current && <TemplateItems template={current} types={types.data || []} onClose={rows.length > 1 ? () => setOpen(null) : null} onEdit={() => setEditTpl(current)} reloadTpl={tpl.reload} />}
      {editTpl && <FormModal wide title={editTpl.id ? editTpl.template_name : "Add checklist"} initial={editTpl} onClose={() => setEditTpl(null)} fields={[
        { name: "template_code", label: "Code", required: true }, { name: "template_name", label: "Name", required: true }, { name: "account_kind", label: "Account kind", type: "select", options: ["Business", "Personal"], required: true }, { name: "version", label: "Version", type: "number", required: true }, { name: "uses_standard", label: "Uses the Standard list", type: "bool" },
        { name: "source", label: "Source" }, { name: "last_verified_date", label: "Last verified date", type: "date" }, { name: "reviewer", label: "Reviewer" }, { name: "verification_status", label: "Verification", type: "select", options: VERIFICATION, required: true }, { name: "is_active", label: "Active", type: "bool" }, { name: "internal_notes", label: "Internal notes", type: "textarea", full: true },
      ]} onSubmit={async (v) => { if (editTpl.id) await updateRow("banking_checklist_templates", editTpl.id, v); else await insertRow("banking_checklist_templates", { ...v, bank_id: bankId }); await tpl.reload(); }} />}
      {editType && <FormModal title="Document type" initial={editType} onClose={() => setEditType(null)} fields={[{ name: "doc_code", label: "Code", required: true }, { name: "doc_name", label: "Name", required: true }, { name: "has_expiry", label: "Has an expiry date", type: "bool" }, { name: "is_sensitive", label: "Sensitive", type: "bool" }, { name: "is_information", label: "Information, not a file", type: "bool" }, { name: "is_active", label: "Active", type: "bool" }]} onSubmit={async (v) => { await insertRow("banking_document_types", v); await types.reload(); }} />}
    </div>
  );
}

function TemplateItems({ template, types, onClose, onEdit, reloadTpl }) {
  const { can } = useBanking();
  const items = useLoad(async () => {
    let source = template.id;
    if (template.uses_standard) source = (await run(table("banking_checklist_templates").select("id").eq("template_code", "STANDARD").eq("is_active", true).order("version", { ascending: false }).limit(1).single())).id;
    return run(table("banking_checklist_items").select("*, banking_document_types(doc_name)").eq("template_id", source).order("sort_order"));
  }, [template.id, template.uses_standard]);
  const customise = () => act(async () => {
    const copies = (items.data || []).map((i) => ({ template_id: template.id, document_type_id: i.document_type_id, requirement_label: i.requirement_label, per_shareholder: i.per_shareholder, condition_key: i.condition_key, is_mandatory: i.is_mandatory, internal_note: i.internal_note, sort_order: i.sort_order, is_active: i.is_active }));
    await run(table("banking_checklist_items").insert(copies));
    await updateRow("banking_checklist_templates", template.id, { uses_standard: false });
    await reloadTpl();
  });
  const [edit, setEdit] = useState(null);
  const { error, act } = useAction(items.reload);
  const manage = can("masters.manage");
  return (
    <Panel title={template.template_name} sub={template.internal_notes} actions={<>{manage && <><Button onClick={onEdit}>Edit details</Button>{template.uses_standard ? <Button variant="primary" onClick={customise}>Customise for this bank</Button> : <Button variant="primary" onClick={() => setEdit({ is_mandatory: true, is_active: true, sort_order: ((items.data?.length || 0) + 1) * 10 })}>Add item</Button>}</>}{onClose && <Button onClick={onClose}>Close</Button>}</>}>
      <ErrorNote message={items.error || error} />
      {template.uses_standard && <p className="bk-note">This bank uses the Standard list, shown below. Press Customise to give it its own copy to edit.</p>}
      <DataTable pageSize={40} rows={items.data || []} empty="No items." columns={[
        { key: "sort_order", label: "#" }, { key: "d", label: "Document", render: (r) => r.requirement_label || r.banking_document_types?.doc_name }, { key: "per_shareholder", label: "Each partner", render: (r) => (r.per_shareholder ? "Yes" : "–") }, { key: "condition_key", label: "Condition", render: (r) => CONDITIONS.find((c) => c.value === r.condition_key)?.label || "–" }, { key: "is_mandatory", label: "Mandatory", render: (r) => (r.is_mandatory ? "Yes" : "If applicable") }, { key: "is_active", label: "Status", render: (r) => <Badge>{r.is_active ? "Active" : "Inactive"}</Badge> },
        ...(manage && !template.uses_standard ? [{ key: "a", label: "", render: (r) => <span className="bk-actions"><Button onClick={() => setEdit(r)}>Edit</Button><Button onClick={() => act(() => updateRow("banking_checklist_items", r.id, { is_active: !r.is_active }))}>{r.is_active ? "Deactivate" : "Activate"}</Button></span> }] : []),
      ]} />
      {edit && <FormModal title="Checklist item" initial={edit} onClose={() => setEdit(null)} fields={[{ name: "document_type_id", label: "Document type", type: "select", required: true, options: types.map((t) => ({ value: t.id, label: t.doc_name })) }, { name: "requirement_label", label: "Wording for this bank" }, { name: "per_shareholder", label: "Needed for each partner", type: "bool" }, { name: "condition_key", label: "Only when", type: "select", placeholder: "Always", options: CONDITIONS }, { name: "is_mandatory", label: "Mandatory", type: "bool" }, { name: "sort_order", label: "Order", type: "number", required: true }, { name: "internal_note", label: "Internal note", type: "textarea", full: true }, { name: "is_active", label: "Active", type: "bool" }]}
        onSubmit={async (v) => { if (edit.id) await updateRow("banking_checklist_items", edit.id, v); else await insertRow("banking_checklist_items", { ...v, template_id: template.id }); await items.reload(); }} />}
    </Panel>
  );
}
