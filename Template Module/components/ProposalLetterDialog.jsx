// A proposal's client choice and engagement letter. The choice is recorded while the proposal is issued; the letter is made once it is accepted
// (signed copy in the workspace or the client portal) and takes the recorded option.
import { useState } from "react";
import { Button, ErrorNote, Modal } from "@banking/components/shared";
import { withLineVat } from "@business-setup/logic/quoteData";
import { createDocument, renderTemplate, saveFile } from "../services/hubApi";
import { chooseProposalOption, createProposalLetter } from "../services/proposalApi";
import { fileNameFor, folderKind, letterData, mailDraft } from "../logic/serviceDocs";
import { chosenOption, optionTotal } from "../logic/proposalModel";

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

// Records the option the client chose on an issued proposal. The quote then carries that option until the client accepts.
export function ProposalChoiceDialog({ quote, onClose, onDone }) {
  const options = quote.field_values?.proposal?.options || [];
  const current = quote.field_values?.proposal?.accepted_option;
  const [option, setOption] = useState(current === null || current === undefined ? "" : String(current));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    if (option === "") return setError("Choose the option the client accepted.");
    setBusy(true); setError(null);
    try {
      await chooseProposalOption(quote.id, Number(option));
      await onDone(`Option ${Number(option) + 1} recorded as the client's choice on ${quote.document_number}.`);
    } catch (err) { setError(err.message); }
    setBusy(false);
  };
  return (
    <Modal title={`Record client's choice for ${quote.document_number}`} onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorNote message={error} onClose={() => setError(null)} />
        <fieldset className="bk-field bk-full">
          <legend>Option the client chose <em>*</em></legend>
          {options.map((o, i) => (
            <label key={i} className="bk-check"><input type="radio" name="chosen" value={String(i)} checked={option === String(i)} onChange={(e) => setOption(e.target.value)} /> Option {i + 1}: {o.authority_name || o.authority_key}, AED {plain(optionTotal(o))}</label>
          ))}
        </fieldset>
        <p className="bk-note">The proposal stays issued and the choice can change until it is accepted. To accept it, confirm the client&apos;s signed copy in the client&apos;s workspace (Quotes &amp; Agreements), or the client accepts it in the portal.</p>
        <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>Record choice</Button></div>
      </form>
    </Modal>
  );
}

// The engagement letter of an accepted proposal: the option is the one recorded on the quote; the dialog only adds the letter's missing details.
export default function ProposalLetterDialog({ quote, context, onClose, onDone }) {
  const options = quote.field_values?.proposal?.options || [];
  const k = chosenOption(quote);
  const chosen = k === null ? null : options[k];
  const [v, setV] = useState({ phone: quote.contact_phone || "", address: quote.client_address || "", license: quote.license_number || "", trn: quote.vat_trn || "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [failed, setFailed] = useState(null); // Ref of a letter numbered but not filed: resubmitting is blocked
  const set = (key) => (e) => setV((x) => ({ ...x, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (failed) return;
    setBusy(true); setError(null);
    let doc = null, fileErr = null, listErr = null;
    try {
      doc = await createProposalLetter({ quote_id: quote.id, contact_phone: v.phone, client_address: v.address, license_number: v.license, vat_trn: v.trn });
      await fileLetter(doc, context);
    } catch (err) { if (doc) fileErr = err; else { setError(err.message); setBusy(false); return; } }
    if (fileErr) setFailed(doc.document_number);
    try { await onDone(fileErr ? null : `Engagement Letter ${doc.document_number} created from Option ${Number(doc.field_values?.accepted_option ?? k) + 1}.`); } catch (err) { listErr = err; }
    if (fileErr) setError(`Letter ${doc.document_number} was numbered but its file could not be made: ${fileErr.message} It keeps its Ref. Close this and use Retry letter file in the list.`);
    else if (listErr) setError(`Letter ${doc.document_number} was made, but the list could not be refreshed: ${listErr.message}`);
    setBusy(false);
  };

  return (
    <Modal title={`Engagement Letter for ${quote.document_number}`} onClose={onClose} wide>
      <form onSubmit={submit}>
        <ErrorNote message={error} onClose={() => setError(null)} />
        <p className="bk-note">{chosen ? <>Accepted: Option {k + 1}, {chosen.authority_name || chosen.authority_key}, AED {plain(optionTotal(chosen))}.</> : "No option is recorded on this proposal."}</p>
        <p className="bk-note">The letter needs these details. Fill in any the proposal did not collect.</p>
        <div className="bk-grid">
          <div className="bk-field"><label htmlFor="l-phone">Phone</label><input id="l-phone" value={v.phone} onChange={set("phone")} /></div>
          <div className="bk-field"><label htmlFor="l-license">Licence number</label><input id="l-license" value={v.license} onChange={set("license")} /></div>
          <div className="bk-field"><label htmlFor="l-trn">VAT TRN</label><input id="l-trn" value={v.trn} onChange={set("trn")} /></div>
          <div className="bk-field bk-full"><label htmlFor="l-address">Address</label><input id="l-address" value={v.address} onChange={set("address")} /></div>
        </div>
        <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" busy={busy} disabled={!!failed || !chosen}>Generate Engagement Letter + Mail</Button></div>
      </form>
    </Modal>
  );
}
