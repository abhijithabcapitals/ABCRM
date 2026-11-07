// Staff complete a client's form while it is In review: the plain answers, the client's ID details, and every shareholder with their share.
import { useState } from "react";
import { Button, ErrorNote, FormGrid, Modal } from "@banking/components/shared";
import { DATE_FIELDS, FIELDS, ID_FIELDS, SERVICES_FIELD, changedAnswers, formValues, newPartner, partnerProblem, shareTotal } from "../../logic/staffForm";

const field = ([name, label]) => (name === "company_status" ? { name, label, type: "select", options: ["New", "Existing"] }
  : DATE_FIELDS.has(name) ? { name, label, type: "date" }
  : name === "address" ? { name, label, type: "textarea", full: true, rows: 2 }
  : { name, label });

const ANSWER_FIELDS = [...FIELDS.map(field), { name: SERVICES_FIELD, label: "Services wanted (separate with commas)", full: true }];
const ID_FORM_FIELDS = ID_FIELDS.map(field);

export default function CompleteAnswers({ answers, onSave, onClose }) {
  const [values, setValues] = useState(() => formValues(answers));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const partners = values.partners;
  const setPartner = (i, key, v) => setValues((s) => ({ ...s, partners: s.partners.map((p, j) => (j === i ? { ...p, [key]: v } : p)) }));
  const addPartner = () => setValues((s) => ({ ...s, partners: [...s.partners, newPartner()] }));
  const removePartner = (i) => setValues((s) => ({ ...s, partners: s.partners.length > 1 ? s.partners.filter((_, j) => j !== i) : [newPartner()] }));
  const total = shareTotal(partners);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    const problem = partnerProblem(partners);
    if (problem) { setError(problem); return; }
    const changed = changedAnswers(values, answers);
    if (!Object.keys(changed).length) { setError("Nothing was changed"); return; }
    setBusy(true);
    try { await onSave(changed); onClose(); } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <Modal title="Complete the client's answers" onClose={onClose} wide>
      <form onSubmit={submit}>
        <p className="bk-note">Only the fields you change are saved. The old values stay in the audit trail.</p>
        <ErrorNote message={error} />
        <h4>Answers</h4>
        <FormGrid fields={ANSWER_FIELDS} values={values} setValues={setValues} />
        <h4>Emirates ID and other details</h4>
        <FormGrid fields={ID_FORM_FIELDS} values={values} setValues={setValues} />
        <h4>Shareholders <small>Total share: {total}%{total !== 100 && total > 0 ? " (not 100%)" : ""}</small></h4>
        <div className="bk-table-wrap"><table className="bk-table">
          <thead><tr><th>Name</th><th>Nationality</th><th>Share %</th><th>UBO</th><th>Emirates ID</th><th>Passport number</th><th /></tr></thead>
          <tbody>
            {partners.map((p, i) => (
              <tr key={i}>
                <td><input aria-label={`Shareholder ${i + 1} name`} value={p.name} onChange={(e) => setPartner(i, "name", e.target.value)} /></td>
                <td><input aria-label={`Shareholder ${i + 1} nationality`} value={p.nationality} onChange={(e) => setPartner(i, "nationality", e.target.value)} /></td>
                <td><input aria-label={`Shareholder ${i + 1} share percent`} type="number" min="0" max="100" step="any" style={{ width: "6em" }} value={p.share} onChange={(e) => setPartner(i, "share", e.target.value)} /></td>
                <td><input aria-label={`Shareholder ${i + 1} is ultimate beneficial owner`} type="checkbox" checked={!!p.ubo} onChange={(e) => setPartner(i, "ubo", e.target.checked)} /></td>
                <td><input aria-label={`Shareholder ${i + 1} Emirates ID`} value={p.emirates_id} onChange={(e) => setPartner(i, "emirates_id", e.target.value)} /></td>
                <td><input aria-label={`Shareholder ${i + 1} passport number`} value={p.passport_number} onChange={(e) => setPartner(i, "passport_number", e.target.value)} /></td>
                <td><Button onClick={() => removePartner(i)}>Remove</Button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <p><Button onClick={addPartner}>Add shareholder</Button></p>
        <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>Save answers</Button></div>
      </form>
    </Modal>
  );
}
