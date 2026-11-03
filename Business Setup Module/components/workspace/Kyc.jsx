// Company and partner details. Reading a document fills the form for a person to check; nothing saves without them.
import { useState } from "react";
import { Button, DataTable, ErrorNote, FilePick, FormGrid, FormModal, Panel, fmtDate, useAction } from "@banking/components/shared";
import { readDocuments } from "@banking/services/bankingApi";
import { buildAutofill } from "@banking/logic/kycAutofill";
import { useSetup } from "../SetupContext";
import { deletePartner, saveKyc, savePartner } from "../../services/businessSetupApi";

const FIELDS = [
  { name: "company_status", label: "Company status", type: "select", options: ["New", "Existing"], required: true },
  { name: "business_activity", label: "Business activity", required: true }, { name: "jurisdiction", label: "Jurisdiction" },
  { name: "licence_number", label: "Licence number" }, { name: "licence_expiry", label: "Licence expiry", type: "date" }, { name: "issuing_authority", label: "Issuing authority" },
];
const PARTNER = [
  { name: "full_name", label: "Name", required: true }, { name: "nationality", label: "Nationality", required: true }, { name: "share_percent", label: "Share %", type: "number" }, { name: "is_ubo", label: "Ultimate beneficial owner", type: "bool" },
];
const SENSITIVE = [{ name: "passport_number", label: "Passport number" }, { name: "passport_expiry", label: "Passport expiry", type: "date" }, { name: "emirates_id", label: "Emirates ID" }];

export default function Kyc({ w, clientId, reload }) {
  const { can } = useSetup();
  const manage = can("setup.kyc.manage");
  const sensitive = can("setup.kyc.sensitive");
  const [values, setValues] = useState({ ...w.kyc, issuing_authority: w.kyc?.details?.issuing_authority || "" });
  const [partner, setPartner] = useState(null);
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState(null);
  const { error, setError, busy, act } = useAction(reload);
  const read = async (file) => {
    setReading(true); setError(null); setNote(null);
    try {
      const f = buildAutofill(await readDocuments([file])).values;
      setValues((v) => ({ ...v, business_activity: v.business_activity || f.business_activity || "", licence_number: v.licence_number || f.license_number || "",
        licence_expiry: v.licence_expiry || f.license_expiry_date || "", issuing_authority: v.issuing_authority || f.issuing_authority || "" }));
      setNote("Read. Please check the filled values, then save.");
    } catch (e) { setError(e.message); }
    setReading(false);
  };
  const save = () => act(() => saveKyc(clientId, { company_status: values.company_status, business_activity: values.business_activity, jurisdiction: values.jurisdiction,
    licence_number: values.licence_number, licence_expiry: values.licence_expiry, details: { issuing_authority: values.issuing_authority } }));
  return (
    <div>
      <ErrorNote message={error} onClose={() => setError(null)} />
      {note && <div className="bk-alert bk-alert-ok">{note}</div>}
      <Panel title="Company" sub={w.kyc_status?.missing?.length ? `Still missing: ${w.kyc_status.missing.join(", ")}` : "KYC details are complete."}
        actions={manage && <FilePick label="Fill from documents" busy={reading} onFile={read} accept=".pdf,.png,.jpg,.jpeg" />}>
        <FormGrid fields={FIELDS} values={values} setValues={setValues} />
        {manage && <div className="bk-modal-actions"><Button variant="primary" busy={busy} onClick={save}>Save</Button></div>}
      </Panel>
      <Panel title="Partners" actions={manage && <Button onClick={() => setPartner({})}>+ Partner</Button>}>
        <DataTable rows={w.partners} empty="No partners yet." onRow={manage ? (p) => setPartner(p) : undefined} columns={[
          { key: "full_name", label: "Name" }, { key: "nationality", label: "Nationality" }, { key: "share_percent", label: "Share %", right: true }, { key: "is_ubo", label: "UBO", render: (p) => (p.is_ubo ? "Yes" : "") },
          ...(sensitive ? [{ key: "passport_number", label: "Passport" }, { key: "passport_expiry", label: "Passport expiry", render: (p) => fmtDate(p.passport_expiry) }, { key: "emirates_id", label: "Emirates ID" }] : []),
        ]} />
      </Panel>
      {partner && <FormModal title={partner.id ? "Edit partner" : "Add partner"} fields={sensitive ? [...PARTNER, ...SENSITIVE] : PARTNER} initial={partner} onClose={() => setPartner(null)}
        onSubmit={async (v) => { await savePartner(clientId, { ...v, id: partner.id }); await reload(); }}
        note={partner.id ? <button type="button" className="bk-link" onClick={async () => { await deletePartner(partner.id); setPartner(null); await reload(); }}>Remove this partner</button> : null} />}
    </div>
  );
}
