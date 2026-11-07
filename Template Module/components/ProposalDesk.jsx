// The Business Formation Proposal form: client, options, shared sections, then Generate. The list of proposals sits below.
import { useEffect, useRef, useState } from "react";
import "@banking/components/banking.css";
import { Button, ErrorNote, Panel, Spinner, useLoad } from "@banking/components/shared";
import ClientPicker from "@banking/components/ClientPicker";
import { ClientLists, useClientLookup } from "@banking/components/ClientLookup";
import { applyClient, findClient, pickClient } from "@banking/logic/clientLookup";
import { flagMissing } from "@banking/components/Attention";
import { loadHubSettings, openStored } from "../services/hubApi";
import { loadAuthorities } from "../services/proposalApi";
import { generateProposal, retryProposal } from "../services/proposalGenerate";
import { pdfName, proposalDeps } from "../services/proposalDeps";
import { blankOption, needsSharedWarning, optionFromAuthority, removeOption, sharedFromAuthority } from "../logic/proposalModel";
import ProposalOption from "./ProposalOption";
import ProposalDocuments from "./ProposalDocuments";

const CLIENT_MAP = { client: "name", contact: "contact", email: "email", phone: "phone" };
const EMPTY_FORM = { client: "", contact: "", email: "", phone: "" };
const EMPTY_SHARED = { addons: [], documents: [], payment: [], scope: [], notes: [] };
const LISTS = [["documents", "Documents required"], ["payment", "Payment terms"], ["scope", "Scope of work"], ["notes", "Notes"]];

// The field to highlight for a message from checkProposal.
function fieldFor(message) {
  if (/client name/.test(message)) return ["p-client"];
  if (/contact person/.test(message)) return ["p-contact"];
  if (/email/.test(message)) return ["p-email"];
  if (/USD rate/.test(message)) return ["p-rate"];
  const n = /ption (\d+)/.exec(message);
  if (n && /authority/.test(message)) return [`p-o${n[1] - 1}-authority`];
  if (n && /activity/.test(message)) return [`p-o${n[1] - 1}-activity`];
  if (n && /service/.test(message)) return [`p-o${n[1] - 1}-services`];
  return [];
}

export default function ProposalDesk({ profile }) {
  const authorities = useLoad(loadAuthorities, []);
  const settings = useLoad(loadHubSettings, []);
  const clients = useClientLookup();
  const [form, setForm] = useState(EMPTY_FORM);
  const [clientId, setClientId] = useState(null);
  const [rate, setRate] = useState("");
  const [options, setOptions] = useState([blankOption()]);
  const [shared, setShared] = useState(EMPTY_SHARED);
  const [sharedBase, setSharedBase] = useState(JSON.stringify(EMPTY_SHARED));
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null); // { doc, onedrive, sent, sendError, error } of the last run
  const [refresh, setRefresh] = useState(0);
  const guard = useRef({ busy: false });

  const defaultRate = settings.data?.proposal_defaults?.usd_rate;
  useEffect(() => { if (!rate && defaultRate) setRate(String(defaultRate)); }, [defaultRate]); // eslint-disable-line react-hooks/exhaustive-deps

  const sets = (authorities.data || []).filter((a) => a.active !== false);
  const sharedDirty = JSON.stringify(shared) !== sharedBase;
  const blocked = authorities.data && !sets.length ? "No licence authority sets are saved yet, so a proposal cannot be made. Add them in Template Hub settings first." : (settings.data && !defaultRate && !Number(rate) ? "The USD rate is not set in Settings. Enter a rate below, or ask an admin to set the default." : null);

  const setField = (k) => (e) => { const v = e.target.value; setForm((f) => (CLIENT_MAP[k] ? applyClient(f, CLIENT_MAP, k, v, clients) : { ...f, [k]: v })); };
  const fillShared = (set) => { const s = sharedFromAuthority(set); setShared(s); setSharedBase(JSON.stringify(s)); };
  const patchOption = (i, o) => setOptions((list) => list.map((x, k) => (k === i ? o : x)));

  const chooseAuthority = (i, key) => {
    const set = sets.find((a) => a.authority_key === key);
    if (!set) return;
    if (needsSharedWarning(i, sharedDirty) && !window.confirm("Changing Option 1's authority refills the shared sections (add-ons, documents, payment terms, scope and notes) and loses your edits to them. Continue?")) return;
    patchOption(i, { ...optionFromAuthority(set), activity: options[i].activity });
    if (i === 0) fillShared(set);
  };
  const dropOption = (i) => {
    if (needsSharedWarning(i, sharedDirty) && !window.confirm("Removing Option 1 refills the shared sections from the next option and loses your edits to them. Continue?")) return;
    const next = removeOption({ options }, i).options;
    setOptions(next);
    if (i === 0) {
      const set = sets.find((a) => a.authority_key === next[0]?.authority_key);
      if (set) fillShared(set); else { setShared(EMPTY_SHARED); setSharedBase(JSON.stringify(EMPTY_SHARED)); }
    }
  };

  const clear = () => { setForm(EMPTY_FORM); setClientId(null); setOptions([blankOption()]); setShared(EMPTY_SHARED); setSharedBase(JSON.stringify(EMPTY_SHARED)); };
  // Both a first run and a Retry end here: download the PDF and show the Ref and the OneDrive state, or the error with Retry.
  const finish = async (out, cleared) => {
    if (out.error && !out.doc) { setError(out.error); const ids = fieldFor(out.error); if (ids.length) flagMissing(ids); return; }
    setRefresh((n) => n + 1);
    if (out.error) { setResult({ doc: out.doc, error: out.error }); setError(out.error); return; }
    setResult({ doc: out.doc, onedrive: out.onedrive, sent: out.sent, sendError: out.sendError });
    const { saveAs } = await import("file-saver");
    saveAs(out.pdfBlob, pdfName(out.doc));
    if (cleared) clear();
  };

  const stuck = !!(result?.error && result.doc); // numbered but not finished: only Retry may continue it
  const startNew = () => { if (window.confirm(`Proposal ${result.doc.document_number} has no files yet. Starting a new proposal leaves it without files (Retry stays available in the list below). Start a new proposal?`)) { setResult(null); clear(); } };
  const generate = async () => {
    if (stuck) return;
    setBusy("generate"); setError(null); setResult(null);
    try { await finish(await generateProposal({ form, proposal: { usd_rate: rate, options, shared }, clientId, settings: settings.data, guard: guard.current }, proposalDeps), true); } catch (e) { setError(e.message); }
    setBusy(null);
  };
  const retry = async () => {
    setBusy("retry"); setError(null);
    try { await finish(await retryProposal(result.doc, proposalDeps, settings.data), true); } catch (e) { setError(e.message); }
    setBusy(null);
  };

  const setAddon = (i, patch) => setShared((s) => ({ ...s, addons: s.addons.map((a, k) => (k === i ? { ...a, ...patch } : a)) }));
  if ((authorities.loading && !authorities.data) || (settings.loading && !settings.data)) return <Spinner />;
  return (
    <div>
      <ErrorNote message={authorities.error || settings.error || error} onClose={error ? () => setError(null) : undefined} />
      {blocked && <div className="bk-alert bk-alert-warn">{blocked}</div>}
      {result && (
        <div className={`bk-alert ${result.error ? "bk-alert-warn" : "bk-alert-ok"}`}>
          {result.error
            ? <>Proposal {result.doc.document_number} was numbered but not finished: {result.error} The Ref is kept. <Button variant="primary" busy={busy === "retry"} onClick={retry}>Retry</Button></>
            : <>Proposal <strong>{result.doc.document_number}</strong> created and the PDF downloaded.{" "}
              {result.sendError ? <strong>The mail was not sent: {result.sendError} Use the mail icon in the list below to send it.</strong>
                : result.sent ? <>Mailed to {result.doc.contact_email} with the PDF and the client portal link.</> : null}{" "}
              {result.onedrive ? `Saved to OneDrive: ${result.onedrive}` : "Not in OneDrive: this PC could not reach the Client Module. Use Save now in the list below on a PC where it runs."}{" "}
              {result.doc.storage_path && <Button onClick={() => openStored(result.doc.storage_path).catch((e) => setError(e.message))}>View</Button>}</>}
        </div>
      )}
      <Panel title="1. Client" sub="Not printed. Choose a client to fill in the rest, or type a new one.">
        <div className="bk-grid">
          <div className="bk-field"><label htmlFor="p-client">Client name <em>*</em></label>
            <ClientPicker id="p-client" value={form.client} clients={clients} onChange={(v, picked) => { setClientId(picked?.ref || findClient(clients, "name", v)?.ref || null); setForm((f) => (picked ? pickClient(f, CLIENT_MAP, "client", picked, clients) : applyClient(f, CLIENT_MAP, "client", v, clients))); }} />
            <ClientLists clients={clients} keys={["email", "phone"]} /></div>
          <div className="bk-field"><label htmlFor="p-contact">Contact person <em>*</em></label><input id="p-contact" value={form.contact} onChange={setField("contact")} /></div>
          <div className="bk-field"><label htmlFor="p-email">Email <em>*</em></label><input id="p-email" type="email" value={form.email} onChange={setField("email")} /></div>
          <div className="bk-field"><label htmlFor="p-phone">Phone</label><input id="p-phone" value={form.phone} onChange={setField("phone")} /></div>
          <div className="bk-field"><label htmlFor="p-rate">USD rate (AED per USD) <em>*</em></label><input id="p-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
        </div>
      </Panel>
      <h3 className="bk-mt">2. Proposal options</h3>
      <p className="bk-muted">Options are alternatives. Their fees are never added together.</p>
      {options.map((o, i) => <ProposalOption key={i} option={o} index={i} rate={rate} authorities={sets} onAuthority={(k) => chooseAuthority(i, k)} onChange={(x) => patchOption(i, x)} onRemove={() => dropOption(i)} canRemove={options.length > 1} />)}
      <div className="bk-actions bk-mb"><Button onClick={() => setOptions((l) => [...l, blankOption()])}>+ Add option</Button></div>
      <Panel title="3. Shared sections, printed once" sub={sharedDirty ? "Edited by hand. Changing Option 1's authority will ask before it refills these." : "Filled from Option 1's authority. Bank details and contact come from Settings."}>
        <h4>Add-on services</h4>
        {shared.addons.map((a, i) => (
          <div className="bk-add-line" key={i}>
            <div className="bk-field"><label htmlFor={`p-add-${i}`}>Name</label><input id={`p-add-${i}`} value={a.name} onChange={(e) => setAddon(i, { name: e.target.value })} /></div>
            <div className="bk-field"><label htmlFor={`p-add-amt-${i}`}>Amount (AED)</label><input id={`p-add-amt-${i}`} inputMode="decimal" value={a.amount ?? ""} onChange={(e) => setAddon(i, { amount: e.target.value })} /></div>
            <div className="bk-field"><label htmlFor={`p-add-txt-${i}`}>Or text, such as "Rate will be customized"</label><input id={`p-add-txt-${i}`} value={a.text} onChange={(e) => setAddon(i, { text: e.target.value })} /></div>
            <Button onClick={() => setShared((s) => ({ ...s, addons: s.addons.filter((_, k) => k !== i) }))}>Remove</Button>
          </div>
        ))}
        <div className="bk-actions bk-mb"><Button onClick={() => setShared((s) => ({ ...s, addons: [...s.addons, { name: "", amount: "", text: "" }] }))}>+ Add add-on</Button></div>
        <div className="bk-grid">
          {LISTS.map(([k, label]) => <div className="bk-field bk-full" key={k}><label htmlFor={`p-sh-${k}`}>{label}</label><textarea id={`p-sh-${k}`} rows={4} value={shared[k].join("\n")} onChange={(e) => setShared((s) => ({ ...s, [k]: e.target.value.split("\n") }))} /><small>One item per line.</small></div>)}
        </div>
      </Panel>
      <Panel title="4. Generate" sub="Creates the Ref and the Word and PDF files, then mails the PDF to the client with the client portal link. The PDF downloads when done.">
        {stuck
          ? <div className="bk-actions"><Button variant="primary" busy={busy === "retry"} disabled={!!busy} onClick={retry}>Retry {result.doc.document_number}</Button><Button disabled={!!busy} onClick={startNew}>Start a new proposal</Button></div>
          : <div className="bk-actions"><Button variant="primary" busy={busy === "generate"} disabled={!!busy || !!blocked} onClick={generate}>Generate Proposal + Mail</Button></div>}
      </Panel>
      <ProposalDocuments profile={profile} settings={settings.data} refresh={refresh} />
    </div>
  );
}
