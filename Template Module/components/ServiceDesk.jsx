// Pick services, enter fees, then generate a quotation, an engagement letter or a mail draft.
// Used by Template Hub (every department) and by each department's own tab (only its services).
import { useMemo, useState } from "react";
import "@banking/components/banking.css";
import { Badge, Button, DataTable, ErrorNote, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { clientNames, createDocument, listDocuments, loadCatalogue, loadHubSettings, openStored, renderTemplate, saveFile } from "../services/hubApi";
import { DEPARTMENTS, fileNameFor, folderKind, letterData, mailDraft, quoteData, serviceTotals } from "../logic/serviceDocs";

const LABEL = { quote: "Quotation", letter: "Engagement Letter", mail: "Mail draft" };
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export default function ServiceDesk({ department, profile }) {
  const catalogue = useLoad(loadCatalogue, []);
  const settings = useLoad(loadHubSettings, []);
  const names = useLoad(clientNames, []);
  const [dept, setDept] = useState(department || DEPARTMENTS[0]);
  const [picked, setPicked] = useState({}); // service name -> { fee, category }
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ client: "", contact: "", email: "", vat_mode: "inclusive", valid_until: inDays(15), notes: "" });
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [mail, setMail] = useState(null);
  const docs = useLoad(() => listDocuments(department || null), [department]);

  const categories = useMemo(() => (catalogue.data || []).filter((c) => c.department === dept), [catalogue.data, dept]);
  const lines = Object.entries(picked).map(([description, v]) => ({ description, amount: v.fee === "" ? null : Number(v.fee) }));
  const totals = serviceTotals(lines, form.vat_mode, 5);
  const needle = q.trim().toLowerCase();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggle = (name, category) => setPicked((p) => { const n = { ...p }; if (n[name]) delete n[name]; else n[name] = { fee: "", category }; return n; });
  const chooseDept = (d) => { setDept(d); setPicked({}); setMail(null); };

  const validate = () => {
    if (!form.client.trim()) return "Enter the client name.";
    if (!lines.length) return "Choose at least one service.";
    if (lines.some((l) => l.amount === null || Number.isNaN(l.amount) || l.amount < 0)) return "Enter a fee for every chosen service.";
    return null;
  };
  const payload = (doc_type, extra = {}) => ({ doc_type, department: dept, client_name: form.client, contact_name: form.contact || null, contact_email: form.email || null, services: Object.keys(picked), lines, vat_mode: form.vat_mode, vat_rate: 5, valid_until: form.valid_until || null, notes: form.notes || null, ...extra });

  const generate = async (type) => {
    const bad = validate();
    if (bad) { setError(bad); return; }
    setBusy(type); setError(null); setNote(null);
    try {
      const doc = await createDocument(payload(type));
      const company = settings.data?.company;
      const limitations = [...new Set(Object.values(picked).map((v) => v.category?.limitation).filter(Boolean))];
      const data = type === "quote" ? quoteData(doc, company) : letterData(doc, company, settings.data?.engagement_terms, limitations);
      const blob = await renderTemplate(type === "quote" ? "Service_Quotation_Template.docx" : "Service_Engagement_Template.docx", data);
      const fileName = fileNameFor(doc.document_number, doc.client_name);
      const saved = await saveFile(doc, folderKind(dept, type), blob, fileName);
      const { saveAs } = await import("file-saver");
      saveAs(blob, fileName);
      setNote({ ok: !!saved.local, text: `${LABEL[type]} ${doc.document_number} created. ${saved.local ? `Saved to ${saved.local}` : "Kept in the database, but not in the PC folder because the Client Module is not running here."}` });
      setMail(mailDraft({ type, client: doc.client_name, contact: doc.contact_name, services: doc.services, number: doc.document_number, total: doc.total_amount, validUntil: doc.valid_until, sender: profile?.full_name, company: company?.short_name }));
      await docs.reload();
    } catch (e) { setError(e.message); }
    setBusy(null);
  };

  const draftOnly = () => {
    const bad = validate();
    if (bad) { setError(bad); return; }
    setError(null); setNote(null);
    setMail(mailDraft({ type: "quote", client: form.client, contact: form.contact, services: Object.keys(picked), total: totals.total, validUntil: form.valid_until, sender: profile?.full_name, company: settings.data?.company?.short_name }));
  };
  const saveDraft = async () => {
    setBusy("mail"); setError(null);
    try { await createDocument(payload("mail", { mail_subject: mail.subject, mail_body: mail.body })); await docs.reload(); setNote({ ok: true, text: "Mail draft saved." }); } catch (e) { setError(e.message); }
    setBusy(null);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${mail.subject}\n\n${mail.body}`); setNote({ ok: true, text: "Copied." }); } catch { setError("Could not copy here. Select the text and copy it."); }
  };
  const mailto = mail ? `mailto:${encodeURIComponent(form.email)}?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.body)}` : "#";

  if (catalogue.loading && !catalogue.data) return <Spinner />;
  return (
    <div>
      <ErrorNote message={catalogue.error || settings.error || error} onClose={error ? () => setError(null) : undefined} />
      {note && <div className={`bk-alert ${note.ok ? "bk-alert-ok" : "bk-alert-warn"}`}>{note.text}</div>}
      {!department && <div className="bk-tabs" role="tablist" aria-label="Department">{DEPARTMENTS.map((d) => <button type="button" role="tab" aria-selected={dept === d} key={d} className={dept === d ? "active" : ""} onClick={() => chooseDept(d)}>{d}</button>)}</div>}
      <div className="bk-desk">
        <Panel title="1. Choose services" sub={`${dept}: ${categories.map((c) => c.focus).filter(Boolean).join(" · ")}`}>
          <input className="bk-search" type="search" placeholder="Search services…" aria-label="Search services" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="bk-desk-list">
            {categories.map((c) => {
              const items = c.service_items.filter((s) => !needle || s.name.toLowerCase().includes(needle));
              if (!items.length) return null;
              return (
                <details key={c.id} open={!!needle || categories.length === 1}>
                  <summary>{c.name} <span className="bk-tab-count">{items.length}</span></summary>
                  {items.map((s) => <label className="bk-check bk-desk-item" key={s.id}><input type="checkbox" checked={!!picked[s.name]} onChange={() => toggle(s.name, c)} /> {s.name}</label>)}
                </details>
              );
            })}
          </div>
        </Panel>
        <Panel title="2. Client and fees">
          <div className="bk-grid">
            <div className="bk-field"><label htmlFor="d-client">Client name <em>*</em></label><input id="d-client" list="d-clients" value={form.client} onChange={set("client")} autoComplete="off" /><datalist id="d-clients">{(names.data || []).map((n) => <option key={n} value={n} />)}</datalist></div>
            <div className="bk-field"><label htmlFor="d-contact">Contact person</label><input id="d-contact" value={form.contact} onChange={set("contact")} /></div>
            <div className="bk-field"><label htmlFor="d-email">Email</label><input id="d-email" type="email" value={form.email} onChange={set("email")} /></div>
            <div className="bk-field"><label htmlFor="d-vat">VAT treatment</label><select id="d-vat" value={form.vat_mode} onChange={set("vat_mode")}><option value="inclusive">Fees include VAT</option><option value="exclusive">VAT added on top</option><option value="none">No VAT</option></select></div>
            <div className="bk-field"><label htmlFor="d-valid">Quotation valid until</label><input id="d-valid" type="date" value={form.valid_until} onChange={set("valid_until")} /></div>
            <div className="bk-field bk-full"><label htmlFor="d-notes">Notes on the quotation</label><textarea id="d-notes" rows={2} value={form.notes} onChange={set("notes")} /></div>
          </div>
          <div className="bk-mt">
            {!lines.length && <p className="bk-note">Chosen services appear here for their fees.</p>}
            {Object.keys(picked).map((name) => (
              <div className="bk-row" key={name}><span>{name}</span><span className="bk-actions"><input type="number" min="0" step="any" aria-label={`Fee for ${name}`} placeholder="Fee (AED)" style={{ width: 120 }} value={picked[name].fee} onChange={(e) => setPicked((p) => ({ ...p, [name]: { ...p[name], fee: e.target.value } }))} /><button type="button" className="bk-link" onClick={() => toggle(name)}>Remove</button></span></div>
            ))}
            {lines.length > 0 && <p className="bk-desk-total">Total <strong>AED {totals.total.toLocaleString("en-AE", { maximumFractionDigits: 2 })}</strong>{form.vat_mode !== "none" && <small className="bk-muted"> (VAT {totals.vat.toLocaleString("en-AE", { maximumFractionDigits: 2 })})</small>}</p>}
          </div>
          <div className="bk-actions bk-mt">
            <Button variant="primary" busy={busy === "quote"} onClick={() => generate("quote")}>Generate Quotation</Button>
            <Button variant="primary" busy={busy === "letter"} onClick={() => generate("letter")}>Generate Engagement Letter</Button>
            <Button onClick={draftOnly}>Mail draft only</Button>
          </div>
        </Panel>
      </div>
      {mail && (
        <Panel title="Mail draft" sub="Nothing is sent from the CRM. Attach the file and send it yourself."
          actions={<><Button onClick={copy}>Copy</Button><a className="bk-btn bk-btn-secondary" href={mailto}>Open in email</a><Button busy={busy === "mail"} onClick={saveDraft}>Save draft</Button></>}>
          <div className="bk-field bk-mb"><label htmlFor="m-subj">Subject</label><input id="m-subj" value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })} /></div>
          <div className="bk-field"><label htmlFor="m-body">Message</label><textarea id="m-body" rows={12} value={mail.body} onChange={(e) => setMail({ ...mail, body: e.target.value })} /></div>
        </Panel>
      )}
      <Panel title="Generated documents">
        <ErrorNote message={docs.error} />
        <DataTable search="Search…" rows={docs.data || []} empty="Nothing generated yet." columns={[
          { key: "doc_type", label: "Type", render: (d) => <Badge>{LABEL[d.doc_type]}</Badge> }, { key: "document_number", label: "Number" }, { key: "document_serial", label: "Serial", right: true },
          { key: "client_name", label: "Client" }, ...(department ? [] : [{ key: "department", label: "Department" }]), { key: "services", label: "Services", render: (d) => d.services.join(", ") },
          { key: "total_amount", label: "Total", right: true, render: (d) => `AED ${Number(d.total_amount).toLocaleString("en-AE")}` }, { key: "created_at", label: "Date", render: (d) => fmtDate(d.created_at) },
          { key: "local_path", label: "Saved at", render: (d) => d.local_path || (d.doc_type === "mail" ? "–" : <Badge tone="warn">Not in PC folder</Badge>) },
          { key: "o", label: "", render: (d) => (d.storage_path ? <button type="button" className="bk-link" onClick={() => openStored(d.storage_path).catch((e) => setError(e.message))}>Open</button> : d.doc_type === "mail" ? <button type="button" className="bk-link" onClick={() => { setMail({ subject: d.mail_subject, body: d.mail_body }); window.scrollTo?.(0, 0); }}>View</button> : null) },
        ]} />
      </Panel>
    </div>
  );
}
