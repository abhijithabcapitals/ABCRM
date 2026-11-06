// Change referrer: a member of staff, a third party saved before, or Other with a name typed here. Admins only; the change and its reason are logged.
// A name typed under Other is saved by the server, so it is in the list next time.
import { useState } from "react";
import { Button, ErrorNote, FormGrid, Modal, useLoad } from "@banking/components/shared";
import { useSetup } from "../SetupContext";
import { caseSetReferrer, caseSetReferrerOther, otherReferrers } from "../../services/businessSetupApi";
import { OTHER, parseReferrer, referrerOptions, referrerValue } from "../../logic/referrer";

export default function ReferrerDialog({ c, onClose, onSaved }) {
  const { personOptions } = useSetup();
  const names = useLoad(otherReferrers, []);
  const [values, setValues] = useState({ to: referrerValue(c), name: "", reason: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const fields = [
    { name: "to", label: "Referred by", type: "select", options: referrerOptions(personOptions, names.data) },
    ...(values.to === OTHER ? [{ name: "name", label: "Referrer's name", required: true, full: true }] : []),
    { name: "reason", label: "Reason", type: "textarea", required: true, full: true },
  ];
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const pick = parseReferrer(values.to, values.name);
      if (pick.other) await caseSetReferrerOther(c.id, pick.other, values.reason);
      else await caseSetReferrer(c.id, pick.user, values.reason);
      await onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal title={`Referrer of ${c.case_number}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="bk-note">Admins only. The change and its reason are logged. Choose Other for someone outside the company: their name is kept for next time.</p>
        <ErrorNote message={error || names.error} />
        <FormGrid fields={fields} values={values} setValues={setValues} />
        <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>Save</Button></div>
      </form>
    </Modal>
  );
}
