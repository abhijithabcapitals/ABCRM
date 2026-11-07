// A lead's quotation and engagement letter, made with Template Hub's Service Desk generator (same Word template, numbering, file and
// mail draft as Template Hub), department Business Development (Database Module/migrations/bd/014).
//   QuoteDialog: client details and services -> Generate Quote + Mail -> send it from the mailbox -> Record as sent (and the portal login).
//   LeadQuotesPanel: where the quote stands. The client accepts in the portal, or staff upload the signed quote; then the engagement
//   letter is generated from the quote, as in Template Hub.
import { useState } from "react";
import { supabase } from "@app/supabase";
import { createDocument, loadCatalogue, loadHubSettings, openStored, renderTemplate, saveFile } from "@template-hub/services/hubApi";
import { deskDocumentBlob } from "@template-hub/logic/deskSigning";
import { fileNameFor, mailDraft, serviceTotals } from "@template-hub/logic/serviceDocs";
import { currentQuote, letterOf, mailOf, quoteClientFromLead, quoteLinesFromServices, quoteStage, signedCopyProblem } from "../logic/leadQuoteRules.js";

const DEPARTMENT = "Business Development";
const LABEL = { quote: "Quotation", letter: "Engagement Letter" };
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const aed = (n) => `AED ${Number(n || 0).toLocaleString("en-AE", { maximumFractionDigits: 2 })}`;
const fail = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const mailtoOf = (to, subject, body) => `mailto:${encodeURIComponent(to || "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

// The lead's quotes, letters and their mail drafts, and the client's decisions.
export async function loadLeadQuotes(leadId) {
  const [docs, decisions] = await Promise.all([
    supabase.from("hub_documents").select("*").eq("bd_lead_id", leadId).order("created_at", { ascending: false }),
    supabase.from("bd_quote_acceptances").select("*").eq("lead_id", leadId),
  ]);
  const quoteIds = fail(docs).map((d) => d.id);
  const mails = quoteIds.length ? fail(await supabase.from("hub_documents").select("*").eq("doc_type", "mail").in("parent_id", quoteIds)) : [];
  return { docs: [...fail(docs), ...mails], decisions: fail(decisions) };
}

// Files a numbered quote or letter exactly as Template Hub's Service Desk does: render the Word file, store it (and the office folder
// when the Client Module runs on this PC), download it, and keep the mail draft beside it.
async function fileDocument(doc, type, sender) {
  const [settings, catalogue] = await Promise.all([loadHubSettings(), type === "letter" ? loadCatalogue() : Promise.resolve([])]);
  const blob = await deskDocumentBlob({ ...doc, doc_type: type }, null, { render: renderTemplate, settings, catalogue });
  const name = fileNameFor(doc.document_number, doc.client_name);
  const saved = await saveFile(doc, `bd_${type}`, blob, name);
  const { saveAs } = await import("file-saver");
  saveAs(blob, name);
  const draft = mailDraft({ type, client: doc.client_name, contact: doc.contact_name, services: doc.services, number: doc.document_number, total: doc.total_amount, validUntil: doc.valid_until, sender, company: settings?.company?.short_name });
  await createDocument({ doc_type: "mail", parent_id: doc.id, department: doc.department, client_name: doc.client_name, contact_name: doc.contact_name, contact_email: doc.contact_email, services: doc.services, lines: doc.lines, vat_mode: doc.vat_mode, vat_rate: doc.vat_rate, mail_subject: draft.subject, mail_body: draft.body });
  return { doc: { ...doc, storage_path: saved.path }, mail: { subject: draft.subject, body: draft.body, to: doc.contact_email }, local: saved.local };
}

// The engagement letter of an accepted quote: the database copies everything from the quote and refuses one before acceptance.
export async function generateLetter(quote, sender) {
  const letter = await createDocument({ doc_type: "letter", parent_id: quote.id });
  return fileDocument(letter, "letter", sender);
}

// Gives the lead a Client Master record and a portal login, emailed to the lead (bd-quote-portal).
export async function issuePortalLogin(leadId) {
  const { data, error } = await supabase.functions.invoke("bd-quote-portal", { body: { action: "bd_issue_login", lead_id: leadId } });
  if (error) {
    let message = error.message;
    try { message = (await error.context.json()).error || message; } catch { /* keep the generic message */ }
    throw new Error(message);
  }
  return data;
}

function MailBox({ mail, onChange }) {
  return <>
    <label className="bd-form-wide">Subject<input value={mail.subject} onChange={(event) => onChange({ ...mail, subject: event.target.value })} /></label>
    <label className="bd-form-wide">Mail<textarea rows="9" value={mail.body} onChange={(event) => onChange({ ...mail, body: event.target.value })} /><small>Attach the downloaded Word file in your mail app.</small></label>
    <div className="bd-form-wide"><a className="bd-button bd-button-secondary" href={mailtoOf(mail.to, mail.subject, mail.body)} target="_blank" rel="noopener noreferrer">✉ Open in mail app</a></div>
  </>;
}

// Generate the quote (Template Hub), then record it as sent. A quote generated earlier but not yet recorded opens at the second step.
export function QuoteDialog({ lead, docs, sender, busy, onClose, onSubmit }) {
  // A quote made after the last "Record as sent" (or with none yet) is still to be sent.
  const pending = currentQuote(docs);
  const ready = pending && pending.status === "issued" && (!lead.quote_sent_at || new Date(pending.created_at) > new Date(lead.quote_sent_at)) ? pending : null;
  const draftOf = (doc) => { const m = mailOf(docs, doc); return m ? { subject: m.mail_subject, body: m.mail_body, to: doc.contact_email } : null; };
  const seed = quoteLinesFromServices(lead.bd_lead_services);
  const [form, setForm] = useState(() => ({ ...quoteClientFromLead(lead), vat_mode: "inclusive", valid_until: inDays(15), notes: "" }));
  const [lines, setLines] = useState(seed.lines);
  const [made, setMade] = useState(() => (ready ? { doc: ready, mail: draftOf(ready) || { subject: `Quotation ${ready.document_number}`, body: "", to: ready.contact_email } } : null));
  const [send, setSend] = useState(() => ({ sent_to: (ready?.contact_email) || lead.email || "", next_followup_at: toLocalInput(new Date(Date.now() + 3 * 86400000)), portal: true }));
  const [error, setError] = useState(seed.foreign.length ? `Template Hub quotes are in AED. Enter the AED fee for: ${seed.foreign.join(", ")}.` : "");
  const [working, setWorking] = useState(false);
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));
  const totals = serviceTotals(lines, form.vat_mode);

  async function generate(event) {
    event.preventDefault();
    const missing = [["client", "client name"], ["contact", "contact person"], ["email", "email"], ["phone", "phone"], ["address", "address"]].filter(([k]) => !String(form[k] || "").trim()).map(([, l]) => l);
    if (missing.length) return setError(`Fill in the client details first: ${missing.join(", ")}.`);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return setError("Enter a valid email.");
    if (!lines.length) return setError("Add a proposed fee to at least one service (Services & Budgets) first.");
    if (lines.some((l) => !(Number(l.amount) >= 0) || l.amount === "")) return setError("Enter the AED fee of every service.");
    setWorking(true); setError("");
    try {
      const doc = fail(await supabase.rpc("bd_quote_issue", { p_lead: lead.id, p: {
        client_name: form.client.trim(), contact_name: form.contact.trim(), contact_email: form.email.trim(), contact_phone: form.phone.trim(), client_address: form.address.trim(),
        license_number: form.license.trim() || null, vat_trn: form.trn.trim() || null, services: lines.map((l) => l.description),
        lines: lines.map((l) => ({ description: l.description, amount: Number(l.amount) })), vat_mode: form.vat_mode, vat_rate: 5, valid_until: form.valid_until || null, notes: form.notes.trim() || null,
      } }));
      const out = await fileDocument(doc, "quote", sender);
      setMade(out);
      setSend((s) => ({ ...s, sent_to: doc.contact_email || s.sent_to }));
    } catch (e) { setError(e.message); }
    setWorking(false);
  }

  async function record(event) {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(send.sent_to.trim())) return setError("Enter the email address the quote is sent to.");
    if (!send.next_followup_at) return setError("Set the date to follow up on the quote.");
    setError("");
    let portal = null;
    if (send.portal) {
      setWorking(true);
      try { portal = await issuePortalLogin(lead.id); } catch (e) { portal = { error: e.message }; }
      setWorking(false);
    }
    await onSubmit({
      quote_reference: made.doc.document_number, sent_to: send.sent_to.trim(), sent_at: new Date().toISOString(), next_followup_at: new Date(send.next_followup_at).toISOString(),
      summary: `Quotation ${made.doc.document_number} (${aed(made.doc.total_amount)}) sent to ${send.sent_to.trim()}. Services: ${(made.doc.services || []).join(", ")}.`,
    }, portal);
  }

  if (made) {
    return (
      <form className="bd-modal-scrim" onSubmit={record} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
        <div className="bd-modal">
          <div className="bd-modal-heading"><div><h2>Send quotation {made.doc.document_number}</h2><p>{made.local ? `Saved to ${made.local}. ` : ""}The Word file downloaded. Attach it to the mail, send it, then record it here. The engagement letter follows once the client accepts.</p></div><button type="button" className="bd-close" onClick={onClose} aria-label="Close">×</button></div>
          {error && <div className="bd-inline-error">{error}</div>}
          <div className="bd-form-grid">
            <label>Send to *<input type="email" value={send.sent_to} onChange={(event) => setSend({ ...send, sent_to: event.target.value })} required /></label>
            <label>Follow up on *<input type="datetime-local" value={send.next_followup_at} onChange={(event) => setSend({ ...send, next_followup_at: event.target.value })} required /></label>
            <MailBox mail={{ ...made.mail, to: send.sent_to }} onChange={(mail) => setMade({ ...made, mail })} />
            <label className="bd-form-wide bd-check-row"><input type="checkbox" checked={send.portal} onChange={(event) => setSend({ ...send, portal: event.target.checked })} /><span>Give the client a portal login (emailed to {lead.email || "the lead"}) so they can accept the quote online.</span></label>
            <div className="bd-form-wide"><button type="button" className="bd-text-button" onClick={() => openStored(made.doc.storage_path).catch((e) => setError(e.message))}>View {made.doc.document_number}</button></div>
          </div>
          <div className="bd-modal-actions"><button type="button" className="bd-button bd-button-secondary" onClick={onClose}>Later</button><button type="submit" className="bd-button bd-button-primary" disabled={busy || working}>{busy || working ? "Saving…" : "Record as sent"}</button></div>
        </div>
      </form>
    );
  }

  return (
    <form className="bd-modal-scrim" onSubmit={generate} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="bd-modal">
        <div className="bd-modal-heading"><div><h2>Generate quotation</h2><p>Made with Template Hub: same template, numbering and mail draft. The engagement letter comes after the client accepts.</p></div><button type="button" className="bd-close" onClick={onClose} aria-label="Close">×</button></div>
        {error && <div className="bd-inline-error">{error}</div>}
        <div className="bd-form-grid">
          <label>Client name *<input value={form.client} onChange={set("client")} required /></label>
          <label>Contact person *<input value={form.contact} onChange={set("contact")} required /></label>
          <label>Email *<input type="email" value={form.email} onChange={set("email")} required /></label>
          <label>Phone *<input value={form.phone} onChange={set("phone")} required /></label>
          <label>Licence number<input value={form.license} onChange={set("license")} /></label>
          <label>VAT TRN<input value={form.trn} onChange={set("trn")} /></label>
          <label className="bd-form-wide">Address *<input value={form.address} onChange={set("address")} required /></label>
          <div className="bd-form-wide">
            <small>Services and fees (AED), from Services & Budgets</small>
            {lines.length ? lines.map((l, i) => (
              <div key={l.description} className="bd-inline-actions">
                <span style={{ flex: 1 }}>{l.description}</span>
                <input aria-label={`Fee for ${l.description}`} type="number" min="0" step="any" value={l.amount} onChange={(event) => setLines((all) => all.map((x, k) => (k === i ? { ...x, amount: event.target.value } : x)))} />
                <button type="button" className="bd-text-button" onClick={() => setLines((all) => all.filter((_, k) => k !== i))}>Remove</button>
              </div>
            )) : <p>No service has a proposed fee yet.</p>}
          </div>
          <label>VAT treatment<select value={form.vat_mode} onChange={set("vat_mode")}><option value="inclusive">Fees include VAT</option><option value="exclusive">VAT added on top</option><option value="none">No VAT</option></select></label>
          <label>Valid until<input type="date" value={form.valid_until} onChange={set("valid_until")} /></label>
          <label className="bd-form-wide">Notes on the quotation<textarea rows="2" value={form.notes} onChange={set("notes")} /></label>
          {lines.length > 0 && <div className="bd-form-wide"><b>Total {aed(totals.total)}</b>{form.vat_mode !== "none" && <small> (VAT {aed(totals.vat)})</small>}</div>}
        </div>
        <div className="bd-modal-actions"><button type="button" className="bd-button bd-button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="bd-button bd-button-primary" disabled={working}>{working ? "Generating…" : "Generate Quote + Mail"}</button></div>
      </div>
    </form>
  );
}

function toLocalInput(date) {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

// Where the lead's quote stands, and the next step: the client's acceptance (portal or signed copy), then the engagement letter.
export function LeadQuotesPanel({ lead, data, sender, onChanged }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [mail, setMail] = useState(null);   // { title, subject, body, to } of a letter just made
  const docs = data?.docs || [];
  const quote = currentQuote(docs);
  if (!quote) return null;
  const letter = letterOf(docs, quote);
  const stage = quoteStage(quote, letter);
  const decision = (data?.decisions || []).find((d) => d.document_id === quote.id);
  const open = (path) => openStored(path).catch((e) => setError(e.message));

  const run = async (key, fn) => {
    setBusy(key); setError(""); setNote("");
    try { await fn(); } catch (e) { setError(e.message); }
    setBusy("");
    await onChanged();
  };
  const makeLetter = () => run("letter", async () => {
    const out = await generateLetter(quote, sender);
    setMail({ title: `Engagement letter ${out.doc.document_number}`, ...out.mail });
    setNote(`Engagement letter ${out.doc.document_number} generated and downloaded.`);
  });
  const uploadSigned = (file) => run("signed", async () => {
    const problem = signedCopyProblem(file);
    if (problem) throw new Error(problem);
    const path = `Business Development/signed/${lead.id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.\- ]+/g, "_").slice(-100)}`;
    fail(await supabase.storage.from("hub-documents").upload(path, file, { contentType: file.type || undefined }));
    fail(await supabase.rpc("bd_quote_accept_signed", { p_doc: quote.id, p: { signed_path: path, file_name: file.name } }));
    // Accepted: the engagement letter follows at once, as in Template Hub.
    const out = await generateLetter({ ...quote, status: "accepted" }, sender);
    setMail({ title: `Engagement letter ${out.doc.document_number}`, ...out.mail });
    setNote(`Quote ${quote.document_number} accepted from the signed copy. Engagement letter ${out.doc.document_number} generated and downloaded.`);
  });
  const portal = () => run("portal", async () => {
    const r = await issuePortalLogin(lead.id);
    setNote(r.emailed ? `Portal login ${r.username} emailed to the client.` : `Portal login ${r.username || ""} is ready, but the mail was not sent. Check the client's email.`);
  });
  const letterMail = mailOf(docs, letter);

  return (
    <div className="bd-workflow-block">
      {error && <div className="bd-inline-error">{error}</div>}
      {note && <div className="bd-alert bd-alert-success" role="status">{note}</div>}
      <div>
        <small>Quotation (Template Hub)</small>
        <b>{quote.document_number} · {aed(quote.total_amount)}</b>
        <span>
          {stage === "waiting" && "Waiting for the client: they accept in the client portal, or upload the signed quote here."}
          {stage === "letter" && `Accepted${decision ? ` (${decision.source === "Portal" ? `in the portal by ${decision.username}` : "signed copy"}, ${new Date(decision.created_at).toLocaleDateString("en-GB")})` : ""}. Generate the engagement letter.`}
          {stage === "done" && "Accepted. Engagement letter generated."}
          {stage === "rejected" && `Declined by the client${decision?.note ? `: ${decision.note}` : ""}. Make a new quote with Send quote.`}
          {" "}{quote.storage_path && <button type="button" className="bd-text-button" onClick={() => open(quote.storage_path)}>View quote</button>}
          {decision?.signed_path && <> · <button type="button" className="bd-text-button" onClick={() => open(decision.signed_path)}>Signed copy</button></>}
        </span>
      </div>
      {letter && <div><small>Engagement letter</small><b>{letter.document_number}</b><span>{letter.storage_path ? <button type="button" className="bd-text-button" onClick={() => open(letter.storage_path)}>View letter</button> : "No file"}{letterMail && <> · <button type="button" className="bd-text-button" onClick={() => setMail({ title: `Engagement letter ${letter.document_number}`, subject: letterMail.mail_subject, body: letterMail.mail_body, to: letter.contact_email })}>Mail draft</button></>}</span></div>}
      {lead.status === "active" && (
        <div className="bd-inline-actions">
          {stage === "waiting" && <label className="bd-button bd-button-secondary">{busy === "signed" ? "Uploading…" : "Upload signed quote"}<input type="file" accept=".pdf,.png,.jpg,.jpeg" hidden disabled={!!busy} onChange={(event) => { const f = event.target.files?.[0]; event.target.value = ""; if (f) uploadSigned(f); }} /></label>}
          {stage === "letter" && <button type="button" className="bd-button bd-button-primary" disabled={!!busy} onClick={makeLetter}>{busy === "letter" ? "Generating…" : "Generate Engagement Letter + Mail"}</button>}
          {(stage === "waiting" || stage === "letter") && lead.email && <button type="button" className="bd-button bd-button-secondary" disabled={!!busy} onClick={portal}>{busy === "portal" ? "Sending…" : "Send portal login"}</button>}
        </div>
      )}
      {mail && (
        <div className="bd-form-grid">
          <div className="bd-form-wide"><b>{mail.title}</b> · to {mail.to || "no email"}</div>
          <MailBox mail={mail} onChange={setMail} />
          <div className="bd-form-wide"><button type="button" className="bd-text-button" onClick={() => setMail(null)}>Close mail</button></div>
        </div>
      )}
    </div>
  );
}
