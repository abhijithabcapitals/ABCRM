// The ArdentTax (ASP) page. api is the real one in the CRM and the fake one on the development page.
import { useEffect, useMemo, useRef, useState } from "react";
import "@banking/components/banking.css";
import "./ardentax.css";
import { Button, ErrorNote, Panel, Spinner, useLoad } from "@banking/components/shared";
import { computeQuote, defaultDetails, money, quoteBlockers, quoteChecks } from "../logic/quoteModel";
import { generateDocument, makeLetter, regenerate, reviseDocument } from "../services/generate";
import QuoteForm from "./QuoteForm";
import MailPanel from "./MailPanel";
import Register from "./Register";

const dubaiToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());

async function browserDeps() {
  const [{ default: JSZip }, { docxToPdf }] = await Promise.all([import("jszip"), import("../logic/docxToPdf")]);
  return {
    JSZip,
    parse: (s) => new DOMParser().parseFromString(s, "application/xml"),
    serialize: (d) => new XMLSerializer().serializeToString(d),
    toPdf: (blob) => docxToPdf(blob),
  };
}

export default function ArdentTaxView({ api, clients = [] }) {
  const [details, setDetails] = useState(() => defaultDetails(dubaiToday()));
  const [revising, setRevising] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [mailDoc, setMailDoc] = useState(null);
  const docs = useLoad(() => api.list(), [api]);
  const requestId = useRef(crypto.randomUUID());
  const top = useRef(null);
  const running = useRef(false);

  // A changed form is a new request. The same form sent twice is one request and uses one number.
  useEffect(() => { requestId.current = crypto.randomUUID(); }, [details, revising]);

  const totals = useMemo(() => computeQuote(details), [details]);
  const checks = quoteChecks(details, totals);
  const missing = quoteBlockers(details, totals);

  const startOver = () => { setRevising(null); setDetails(defaultDetails(dubaiToday())); };
  // formJob: this job came from the form, so the form clears when it is done. Register buttons leave the form alone.
  const run = async (key, work, formJob = false) => {
    // A ref, because a second click can arrive before the page redraws with busy set.
    if (running.current) return;
    running.current = true;
    setBusy(key); setError(null); setNote(null);
    let created = null;
    try {
      const { doc } = await work(await browserDeps(), (d) => { created = d; });
      setNote({ ok: true, text: `${doc.document_number}${doc.version > 1 ? ` v${doc.version}` : ""} is ready. Open its Word file, PDF or email in the register below.` });
      if (formJob) startOver();
    } catch (e) {
      // The number is issued and the details are saved. Clearing the form stops an edit from taking a second number.
      if (formJob && created) {
        setError(`${created.document_number} was issued, but its files could not be made: ${e.message} Use Generate again on its row in the list below.`);
        startOver();
      } else {
        setError(e.message);
      }
    }
    await docs.reload();
    running.current = false;
    setBusy(null);
  };

  const generate = () => run("generate", (deps, onCreated) => (revising
    ? reviseDocument(api, revising, details, requestId.current, deps, onCreated)
    : generateDocument(api, { details, requestId: requestId.current, onCreated }, deps)), true);
  const again = (d) => run(`again-${d.id}`, (deps) => regenerate(api, d, deps));
  const letter = (q) => run(`letter-${q.id}`, (deps) => makeLetter(api, q, crypto.randomUUID(), deps));
  const revise = (d) => {
    if ((revising || details.client.legal.trim()) && !window.confirm("Replace what is in the form with this document's details?")) return;
    setRevising(d); setDetails(d.details); setNote(null); setError(null);
    top.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };
  const open = async (path) => {
    try { window.open(await api.signedUrl(path), "_blank", "noopener"); } catch (e) { setError(e.message); }
  };

  return (
    <div className="at-page">
      <div className="at-head" ref={top}>
        <h1>ArdentTax (ASP)</h1>
        <div>Generate e-invoicing quotations and engagement letters. Numbers come from the CRM, so they stay in order.</div>
      </div>
      <div className="at-body">
        {revising && <p className="bk-note">Revising {revising.document_number}. It keeps this number and becomes version {Math.max(...(docs.data || []).filter((x) => x.document_number === revising.document_number).map((x) => x.version), revising.version) + 1}. <button type="button" className="bk-link" onClick={startOver}>Cancel</button></p>}
        <QuoteForm details={details} setDetails={setDetails} totals={totals} clients={clients} locked={!!revising} />

        <Panel title="5. Totals">
          <dl className="at-totals">
            <div><dt>One-time fees in the total</dt><dd>{money(totals.oneTime)}</dd></div>
            <div><dt>Annual / recurring fees</dt><dd>{money(totals.annualTotal)}</dd></div>
            <div><dt>Year 1 total (AED, excl. VAT)</dt><dd><strong>{money(totals.year1)}</strong></dd></div>
            <div><dt>Year 2 renewal</dt><dd>{money(totals.renewal)}</dd></div>
            <div><dt>Total shown in the document</dt><dd>{totals.totalText}</dd></div>
            <div><dt>Invoices included per year</dt><dd>{money(totals.volume)}</dd></div>
          </dl>
          <small className="bk-muted">{totals.totalDesc}</small>
        </Panel>

        {(checks.length > 0 || missing.length > 0) && (
          <Panel title="6. Checks">
            {missing.length > 0 && <p className="at-stop">Fill in before generating: {missing.join(", ")}.</p>}
            {checks.map((c) => <p key={c} className="at-warn">{c}</p>)}
          </Panel>
        )}

        <ErrorNote message={error} />
        {note && <p className={note.ok ? "bk-note" : "at-warn"}>{note.text}</p>}
        <div className="at-actions at-go">
          <Button variant="primary" busy={busy === "generate"} disabled={!!busy || missing.length > 0} onClick={generate}>
            {revising ? "Generate revision" : details.docType === "letter" ? "Generate Engagement Letter" : "Generate Quote"}
          </Button>
        </div>

        <Panel title="Generated documents">
          <ErrorNote message={docs.error} />
          {docs.loading && !docs.data ? <Spinner /> : <Register docs={docs.data || []} busy={busy} onOpen={open} onAgain={again} onLetter={letter} onRevise={revise} onMail={setMailDoc} />}
        </Panel>
        {mailDoc && <MailPanel doc={mailDoc} api={api} onClose={() => setMailDoc(null)} onChanged={docs.reload} />}
      </div>
    </div>
  );
}
