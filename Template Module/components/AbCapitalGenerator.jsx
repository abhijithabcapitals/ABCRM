// AB Capital quote or engagement letter, in Company Templates. docType: "quote" or "letter".
// A quote starts from a template. A letter starts from a client or an existing quote.
import { useMemo, useState } from "react";
import "@banking/components/banking.css";
import { ErrorNote, Panel, Spinner, useLoad } from "@banking/components/shared";
import { quoteToForm } from "../logic/libraryLetter";
import { listLetterableQuotes, listLibraryDocuments, listLibraryTemplates } from "../services/hubApi";
import LibraryForm from "./LibraryForm";
import LibraryRegister, { companyOf } from "./LibraryRegister";

const selectStyle = { padding: "7px 10px", borderRadius: 7, border: "1px solid #e0e0e0", fontSize: 13, background: "#fff", minWidth: 260 };
const rowsOf = (doc) => (doc.lines || []).map((l) => ({ label: l.description, amount: l.amount, remarks: l.remarks, rate: l.rate }));

export default function AbCapitalGenerator({ docType, profile }) {
  const isLetter = docType === "letter";
  const templates = useLoad(listLibraryTemplates, []);
  const documents = useLoad(listLibraryDocuments, []);
  const quotes = useLoad(() => (isLetter ? listLetterableQuotes() : Promise.resolve([])), [isLetter]);
  const usable = useMemo(() => (templates.data || []).filter((t) => t.company === "AB Capital" && t.active && t.file), [templates.data]);
  const [picked, setPicked] = useState("");
  const [from, setFrom] = useState("client");
  const [quoteId, setQuoteId] = useState("");
  const [start, setStart] = useState(null);
  const [formKey, setFormKey] = useState(0);
  const [error, setError] = useState(null);
  const template = usable.find((t) => t.template_key === picked);
  const quote = (quotes.data || []).find((q) => q.id === quoteId);

  const clear = () => { setStart(null); setQuoteId(""); setFormKey((n) => n + 1); };
  const pickQuote = (id) => {
    setQuoteId(id);
    const q = (quotes.data || []).find((x) => x.id === id);
    setStart(q ? quoteToForm(q) : null);
    setFormKey((n) => n + 1);
  };
  const done = async () => { await documents.reload(); if (isLetter) await quotes.reload(); };
  const canNew = (d) => (isLetter ? true : usable.some((t) => t.template_key === d.library_template));
  const onNew = (d) => {
    const { date: _date, usd_rate: _rate, ...values } = d.field_values || {};
    if (!isLetter) setPicked(d.library_template);
    if (isLetter) { setFrom("client"); setQuoteId(""); }
    setStart({ values, clientId: d.client_id, rows: rowsOf(d) });
    setFormKey((n) => n + 1);
  };
  const list = (documents.data || []).filter((d) => companyOf(d.library_template) === "AB Capital" && d.doc_type === docType);

  if (templates.loading && !templates.data) return <Spinner />;
  const ready = isLetter ? from === "client" || !!quote : !!template;
  return (
    <div className="bk-root">
      <ErrorNote message={error || templates.error || documents.error || quotes.error} onClose={() => setError(null)} />
      <Panel title={isLetter ? "New engagement letter" : "New quote"}>
        {isLetter ? (
          <div className="bk-row">
            <label>Start from{" "}
              <select style={selectStyle} value={from} onChange={(e) => { setFrom(e.target.value); clear(); }}>
                <option value="client">A client</option>
                <option value="quote">An existing quote</option>
              </select>
            </label>
            {from === "quote" && (
              <label>Quote{" "}
                <select style={selectStyle} value={quoteId} onChange={(e) => pickQuote(e.target.value)}>
                  <option value="">Choose a quote</option>
                  {(quotes.data || []).map((q) => <option key={q.id} value={q.id}>{q.document_number} · {q.client_name}</option>)}
                </select>
              </label>
            )}
          </div>
        ) : (
          <div className="bk-row">
            <label>Template{" "}
              <select style={selectStyle} value={picked} onChange={(e) => { setPicked(e.target.value); clear(); }}>
                <option value="">Choose a template</option>
                {usable.map((t) => <option key={t.template_key} value={t.template_key}>{t.name}</option>)}
              </select>
            </label>
          </div>
        )}
        {!isLetter && !usable.length && <p className="bk-note">No AB Capital templates yet. They are uploaded in Template Hub &gt; Settings &gt; Library Templates.</p>}
        {isLetter && from === "quote" && !(quotes.data || []).length && <p className="bk-note">No quote is available. A quote already with a letter, or in a Business Setup case, is not listed.</p>}
        {ready && (
          <LibraryForm
            key={`${picked}-${formKey}`}
            letter={isLetter}
            template={isLetter ? undefined : template}
            fileId={isLetter ? undefined : template.file.id}
            start={start}
            onClose={clear}
            onDone={done}
            onFailed={setError}
          />
        )}
      </Panel>
      <h3 style={{ margin: "24px 0 10px", fontSize: 14, fontWeight: 700, color: "#1a1a1a" }}>{isLetter ? "Engagement letters" : "Quotes"}</h3>
      <LibraryRegister documents={documents} rows={list} profile={profile} canNew={canNew} onNew={onNew} onError={setError} />
    </div>
  );
}
