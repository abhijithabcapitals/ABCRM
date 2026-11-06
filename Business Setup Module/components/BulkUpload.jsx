// One drop area for all of a client's documents, used at the top of the client's form and of Client Onboarding. No staff code here: the portal imports it.
// Each file is read in this browser by DOC OCR Module, so a passport goes to no third party, then sorted by type and uploaded. The fields below fill themselves:
// empty fields only, and a difference is reported, never overwritten. A file the reader is unsure of waits for the person to choose its type.
import { useRef, useState } from "react";
import { Badge, ErrorNote } from "@banking/components/shared";
import { readFiles } from "../services/ocrRead";
import { fromDocai, mergeOcr } from "../logic/ocrFill";
import { ACCEPT, FORM_DOC_TYPES, formTypeFor, itemText, sortDropped, summary } from "../logic/bulkUpload";

const TONE = { done: "good", failed: "bad", choose: "warn" };

// answers: what the form holds now. upload(file, type): stores one file. fill(answers): takes the merged answers; left out when the form cannot be changed.
export default function BulkUpload({ answers, labels = {}, upload, fill, onUploaded, title = "Drag and drop all your documents here", hint = "or click to choose. PDF, JPG or PNG, up to 10 MB each. We sort them and fill in the details below." }) {
  const [items, setItems] = useState([]);
  const [problems, setProblems] = useState([]);
  const [note, setNote] = useState(null);
  const [over, setOver] = useState(false);
  const input = useRef(null);
  const queue = useRef(Promise.resolve());
  const read = useRef([]);       // what has been read so far, so later files add to it
  const current = useRef(answers);
  current.current = answers;

  const change = (id, patch) => setItems((l) => l.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const store = async (id, file, type) => {
    change(id, { state: "uploading", type, error: null });
    try {
      await upload(file, type);
      change(id, { state: "done" });
      await onUploaded?.();
    } catch (e) { change(id, { state: "failed", error: e.message }); }
  };
  const fillFrom = () => {
    if (!fill) return;
    const out = fromDocai(read.current);
    const before = current.current || {};
    const { answers: merged, conflicts } = mergeOcr(before, out.read);
    const name = (k) => labels[k] || k;
    const filled = Object.keys(merged).filter((k) => merged[k] !== before[k]);
    if (filled.length) { current.current = merged; fill(merged); }
    setNote(summary(filled.map(name), conflicts.map((c) => name(c.key))) || null);
  };
  const work = async (id, file) => {
    change(id, { state: "reading", percent: 0 });
    let doc = null;
    try {
      [doc] = await readFiles([file], null, (p) => change(id, { percent: Math.floor(p) }));
      read.current.push(doc);
      fillFrom();
    } catch {
      // A file that cannot be read can still be uploaded: the person chooses its type.
    }
    const type = formTypeFor(doc);
    if (type) await store(id, file, type);
    else change(id, { state: "choose", label: doc?.label });
  };
  const add = (list) => {
    const { files, problems: bad } = sortDropped([...list], items.map((x) => x.file));
    setProblems(bad);
    const added = files.map((file) => ({ id: crypto.randomUUID(), file, state: "waiting" }));
    setItems((l) => [...l, ...added]);
    // One at a time: the reader runs in this browser, and a phone or an old PC would struggle with more.
    for (const it of added) queue.current = queue.current.then(() => work(it.id, it.file));
  };
  return (
    <div className="bk-mb">
      <ErrorNote message={problems.join(" ") || null} onClose={() => setProblems([])} />
      <button type="button" className={`bk-drop ${over ? "bk-drop-over" : ""}`} onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}>
        <strong>{title}</strong><br /><small className="bk-muted">{hint}</small>
      </button>
      <input ref={input} className="bk-file-input" type="file" hidden multiple accept={ACCEPT} aria-label="Choose documents to upload" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      {items.map((it) => (
        <div className="bk-row" key={it.id}>
          <span>{it.file.name}{it.type && ` · ${it.type}`}{it.error && <small className="bk-muted"> · {it.error}</small>}</span>
          <span className="bk-actions">
            {it.state === "choose" || it.state === "failed"
              ? <select aria-label={`Type of ${it.file.name}`} value="" onChange={(e) => e.target.value && store(it.id, it.file, e.target.value)}>
                  <option value="">{it.state === "failed" ? "Try again as…" : "Choose the type…"}</option>
                  {FORM_DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              : <Badge tone={TONE[it.state]}>{itemText(it.state)}{it.state === "reading" && it.percent ? ` ${it.percent}%` : ""}</Badge>}
          </span>
        </div>
      ))}
      {note && <p className="bk-note bk-mt" role="status">{note}</p>}
    </div>
  );
}
