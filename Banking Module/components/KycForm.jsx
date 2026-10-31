import { useEffect, useState } from "react";
import KycDocumentFill from "./KycDocumentFill";
import { Badge, Button, DataTable, ErrorNote, FormGrid, FormModal, Panel, Spinner, cleanValues, fmtDate, useBanking, useLoad } from "./shared";
import { insertRow, run, table, updateRow } from "../services/bankingApi";

const COMPANY = [
  ["legal_name", "Legal company name"], ["trade_name", "Trade name"], ["license_number", "Trade license number"],
  ["license_issue_date", "License issue date", "date"], ["license_expiry_date", "License expiry date", "date"], ["issuing_authority", "Issuing authority"],
  ["legal_structure", "Legal structure"], ["business_activity", "Business activity"], ["registered_address", "Registered address"],
  ["office_address", "Office address"], ["office_type", "Office type"], ["office_ejari_available", "Office Ejari available", "tri"],
  ["website", "Website"], ["company_email", "Company email"], ["company_phone", "Company contact number"], ["vat_trn", "VAT TRN"],
  ["annual_turnover", "Annual turnover (AED)", "number"], ["expected_monthly_transactions", "Expected monthly transactions"],
  ["countries_of_operation", "Countries of operation"], ["main_suppliers", "Main suppliers"], ["main_customers", "Main customers"],
  ["business_description", "Business description", "textarea"],
];
const BUSINESS = [
  ["nature_of_business", "Nature of business"], ["source_of_funds", "Source of funds"], ["expected_transaction_volume", "Expected transaction volume"],
  ["expected_monthly_turnover", "Expected monthly turnover (AED)", "number"], ["countries_of_transactions", "Countries of transactions"],
  ["cash_transaction_expectations", "Cash transaction expectations"], ["international_requirements", "International transaction requirements"],
  ["reason_for_account", "Reason for opening UAE bank account", "textarea"],
];
const FACTS = [
  ["is_free_zone", "Free zone company"], ["is_existing_company", "Existing company (has trading history)"], ["has_corporate_shareholder", "Has a corporate shareholder"],
  ["vat_registered", "VAT registered"], ["goaml_required", "GoAML registration applies"], ["imports_exports", "Imports / exports goods"], ["is_trading", "Trading activity"],
  ["has_physical_office", "Has a physical office"], ["is_freelance_or_trader_no_office", "Mainland trader / freelance licence with no office"],
  ["is_employed", "Applicant employed (personal account)"], ["is_self_employed", "Applicant self-employed (personal account)"],
].map(([name, label]) => ({ name, label, type: "tri" }));

const toFields = (list) => list.map(([name, label, type]) => ({ name, label, type: type || "text", full: type === "textarea" }));
const ALL = [...toFields(COMPANY), ...toFields(BUSINESS), ...FACTS];

// The fields the database counts toward 100% (banking_kyc_percent), which step 5 requires.
const NEEDED = ["legal_name", "license_number", "license_expiry_date", "issuing_authority", "legal_structure", "business_activity", "registered_address", "office_address", "company_email", "company_phone", "nature_of_business", "source_of_funds", "expected_monthly_turnover", "countries_of_transactions", "reason_for_account", "business_description"];
const mark = (fields) => fields.map((f) => (NEEDED.includes(f.name) ? { ...f, needed: true, label: `${f.label} *` } : f));
export const KYC_SECTIONS = [["Company information", mark(toFields(COMPANY))], ["Business information", mark(toFields(BUSINESS))], ["Checklist facts", FACTS]];
export const KYC_REQUIRED_FIELDS = ALL.filter((f) => NEEDED.includes(f.name));

const SH_FIELDS = [
  { name: "full_name", label: "Full name", required: true }, { name: "nationality", label: "Nationality" },
  { name: "ownership_percent", label: "Ownership %", type: "number" }, { name: "shareholder_type", label: "Shareholder type", type: "select", options: ["Individual", "Corporate"], required: true },
  { name: "passport_number", label: "Passport number" }, { name: "passport_expiry", label: "Passport expiry", type: "date" },
  { name: "emirates_id", label: "Emirates ID" }, { name: "visa_status", label: "Visa status" },
  { name: "residential_address", label: "Residential address" }, { name: "country_of_residence", label: "Country of residence" },
  { name: "mobile", label: "Mobile" }, { name: "email", label: "Email" }, { name: "is_ubo", label: "UBO", type: "bool" },
];

export default function KycForm({ clientId, onSaved }) {
  const { can } = useBanking();
  const profile = useLoad(() => run(table("banking_kyc_profiles").select("*").eq("client_id", clientId).maybeSingle()), [clientId]);
  const [values, setValues] = useState(null);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [filling, setFilling] = useState(false);
  const [partnersKey, setPartnersKey] = useState(0);
  const canEdit = can("kyc.manage");
  useEffect(() => { if (profile.data !== null) setValues(profile.data || {}); }, [profile.data]);

  const save = async () => {
    setBusy(true); setError(null); setSaved(null);
    try {
      const v = cleanValues(ALL, values);
      if (profile.data?.id) await updateRow("banking_kyc_profiles", profile.data.id, v);
      else await insertRow("banking_kyc_profiles", { ...v, client_id: clientId });
      await profile.reload();
      setSaved("Saved. Partial information is fine; come back to finish it.");
      onSaved?.();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  if (!values) return <Spinner />;
  return (
    <div>
      <ErrorNote message={profile.error || error} />
      {saved && <div className="bk-alert bk-alert-ok">{saved}</div>}
      <Panel title="Company information" sub={`Complete: ${profile.data?.completion_percent ?? 0}%. Reused across every bank application of this client.`}
        actions={canEdit && <><Button onClick={() => setFilling(true)}>Fill from documents</Button><Button variant="primary" busy={busy} onClick={save}>Save KYC</Button></>}>
        <fieldset disabled={!canEdit}><FormGrid fields={toFields(COMPANY)} values={values} setValues={setValues} /></fieldset>
      </Panel>
      <Shareholders key={partnersKey} profileId={profile.data?.id} />
      <Panel title="Business information"><fieldset disabled={!canEdit}><FormGrid fields={toFields(BUSINESS)} values={values} setValues={setValues} /></fieldset></Panel>
      <Panel title="Facts used by the document checklist" sub="Anything left 'Not known yet' appears on the checklist as To Confirm. After changing these, regenerate the checklist on the Documents tab.">
        <fieldset disabled={!canEdit}><FormGrid fields={FACTS} values={values} setValues={setValues} /></fieldset>
      </Panel>
      {canEdit && <Button variant="primary" busy={busy} onClick={save}>Save KYC</Button>}
      {filling && (
        <KycDocumentFill clientId={clientId} profileId={profile.data?.id} values={values} labels={Object.fromEntries(ALL.map((f) => [f.name, f.label]))} onClose={() => setFilling(false)}
          onApply={(filled) => { setValues((v) => ({ ...v, ...filled })); setPartnersKey((k) => k + 1); setSaved(`${Object.keys(filled).length} field(s) filled from documents. Check them, then press Save KYC.`); }} />
      )}
    </div>
  );
}

function Shareholders({ profileId }) {
  const { can } = useBanking();
  const list = useLoad(() => (profileId ? run(table("banking_kyc_shareholders").select("*").eq("kyc_profile_id", profileId).is("deleted_at", null).order("created_at")) : Promise.resolve([])), [profileId]);
  const [editing, setEditing] = useState(null);
  const total = (list.data || []).reduce((s, x) => s + Number(x.ownership_percent || 0), 0);
  if (!can("kyc.sensitive")) {
    return <Panel title="Shareholders / partners"><p className="bk-note">Passport, Emirates ID and shareholder details are restricted. Your role cannot view them.</p></Panel>;
  }
  return (
    <Panel title="Shareholders / partners" sub={list.data?.length ? `Ownership recorded: ${total}%` : null}
      actions={can("kyc.manage") && profileId && <Button onClick={() => setEditing({ shareholder_type: "Individual" })}>Add partner</Button>}>
      <ErrorNote message={list.error} />
      {!profileId && <p className="bk-note">Save the company information first.</p>}
      <DataTable rows={list.data || []} onRow={can("kyc.manage") ? setEditing : undefined} empty="No partners recorded." columns={[
        { key: "full_name", label: "Name" }, { key: "nationality", label: "Nationality" },
        { key: "ownership_percent", label: "%", render: (r) => r.ownership_percent ?? "–" },
        { key: "shareholder_type", label: "Type" }, { key: "is_ubo", label: "UBO", render: (r) => (r.is_ubo ? <Badge tone="good">UBO</Badge> : "–") },
        { key: "passport_expiry", label: "Passport expiry", render: (r) => fmtDate(r.passport_expiry) },
        { key: "country_of_residence", label: "Residence" },
      ]} />
      {editing && (
        <FormModal wide title={editing.id ? "Edit partner" : "Add partner"} fields={SH_FIELDS} initial={editing} onClose={() => setEditing(null)}
          onSubmit={async (v) => { if (editing.id) await updateRow("banking_kyc_shareholders", editing.id, v); else await insertRow("banking_kyc_shareholders", { ...v, kyc_profile_id: profileId }); await list.reload(); }} />
      )}
    </Panel>
  );
}
