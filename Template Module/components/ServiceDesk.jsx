// Client details, then services and fees, then a quotation; its engagement letter is the next step. Each keeps a mail draft.
// Used by Template Hub (every department) and by each department's own tab (only its services).
import { useEffect, useMemo, useRef, useState } from "react";
import "@banking/components/banking.css";
import { Badge, Button, DataTable, ErrorNote, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { listFees } from "@business-setup/services/businessSetupApi";
import { createDocument, listDocuments, loadCatalogue, loadHubSettings, openInFolder, openStored, renderTemplate, saveFile, updateMail } from "../services/hubApi";
import ClientPicker from "@banking/components/ClientPicker";
import { ClientLists, listIdFor, useClientLookup } from "@banking/components/ClientLookup";
import { applyClient, pickClient } from "@banking/logic/clientLookup";
import { flagMissing } from "@banking/components/Attention";
import { withLineVat } from "@business-setup/logic/quoteData";
import AccountingDesk from "./AccountingDesk";
import { addLine, checkReady, oldDeskRows, showAccountingDesk, showViewSwitch, feeItemFor, DEPARTMENTS, deskTotals, deskVatMode, fileNameFor, fixedVat, folderKind, letterData, mailDraft, quoteData } from "../logic/serviceDocs";

const LABEL = { quote: "Quotation", letter: "Engagement Letter", mail: "Mail" };
const MailIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>;
const CLIENT_MAP = { client: "name", contact: "contact", email: "email", phone: "phone", address: "address", license: "license", trn: "trn" };
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// initial: form values to start from, plus service (the first line's service). onDocument(doc): called once a quote or letter is filed.
export default function ServiceDesk({ department, profile, initial, onDocument }) {
  const catalogue = useLoad(loadCatalogue, []);
  const fees = useLoad(() => listFees(), []);
  const settings = useLoad(loadHubSettings, []);
  const clients = useClientLookup();
  const [dept, setDept] = useState(department || DEPARTMENTS[0]);
  const [lines, setLines] = useState([]);
  const { service: initialService, ...initialForm } = initial || {};
  const [service, setService] = useState(initialService || "");
  const [fee, setFee] = useState("");
  const [form, setForm] = useState({ client: "", contact: "", email: "", phone: "", address: "", license: "", trn: "", vat_mode: "inclusive", valid_until: inDays(15), notes: "", ...initialForm });
  const [last, setLast] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [mail, setMail] = useState(null);
  const [view, setView] = useState("quote"); // Accounting only: the new Quote or the Old Quotation form
  const docs = useLoad(async () => oldDeskRows(await listDocuments(department || null)), [department]);
  const mailPanel = useRef(null);
  useEffect(() => { if (mail) mailPanel.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }); }, [mail?.id]);

  const mailOf = (d) => (docs.data || []).find((x) => x.doc_type === "mail" && x.parent_id === d.id);
  // The draft stays with its document and opens from the document's mail icon.
  const openMail = (d) => {
    const m = mailOf(d);
    if (m) setMail({ id: m.id, subject: m.mail_subject, body: m.mail_body, number: d.document_number, label: LABEL[d.doc_type], email: d.contact_email });
  };
  const mailButton = (d) => (mailOf(d) ? <button type="button" className={`bk-mail-icon${mail?.id === mailOf(d).id ? " active" : ""}`} title={`Draft mail for ${d.document_number}`} aria-label={`Open draft mail for ${d.document_number}`} onClick={() => openMail(d)}><MailIcon /></button> : null);

  const categories = useMemo(() => (catalogue.data || []).filter((c) => c.department === dept), [catalogue.data, dept]);
  const totals = deskTotals(dept, lines, form.vat_mode);
  // Choosing or typing a detail of a known client fills the rest; everything stays editable.
  const set = (k) => (e) => { const v = e.target.value; setForm((f) => (CLIENT_MAP[k] ? applyClient(f, CLIENT_MAP, k, v, clients) : { ...f, [k]: v })); };
  const chooseDept = (d) => { setDept(d); setLines([]); setService(""); setFee(""); setMail(null); };
  const add = () => {
    const svc = categories.flatMap((c) => c.service_items).find((s) => s.name === service);
    // A Business Setup line needs its fee item's VAT rate, so adding waits for the fee list.
    if (dept === "Business Setup" && !fees.data) { setError(fees.error || "The fee list is still loading."); return; }
    const m = dept === "Business Setup" && svc ? feeItemFor(fees.data, svc.id) : { item: null };
    if (m.error) { setError(m.error); return; }
    const r = addLine(lines, service, fee, m.item);
    if (r.error) { setError(r.error); flagMissing([/fee/.test(r.error) ? "d-fee" : "d-service"]); return; }
    setError(null); setLines(r.lines); setService(""); setFee("");
  };

  const payload = (doc_type, extra = {}) => ({ doc_type, department: dept, client_name: form.client, contact_name: form.contact || null, contact_email: form.email || null, contact_phone: form.phone || null, client_address: form.address || null, license_number: form.license || null, vat_trn: form.trn || null, services: lines.map((l) => l.description), lines, vat_mode: deskVatMode(dept, form.vat_mode), vat_rate: 5, valid_until: form.valid_until || null, notes: form.notes || null, ...extra });

  // Files a generated document and keeps its mail draft beside it.
  const finish = async (doc, type) => {
    const company = settings.data?.company;
    const limitations = [...new Set((catalogue.data || []).filter((c) => c.service_items.some((x) => doc.services.includes(x.name))).map((c) => c.limitation).filter(Boolean))];
    const base = type === "quote" ? quoteData(doc, company, settings.data?.engagement_terms) : letterData(doc, company, settings.data?.engagement_terms, limitations);
    const data = doc.department === "Business Setup" ? withLineVat(doc, base) : base;
    const blob = await renderTemplate(type === "quote" ? "Service_Quotation_Template.docx" : "Service_Engagement_Template.docx", data);
    const fileName = fileNameFor(doc.document_number, doc.client_name);
    const saved = await saveFile(doc, folderKind(doc.department, type), blob, fileName);
    const { saveAs } = await import("file-saver");
    saveAs(blob, fileName);
    setNote({ ok: true, text: `${LABEL[type]} ${doc.document_number} created. ${saved.local ? `Saved to ${saved.local}` : "Saved online."}` });
    // The mail carries the document's reference number and is stored beside it.
    const draft = mailDraft({ type, client: doc.client_name, contact: doc.contact_name, services: doc.services, number: doc.document_number, total: doc.total_amount, validUntil: doc.valid_until, sender: profile?.full_name, company: company?.short_name });
    if (!mailOf(doc)) await createDocument({ doc_type: "mail", parent_id: doc.id, department: doc.department, client_name: doc.client_name, contact_name: doc.contact_name, contact_email: doc.contact_email, services: doc.services, lines: doc.lines, vat_mode: doc.vat_mode, vat_rate: doc.vat_rate, mail_subject: draft.subject, mail_body: draft.body });
    await docs.reload();
    setLast(doc);
    onDocument?.(doc);
  };

  const generateQuote = async () => {
    const bad = checkReady(form, lines);
    if (bad) {
      setError(bad);
      const empty = Object.keys(CLIENT_MAP).filter((k) => !["license", "trn"].includes(k) && !String(form[k] || "").trim()).map((k) => `d-${k}`);
      flagMissing(empty.length ? empty : /email/.test(bad) ? ["d-email"] : ["d-service", "d-fee"]);
      return;
    }
    setBusy("quote"); setError(null); setNote(null);
    try {
      const doc = await createDocument(payload("quote"));
      setMail(null);
      await finish(doc, "quote");
    } catch (e) { setError(e.message); }
    setBusy(null);
  };

  // The next step of a quote: the database copies everything from it.
  const generateLetter = async (q) => {
    setBusy(`letter-${q.id}`); setError(null); setNote(null);
    try {
      const doc = await createDocument({ doc_type: "letter", parent_id: q.id });
      setMail(null);
      await finish(doc, "letter");
    } catch (e) { setError(e.message); }
    setBusy(null);
  };

  const saveDraft = async () => {
    setBusy("mail"); setError(null);
    try { await updateMail(mail.id, mail.subject, mail.body); await docs.reload(); setNote({ ok: true, text: "Mail changes saved." }); } catch (e) { setError(e.message); }
    setBusy(null);
  };
  // A document whose file failed to save can be filed again under the same number.
  const refile = async (d) => {
    if (d.library_template) return setError("This document came from Template Hub. Use Retry there.");
    setBusy(`file-${d.id}`); setError(null);
    try { await finish(d, d.doc_type); } catch (e) { setError(e.message); }
    setBusy(null);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${mail.subject}\n\n${mail.body}`); setNote({ ok: true, text: "Copied." }); } catch { setError("Could not copy here. Select the text and copy it."); }
  };
  const mailto = mail ? `mailto:${encodeURIComponent(mail.email || form.email)}?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.body)}` : "#";

  const deptTabs = !department && <div className="bk-tabs" role="tablist" aria-label="Department">{DEPARTMENTS.map((d) => <button type="button" role="tab" aria-selected={dept === d} key={d} className={dept === d ? "active" : ""} onClick={() => chooseDept(d)}>{d}</button>)}</div>;
  // The switch is for Accounting only, and not inside a job, which passes onDocument and keeps the old form.
  const viewTabs = showViewSwitch({ department: dept, onDocument }) && <div className="bk-tabs" role="tablist" aria-label="Quotation format">{[["quote", "Quote"], ["old", "Old Quotation"]].map(([k, l]) => <button type="button" role="tab" aria-selected={view === k} key={k} className={view === k ? "active" : ""} onClick={() => setView(k)}>{l}</button>)}</div>;
  if (showAccountingDesk({ department: dept, onDocument, mode: view })) return <div>{deptTabs}{viewTabs}<AccountingDesk profile={profile} /></div>;
  if (catalogue.loading && !catalogue.data) return <Spinner />;
  return (
    <div>
      <ErrorNote message={catalogue.error || settings.error || (dept === "Business Setup" && fees.error ? `The fee list could not be loaded, so VAT rates are unknown: ${fees.error}` : null) || error} onClose={error ? () => setError(null) : undefined} />
      {note && <div className={`bk-alert ${note.ok ? "bk-alert-ok" : "bk-alert-warn"}`}>{note.text}</div>}
      {deptTabs}
      {viewTabs}
      <Panel title="1. Client details" sub="Choose any detail of an existing client to fill in the rest, or type them for a new one.">
        <div className="bk-grid">
          <div className="bk-field"><label htmlFor="d-client">Client name <em>*</em></label><ClientPicker id="d-client" value={form.client} clients={clients} onChange={(v, picked) => setForm((f) => (picked ? pickClient(f, CLIENT_MAP, "client", picked, clients) : applyClient(f, CLIENT_MAP, "client", v, clients)))} /><ClientLists clients={clients} keys={["email", "phone", "license", "trn"]} /></div>
          <div className="bk-field"><label htmlFor="d-contact">Contact person <em>*</em></label><input id="d-contact" value={form.contact} onChange={set("contact")} /></div>
          <div className="bk-field"><label htmlFor="d-email">Email <em>*</em></label><input id="d-email" type="email" list={listIdFor("email")} value={form.email} onChange={set("email")} /></div>
          <div className="bk-field"><label htmlFor="d-phone">Phone <em>*</em></label><input id="d-phone" list={listIdFor("phone")} value={form.phone} onChange={set("phone")} /></div>
          <div className="bk-field"><label htmlFor="d-license">Licence number</label><input id="d-license" list={listIdFor("license")} value={form.license} onChange={set("license")} /></div>
          <div className="bk-field"><label htmlFor="d-trn">VAT TRN</label><input id="d-trn" list={listIdFor("trn")} value={form.trn} onChange={set("trn")} /></div>
          <div className="bk-field bk-full"><label htmlFor="d-address">Address <em>*</em></label><input id="d-address" value={form.address} onChange={set("address")} /></div>
        </div>
      </Panel>
      <Panel title="2. Services and fees" sub={`${dept}: add each service with the fee offered.`}>
        <div className="bk-add-line">
          <div className="bk-field"><label htmlFor="d-service">Service offered</label>
            <select id="d-service" value={service} onChange={(e) => setService(e.target.value)}>
              <option value="">Select a service…</option>
              {categories.map((c) => <optgroup key={c.id} label={c.name}>{c.service_items.filter((s) => !lines.some((l) => l.description === s.name)).map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}</optgroup>)}
            </select>
          </div>
          <div className="bk-field"><label htmlFor="d-fee">Fee offered (AED)</label><input id="d-fee" type="number" min="0" step="any" value={fee} onChange={(e) => setFee(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} /></div>
          <Button variant="primary" disabled={dept === "Business Setup" && !fees.data} onClick={add}>+ Add service</Button>
        </div>
        {lines.length > 0 && (
          <div className="bk-table-wrap bk-mt">
            <table className="bk-table">
              <thead><tr><th>#</th><th>Service</th><th className="bk-right">Fee (AED)</th><th /></tr></thead>
              <tbody>{lines.map((l, i) => <tr key={l.description}><td data-label="#">{i + 1}</td><td data-label="Service">{l.description}</td><td data-label="Fee" className="bk-right">{Number(l.amount).toLocaleString("en-AE")}</td><td><button type="button" className="bk-link" onClick={() => setLines((x) => x.filter((y) => y !== l))}>Remove</button></td></tr>)}</tbody>
            </table>
          </div>
        )}
        <div className="bk-grid bk-mt">
          {!fixedVat(dept) && <div className="bk-field"><label htmlFor="d-vat">VAT treatment</label><select id="d-vat" value={form.vat_mode} onChange={set("vat_mode")}><option value="inclusive">Fees include VAT</option><option value="exclusive">VAT added on top</option><option value="none">No VAT</option></select></div>}
          <div className="bk-field"><label htmlFor="d-valid">Quotation valid until</label><input id="d-valid" type="date" value={form.valid_until} onChange={set("valid_until")} /></div>
          <div className="bk-field bk-full"><label htmlFor="d-notes">Notes on the quotation</label><textarea id="d-notes" rows={2} value={form.notes} onChange={set("notes")} /></div>
        </div>
        {lines.length > 0 && <p className="bk-desk-total">Total <strong>AED {totals.total.toLocaleString("en-AE", { maximumFractionDigits: 2 })}</strong>{deskVatMode(dept, form.vat_mode) !== "none" && <small className="bk-muted"> (VAT {totals.vat.toLocaleString("en-AE", { maximumFractionDigits: 2 })})</small>}</p>}
      </Panel>
      <Panel title="3. Generate" sub="The engagement letter is the next step after the quote.">
        <div className="bk-actions">
          <Button variant="primary" busy={busy === "quote"} onClick={generateQuote}>Generate Quote + Mail</Button>
        </div>
      </Panel>
      {last && (
        <div className="bk-inbox bk-row">
          <span className="bk-mail-result">{mailButton(last)}<span><strong>{LABEL[last.doc_type]} {last.document_number}</strong> generated. Open the mail icon for its draft.{last.doc_type === "quote" && " When the client accepts, generate the engagement letter."}</span></span>
          {last.doc_type === "quote" && <Button variant="primary" busy={busy === `letter-${last.id}`} onClick={() => generateLetter(last)}>Generate Engagement Letter + Mail</Button>}
        </div>
      )}
      {mail && (
        <div ref={mailPanel}>
        <Panel title={`Mail for ${mail.label || "document"}${mail.number ? ` ${mail.number}` : ""}`} sub="Nothing is sent from the CRM. Attach the file and send it yourself."
          actions={<><Button onClick={copy}>Copy</Button><a className="bk-btn bk-btn-secondary" href={mailto}>Open in email</a><Button busy={busy === "mail"} onClick={saveDraft}>Save changes</Button><Button onClick={() => setMail(null)}>Close</Button></>}>
          <div className="bk-field bk-mb"><label htmlFor="m-subj">Subject</label><input id="m-subj" value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })} /></div>
          <div className="bk-field"><label htmlFor="m-body">Message</label><textarea id="m-body" rows={12} value={mail.body} onChange={(e) => setMail({ ...mail, body: e.target.value })} /></div>
        </Panel>
        </div>
      )}
      <Panel title="Generated documents">
        <ErrorNote message={docs.error} />
        <DataTable search="Search…" rows={(docs.data || []).filter((d) => d.doc_type !== "mail")} empty="Nothing generated yet." columns={[
          { key: "doc_type", label: "Type", render: (d) => <Badge>{LABEL[d.doc_type]}</Badge> }, { key: "document_number", label: "Number" }, { key: "document_serial", label: "Serial", right: true },
          { key: "client_name", label: "Client" }, ...(department ? [] : [{ key: "department", label: "Department" }]), { key: "services", label: "Services", render: (d) => d.services.join(", ") },
          { key: "total_amount", label: "Total", right: true, render: (d) => `AED ${Number(d.total_amount).toLocaleString("en-AE")}` }, { key: "created_at", label: "Date", render: (d) => fmtDate(d.created_at) },
          { key: "mail", label: "Mail", render: mailButton },
          { key: "next", label: "Next step", render: (d) => (d.doc_type !== "quote" ? "–" : (docs.data || []).some((x) => x.doc_type === "letter" && x.parent_id === d.id && x.status !== "rejected") ? <Badge tone="good">Letter generated</Badge> : <Button busy={busy === `letter-${d.id}`} onClick={() => generateLetter(d)}>Engagement Letter + Mail</Button>) },
          { key: "o", label: "File", render: (d) => (d.storage_path ? <span className="bk-actions"><button type="button" className="bk-link" onClick={() => openStored(d.storage_path).catch((e) => setError(e.message))}>View</button>{d.local_path ? <button type="button" className="bk-link" title={d.local_path} onClick={() => openInFolder(d.local_path).catch((e) => setError(e.message))}>Open in Folder</button> : <Badge tone="warn">Not in PC folder</Badge>}</span> : (d.library_template ? <small className="bk-muted">Use Retry in Template Hub</small> : <Button busy={busy === `file-${d.id}`} onClick={() => refile(d)}>Create file</Button>)) },
        ]} />
      </Panel>
    </div>
  );
}
