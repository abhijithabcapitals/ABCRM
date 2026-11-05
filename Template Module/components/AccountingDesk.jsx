// The new Accounting quote: client, options, shared text. The generated quotes and agreements are listed below.
// Used by ServiceDesk for the Accounting department when the Quote tab is on.
import { useState } from "react";
import "@banking/components/banking.css";
import { Button, ErrorNote, Panel, Spinner, useLoad } from "@banking/components/shared";
import ClientPicker from "@banking/components/ClientPicker";
import { ClientLists, listIdFor, useClientLookup } from "@banking/components/ClientLookup";
import { applyClient, pickClient } from "@banking/logic/clientLookup";
import { flagMissing } from "@banking/components/Attention";
import { loadHubSettings } from "../services/hubApi";
import { loadPackages } from "../services/accountingApi";
import { accountingDeps, generateGuard } from "../services/accountingDeps";
import { generateQuote } from "../services/accountingGenerate";
import { blankOption, checkQuote } from "../logic/accountingQuote";
import { cleanLines, fromLines, toLines } from "../logic/accountingUi";
import AccountingOption from "./AccountingOption";
import AccountingDocuments from "./AccountingDocuments";

const CLIENT_MAP = { client_name: "name", contact_name: "contact", contact_email: "email", contact_phone: "phone" };
const blankForm = () => ({ client_name: "", contact_name: "", contact_email: "", contact_phone: "" });
const blankQuote = () => ({ accepted_option: null, options: [blankOption()], shared: { scope: [], payment: [], notes: [] } });

export default function AccountingDesk({ profile }) {
  const settings = useLoad(loadHubSettings, []);
  const packages = useLoad(loadPackages, []);
  const clients = useClientLookup();
  const [form, setForm] = useState(blankForm);
  const [clientId, setClientId] = useState(null);
  const [quote, setQuote] = useState(blankQuote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [refresh, setRefresh] = useState(0);

  // A detail that matches another client can change the name, so the client code is dropped whenever the name changes.
  const set = (k) => (e) => { const next = applyClient(form, CLIENT_MAP, k, e.target.value, clients); if (next.client_name !== form.client_name) setClientId(null); setForm(next); };
  const setShared = (k) => (e) => setQuote((q) => ({ ...q, shared: { ...q.shared, [k]: toLines(e.target.value) } }));
  const setOption = (i, o) => setQuote((q) => ({ ...q, options: q.options.map((x, j) => (j === i ? o : x)) }));

  const generate = async () => {
    // Blank lines and spaces are dropped before checking, so what is checked is what is sent.
    const clean = {
      ...quote,
      options: quote.options.map((o) => ({ ...o, notes: cleanLines(o.notes) })),
      shared: { scope: cleanLines(quote.shared.scope), payment: cleanLines(quote.shared.payment), notes: cleanLines(quote.shared.notes) },
    };
    const bad = checkQuote(form, clean) || (!form.contact_name.trim() && "Enter the contact person.") || (!form.contact_email.trim() && "Enter the client's email.") || null;
    if (bad) {
      setError(bad); setNote(null);
      flagMissing(/client name/.test(bad) ? ["aq-client"] : /contact person/.test(bad) ? ["aq-contact"] : /email/.test(bad) ? ["aq-email"] : []);
      return;
    }
    setBusy(true); setError(null); setNote(null);
    const r = await generateQuote({ form, quote: clean, clientId, guard: generateGuard }, accountingDeps(settings.data));
    setBusy(false);
    setRefresh((n) => n + 1);
    if (r.error && r.doc) {
      setForm(blankForm()); setClientId(null); setQuote(blankQuote());
      setError(`${r.doc.document_number} was numbered but its files did not finish: ${r.error} Use Retry in the list below.`);
    } else if (r.error) setError(r.error);
    else {
      setNote({ ok: !!r.onedrive, text: `Quote ${r.doc.document_number} created.${r.onedrive ? ` Saved to ${r.onedrive}` : " Not in OneDrive: use Save now on a PC where the Client Module runs."} Its mail draft is in the list below.` });
      setForm(blankForm()); setClientId(null); setQuote(blankQuote());
    }
  };

  if ((settings.loading && !settings.data) || (packages.loading && !packages.data)) return <Spinner />;
  const list = (packages.data || []).filter((p) => p.active);
  return (
    <div>
      <ErrorNote message={settings.error || packages.error || error} onClose={error ? () => setError(null) : undefined} />
      {note && <div className={`bk-alert ${note.ok ? "bk-alert-ok" : "bk-alert-warn"}`}>{note.text}</div>}
      <Panel title="1. Client details" sub="These are not printed on the quote. Choose an existing client to fill in the rest.">
        <div className="bk-grid">
          <div className="bk-field"><label htmlFor="aq-client">Client name <em>*</em></label><ClientPicker id="aq-client" value={form.client_name} clients={clients} onChange={(v, picked) => { setClientId(picked?.ref ?? null); setForm((f) => (picked ? pickClient(f, CLIENT_MAP, "client_name", picked, clients) : applyClient(f, CLIENT_MAP, "client_name", v, clients))); }} /><ClientLists clients={clients} keys={["email", "phone"]} /></div>
          <div className="bk-field"><label htmlFor="aq-contact">Contact person <em>*</em></label><input id="aq-contact" value={form.contact_name} onChange={set("contact_name")} /></div>
          <div className="bk-field"><label htmlFor="aq-email">Email <em>*</em></label><input id="aq-email" type="email" list={listIdFor("email")} value={form.contact_email} onChange={set("contact_email")} /></div>
          <div className="bk-field"><label htmlFor="aq-phone">Phone</label><input id="aq-phone" list={listIdFor("phone")} value={form.contact_phone} onChange={set("contact_phone")} /></div>
        </div>
      </Panel>
      <Panel title="2. Options" sub="Each option is priced on its own. Options and fee bases are never added together." actions={<Button onClick={() => setQuote((q) => ({ ...q, options: [...q.options, blankOption()] }))}>+ Add option</Button>}>
        {quote.options.map((o, i) => (
          <AccountingOption key={i} option={o} index={i} count={quote.options.length} packages={list} onChange={(x) => setOption(i, x)} onRemove={() => setQuote((q) => ({ ...q, options: q.options.filter((_, j) => j !== i) }))} />
        ))}
      </Panel>
      <Panel title="3. Scope, payment and notes" sub="Printed once, after all options. One item per line. Leave blank to leave the section out.">
        <div className="bk-grid">
          <div className="bk-field bk-full"><label htmlFor="aq-scope">Scope</label><textarea id="aq-scope" rows={3} value={fromLines(quote.shared.scope)} onChange={setShared("scope")} /></div>
          <div className="bk-field bk-full"><label htmlFor="aq-pay">Payment terms</label><textarea id="aq-pay" rows={3} value={fromLines(quote.shared.payment)} onChange={setShared("payment")} /></div>
          <div className="bk-field bk-full"><label htmlFor="aq-notes">Notes</label><textarea id="aq-notes" rows={3} value={fromLines(quote.shared.notes)} onChange={setShared("notes")} /></div>
        </div>
      </Panel>
      <Panel title="4. Generate" sub="The agreement is the next step, once the client accepts an option.">
        <div className="bk-actions"><Button variant="primary" busy={busy} onClick={generate}>Generate Quote + Mail</Button></div>
      </Panel>
      <AccountingDocuments settings={settings.data} packages={packages.data || []} profile={profile} reloadKey={refresh} />
    </div>
  );
}
