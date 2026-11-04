// Every document as a card: what the client sent, their KYC documents, and what AB Capital issued.
import { useRef, useState } from "react";
import { Badge, Button, Empty, ErrorNote, Panel } from "@banking/components/shared";
import { DOC_TYPES } from "./portalApi";
import { fmtSize, showDate } from "./format";

const STATUS = { pending: ["Received", "warn"], in_review: ["Under review", "warn"], validated: ["Accepted", "good"], rejected: ["Please re-upload", "bad"] };
const CATEGORIES = [["all", "All"], ["sent", "Sent by you"], ["kyc", "Your KYC documents"], ["ab", "From AB Capital Services FZE"]];

// One shape for the three sources. A sensitive document carries its type only: its title or file name can name a person.
function toCards(me) {
  const sent = (me.documents || []).map((d) => ({ key: `sent-${d.id}`, category: "sent", source: "sent", id: d.id, name: d.file_name, type: d.doc_type, date: d.uploaded_at, size: d.size_bytes, status: d.status, message: d.review_note, canOpen: true }));
  const gallery = (me.gallery || []).map((g) => g.sensitive
    ? { key: `${g.source}-${g.id}`, category: "kyc", type: g.doc_type, sensitive: true }
    : { key: `${g.source}-${g.id}`, category: g.source === "generated" ? "ab" : "kyc", source: g.source, id: g.id, name: g.title || g.file_name, type: g.doc_type, date: g.doc_date, canOpen: !!g.can_open });
  return [...sent, ...gallery];
}

function Card({ card, readOnly, onOpen }) {
  const s = STATUS[card.status];
  return (
    <article className="pt-card">
      {card.sensitive ? <h4>{card.type}</h4> : <h4>{card.name}</h4>}
      {!card.sensitive && <span className="pt-muted">{[card.type, showDate(card.date), fmtSize(card.size)].filter(Boolean).join(" · ")}</span>}
      {card.sensitive && <Badge tone="plain">Held by AB Capital Services FZE</Badge>}
      {s && <Badge tone={s[1]}>{s[0]}</Badge>}
      {card.message && <small>Message from AB Capital Services FZE: {card.message}</small>}
      {!card.sensitive && !readOnly && card.canOpen && <Button onClick={() => onOpen(card)}>Open</Button>}
    </article>
  );
}

export default function DocumentsTab({ me, api, readOnly, reload }) {
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState(null);
  const cards = toCards(me);
  const shown = cards.filter((c) => filter === "all" || c.category === filter);
  const open = async (card) => {
    setError(null);
    try {
      window.location.assign(card.source === "sent" ? await api.docUrl(card.id) : await api.galleryUrl(card.source, card.id));
    } catch (e) { setError(e.message); }
  };
  return (
    <>
      {!readOnly && <Upload api={api} onDone={reload} />}
      <Panel title="Your documents" sub="We review each document you send.">
        <div className="bk-tabs" role="group" aria-label="Document category">
          {CATEGORIES.map(([k, label]) => <button type="button" key={k} aria-pressed={filter === k} className={filter === k ? "active" : ""} onClick={() => setFilter(k)}>{label} <span className="bk-tab-count">{k === "all" ? cards.length : cards.filter((c) => c.category === k).length}</span></button>)}
        </div>
        <ErrorNote message={error} />
        {shown.length ? <div className="pt-cards">{shown.map((c) => <Card key={c.key} card={c} readOnly={readOnly} onOpen={open} />)}</div> : <Empty>{cards.length ? "No documents in this group." : "Nothing recorded yet."}</Empty>}
      </Panel>
    </>
  );
}

function Upload({ api, onDone }) {
  const input = useRef(null);
  const [docType, setDocType] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(0);
  const send = async () => {
    const files = [...(input.current?.files || [])];
    if (!docType) return setError("Choose the document type.");
    if (!files.length) return setError("Choose a file to upload.");
    setBusy(true); setError(null); setSent(0);
    let done = 0;
    try {
      for (const f of files) { await api.upload(f, { doc_type: docType, note }); done += 1; }
      input.current.value = ""; setNote("");
    } catch (e) {
      setError(e.message);
    }
    setBusy(false); setSent(done);
    if (done) onDone();
  };
  return (
    <Panel title="Upload a document" sub="PDF, image, Word, Excel, CSV, text or email file. Up to 25 MB each.">
      <ErrorNote message={error} />
      <div className="bk-grid">
        <div className="bk-field"><label htmlFor="pt-type">Document type <em>*</em></label><select id="pt-type" value={docType} onChange={(e) => setDocType(e.target.value)}><option value="">Select…</option>{DOC_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
        <div className="bk-field"><label htmlFor="pt-file">File <em>*</em></label><input id="pt-file" ref={input} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,.doc,.docx,.xls,.xlsx,.csv,.txt,.eml,.msg" /></div>
        <div className="bk-field bk-full"><label htmlFor="pt-note">Note for AB Capital Services FZE</label><input id="pt-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
      <div className="bk-actions bk-mt"><Button variant="primary" busy={busy} onClick={send}>Upload</Button>{sent > 0 && !busy && <span role="status">Sent {sent} {sent === 1 ? "file" : "files"}. We will review {sent === 1 ? "it" : "them"} shortly.</span>}</div>
    </Panel>
  );
}
