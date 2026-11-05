// Engagement letter of a proposal: choose the option the client accepted, add the letter's missing details, then file the letter.
import { useState } from "react";
import { Button, ErrorNote, Modal } from "@banking/components/shared";
import { withLineVat } from "@business-setup/logic/quoteData";
import { createDocument, renderTemplate, saveFile } from "../services/hubApi";
import { createProposalLetter } from "../services/proposalApi";
import { fileNameFor, folderKind, letterData, mailDraft } from "../logic/serviceDocs";
import { optionTotal } from "../logic/proposalModel";

const plain = (n) => Number(n || 0).toLocaleString("en-AE", { maximumFractionDigits: 2 });

// Renders and files the letter, and keeps its mail draft beside it (the same steps as the old form).
export async function fileLetter(doc, { settings, catalogue, profile }, mailExists = false) {
  const company = settings?.company;
  const limitations = [...new Set((catalogue || []).filter((c) => c.service_items.some((x) => doc.services.includes(x.name))).map((c) => c.limitation).filter(Boolean))];
  const data = withLineVat(doc, letterData(doc, company, settings?.engagement_terms, limitations));
  const blob = await renderTemplate("Service_Engagement_Template.docx", data);
  const fileName = fileNameFor(doc.document_number, doc.client_name);
  const saved = await saveFile(doc, folderKind(doc.department, "letter"), blob, fileName);
  const { saveAs } = await import("file-saver");
  saveAs(blob, fileName);
  if (mailExists) return saved;
  const draft = mailDraft({ type: "letter", client: doc.client_name, contact: doc.contact_name, services: doc.services, number: doc.document_number, total: doc.total_amount, validUntil: doc.valid_until, sender: profile?.full_name, company: company?.short_name });
  await createDocument({ doc_type: "mail", parent_id: doc.id, department: doc.department, client_name: doc.client_name, contact_name: doc.contact_name, contact_email: doc.contact_email, services: doc.services, lines: doc.lines, vat_mode: doc.vat_mode, vat_rate: doc.vat_rate, mail_subject: draft.subject, mail_body: draft.body });
  return saved;
}

export default function ProposalLetterDialog({ quote, context, onClose, onDone }) {
  const options = quote.field_values?.proposal?.options || [];
  const [v, setV] = useState({ option: options.length === 1 ? "0" : "", phone: quote.contact_phone || "", address: quote.client_address || "", license: quote.license_number || "", trn: quote.vat_trn || "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [failed, setFailed] = useState(null); // Ref of a letter numbered but not filed: resubmitting is blocked
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (failed) return;
    if (v.option === "") return setError("Choose the option the client accepted.");
    setBusy(true); setError(null);
    let doc = null, fileErr = null, listErr = null;
    try {
      doc = await createProposalLetter({ quote_id: quote.id, option: Number(v.option), contact_phone: v.phone, client_address: v.address, license_number: v.license, vat_trn: v.trn });
      await fileLetter(doc, context);
    } catch (err) { if (doc) fileErr = err; else { setError(err.message); setBusy(false); return; } }
    if (fileErr) setFailed(doc.document_number);
    try { await onDone(fileErr ? null : `Engagement Letter ${doc.document_number} created from Option ${Number(v.option) + 1}.`); } catch (err) { listErr = err; }
    if (fileErr) setError(`Letter ${doc.document_number} was numbered but its file could not be made: ${fileErr.message} It keeps its Ref. Close this and use Retry letter file in the list.`);
    else if (listErr) setError(`Letter ${doc.document_number} was made, but the list could not be refreshed: ${listErr.message}`);
    setBusy(false);
  };

  return (
    <Modal title={`Engagement Letter for ${quote.document_number}`} onClose={onClose} wide>
      <form onSubmit={submit}>
        <ErrorNote message={error} onClose={() => setError(null)} />
        <fieldset className="bk-field bk-full">
          <legend>Option the client accepted <em>*</em></legend>
          {options.map((o, i) => (
            <label key={i} className="bk-check"><input type="radio" name="accepted" value={String(i)} checked={v.option === String(i)} onChange={set("option")} /> Option {i + 1}: {o.authority_name || o.authority_key}, AED {plain(optionTotal(o))}</label>
          ))}
        </fieldset>
        <p className="bk-note">The letter needs these details. Fill in any the proposal did not collect.</p>
        <div className="bk-grid">
          <div className="bk-field"><label htmlFor="l-phone">Phone</label><input id="l-phone" value={v.phone} onChange={set("phone")} /></div>
          <div className="bk-field"><label htmlFor="l-license">Licence number</label><input id="l-license" value={v.license} onChange={set("license")} /></div>
          <div className="bk-field"><label htmlFor="l-trn">VAT TRN</label><input id="l-trn" value={v.trn} onChange={set("trn")} /></div>
          <div className="bk-field bk-full"><label htmlFor="l-address">Address</label><input id="l-address" value={v.address} onChange={set("address")} /></div>
        </div>
        <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" busy={busy} disabled={!!failed}>Generate Engagement Letter + Mail</Button></div>
      </form>
    </Modal>
  );
}
