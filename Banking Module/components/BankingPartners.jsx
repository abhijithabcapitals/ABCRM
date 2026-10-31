// One home for everything about a bank: details and RMs, plans, pricing, document list and internal notes.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, KeyVals, PageHead, Panel, Spinner, fmtDate, useAction, useBanking, useLoad } from "./shared";
import { insertRow, rpc, run, table, updateRow } from "../services/bankingApi";
import { BankPricing, BankSchemes, DocumentChecklists } from "./Masters";
import { VERIFICATION } from "../logic/constants";

const NOT_POLICY = "Internal CRM data supplied by AB Capital. Not verified or current official bank policy unless marked Verified with a date and reviewer.";
const SECTIONS = [["details", "Details & RMs"], ["plans", "Plans"], ["pricing", "Pricing"], ["documents", "Document List"], ["notes", "Internal Notes"]];
const yesNo = (v) => (v == null ? "Not recorded" : v ? "Yes" : "No");

const BANK_FIELDS = [
  { name: "bank_code", label: "Code", required: true }, { name: "bank_name", label: "Bank name", required: true }, { name: "logo_url", label: "Bank logo URL" }, { name: "website", label: "Website" }, { name: "contact_person", label: "Bank contact person" },
  { name: "submission_method", label: "Application submission method" }, { name: "appointment_required", label: "Appointment required", type: "tri" }, { name: "digital_application", label: "Digital application available", type: "tri" }, { name: "general_processing_time", label: "General processing time", help: "Free text. Shown as guidance, never promised." },
  { name: "aliases", label: "Names used in Excel", type: "list", full: true, help: "Comma separated." }, { name: "internal_remarks", label: "Internal remarks", type: "textarea", full: true }, { name: "is_active", label: "Active", type: "bool" },
];

export default function BankingPartners() {
  const { can } = useBanking();
  const banks = useLoad(() => run(table("banking_partners").select("*, banking_relationship_managers(id, is_active), banking_schemes(id, is_active), banking_pricing(id), banking_checklist_templates(id, uses_standard, verification_status, is_active, banking_checklist_items(id))").is("deleted_at", null).order("bank_name")), []);
  const [openId, setOpenId] = useState(null);
  const [general, setGeneral] = useState(false);
  const [adding, setAdding] = useState(false);
  const open = (banks.data || []).find((b) => b.id === openId);

  if (open) return <BankWorkspace bank={open} onBack={() => setOpenId(null)} reload={banks.reload} />;
  if (general) {
    return (
      <div>
        <PageHead title="Standard & Personal Document Lists" sub="Used by banks with no list of their own, and for personal accounts."><Button onClick={() => setGeneral(false)}>Back to banks</Button></PageHead>
        <DocumentChecklists general />
      </div>
    );
  }
  const listOf = (b) => {
    const t = b.banking_checklist_templates.filter((x) => x.is_active);
    if (!t.length) return "Standard list";
    if (t.every((x) => x.uses_standard)) return "Standard list";
    return `${t.reduce((n, x) => n + x.banking_checklist_items.length, 0)} items`;
  };
  return (
    <div>
      <PageHead title="Banking Partners" sub={NOT_POLICY}>
        <Button onClick={() => setGeneral(true)}>Standard document lists</Button>
        {can("masters.manage") && <Button variant="primary" onClick={() => setAdding(true)}>Add bank</Button>}
      </PageHead>
      <ErrorNote message={banks.error} />
      {banks.loading && !banks.data ? <Spinner /> : (
        <DataTable search="Search banks…" rows={banks.data || []} onRow={(b) => setOpenId(b.id)} columns={[
          { key: "bank_name", label: "Bank" },
          { key: "p", label: "Plans", right: true, render: (b) => b.banking_schemes.filter((s) => s.is_active).length },
          { key: "c", label: "Pricing rows", right: true, render: (b) => b.banking_pricing.length },
          { key: "d", label: "Document list", render: listOf },
          { key: "r", label: "RMs", right: true, render: (b) => b.banking_relationship_managers.filter((m) => m.is_active).length },
          { key: "digital_application", label: "Digital", render: (b) => yesNo(b.digital_application) },
          { key: "appointment_required", label: "Appointment", render: (b) => yesNo(b.appointment_required) },
          { key: "is_active", label: "Status", render: (b) => <Badge>{b.is_active ? "Active" : "Inactive"}</Badge> },
        ]} />
      )}
      {adding && <FormModal wide title="Add bank" fields={BANK_FIELDS} initial={{ is_active: true, aliases: [] }} onClose={() => setAdding(false)} onSubmit={async (v) => { const b = await insertRow("banking_partners", v); await banks.reload(); setOpenId(b.id); }} />}
    </div>
  );
}

function BankWorkspace({ bank, onBack, reload }) {
  const [section, setSection] = useState("details");
  return (
    <div>
      <PageHead title={bank.bank_name} sub={NOT_POLICY}><Button onClick={onBack}>All banks</Button></PageHead>
      <div className="bk-tabs" role="tablist">
        {SECTIONS.map(([k, label]) => <button type="button" role="tab" aria-selected={section === k} key={k} className={section === k ? "active" : ""} onClick={() => setSection(k)}>{label}</button>)}
      </div>
      {section === "details" && <Details bank={bank} reload={reload} onRemoved={onBack} />}
      {section === "plans" && <BankSchemes bankId={bank.id} />}
      {section === "pricing" && <BankPricing bankId={bank.id} />}
      {section === "documents" && <DocumentChecklists bankId={bank.id} />}
      {section === "notes" && <Notes bank={bank} />}
    </div>
  );
}

function Details({ bank, reload, onRemoved }) {
  const { can } = useBanking();
  const rms = useLoad(() => run(table("banking_relationship_managers").select("*").eq("bank_id", bank.id).order("full_name")), [bank.id]);
  const [edit, setEdit] = useState(false);
  const [rm, setRm] = useState(null);
  const { error, busy, act } = useAction();
  const manage = can("masters.manage");
  return (
    <div>
      <Panel title="Bank details" actions={manage && <>
        <Button onClick={() => setEdit(true)}>Edit</Button>
        <Button busy={busy} onClick={() => { if (window.confirm(`Remove ${bank.bank_name}? If applications refer to it, it is deactivated instead.`)) act(async () => { const r = await rpc("banking_partner_remove", { p_bank: bank.id }); await reload(); if (r === "deleted") onRemoved(); }); }}>Remove</Button>
      </>}>
        <ErrorNote message={error} />
        <KeyVals items={[["Code", bank.bank_code], ["Website", bank.website], ["Contact person", bank.contact_person], ["Submission method", bank.submission_method], ["Appointment required", yesNo(bank.appointment_required)], ["Digital application", yesNo(bank.digital_application)], ["Processing time", bank.general_processing_time], ["Names in Excel", (bank.aliases || []).join(", ")], ["Remarks", bank.internal_remarks], ["Status", <Badge key="s">{bank.is_active ? "Active" : "Inactive"}</Badge>]]} />
      </Panel>
      <Panel title="Relationship managers" actions={manage && <Button variant="primary" onClick={() => setRm({ is_active: true })}>Add RM</Button>}>
        <ErrorNote message={rms.error} />
        <DataTable rows={rms.data || []} onRow={manage ? setRm : undefined} empty="No RM recorded." columns={[{ key: "full_name", label: "Name" }, { key: "email", label: "Email" }, { key: "mobile", label: "Mobile" }, { key: "branch", label: "Branch" }, { key: "is_active", label: "Status", render: (r) => <Badge>{r.is_active ? "Active" : "Inactive"}</Badge> }]} />
      </Panel>
      {edit && <FormModal wide title={`Edit ${bank.bank_name}`} fields={BANK_FIELDS} initial={bank} onClose={() => setEdit(false)} onSubmit={async (v) => { await updateRow("banking_partners", bank.id, v); await reload(); }} />}
      {rm && <FormModal title="Relationship manager" initial={rm} onClose={() => setRm(null)} fields={[{ name: "full_name", label: "Name", required: true }, { name: "email", label: "RM email" }, { name: "mobile", label: "RM mobile" }, { name: "branch", label: "Branch" }, { name: "remarks", label: "Remarks", type: "textarea", full: true }, { name: "is_active", label: "Active", type: "bool" }]} onSubmit={async (v) => { if (rm.id) await updateRow("banking_relationship_managers", rm.id, v); else await insertRow("banking_relationship_managers", { ...v, bank_id: bank.id }); await rms.reload(); await reload(); }} />}
    </div>
  );
}

function Notes({ bank }) {
  const { can } = useBanking();
  const notes = useLoad(() => run(table("banking_eligibility_notes").select("*").eq("bank_id", bank.id).order("created_at")), [bank.id]);
  const [edit, setEdit] = useState(null);
  const manage = can("masters.manage");
  return (
    <Panel title="Internal notes" sub="Shown as considerations on the plan page. They never reject a client." actions={manage && <Button variant="primary" onClick={() => setEdit({ note_type: "General", verification_status: "Unverified", is_active: true })}>Add note</Button>}>
      <ErrorNote message={notes.error} />
      <DataTable rows={notes.data || []} onRow={manage ? setEdit : undefined} empty="No notes." columns={[{ key: "note_type", label: "Type" }, { key: "note", label: "Note" }, { key: "verification_status", label: "Data", render: (r) => <Badge>{r.verification_status}</Badge> }, { key: "last_verified_date", label: "Last verified", render: (r) => fmtDate(r.last_verified_date) }, { key: "reviewer", label: "Reviewer" }]} />
      {edit && <FormModal wide title="Internal note" initial={edit} onClose={() => setEdit(null)} fields={[{ name: "note_type", label: "Type", type: "select", options: ["Nationality", "Activity", "Office", "General"], required: true }, { name: "match_values", label: "Relevant to (comma separated)", type: "list", full: true }, { name: "note", label: "Note", type: "textarea", full: true, required: true }, { name: "source", label: "Source" }, { name: "last_verified_date", label: "Last verified date", type: "date" }, { name: "reviewer", label: "Reviewer" }, { name: "verification_status", label: "Verification", type: "select", options: VERIFICATION, required: true }, { name: "is_active", label: "Active", type: "bool" }]}
        onSubmit={async (v) => { if (edit.id) await updateRow("banking_eligibility_notes", edit.id, v); else await insertRow("banking_eligibility_notes", { ...v, bank_id: bank.id }); await notes.reload(); }} />}
    </Panel>
  );
}
