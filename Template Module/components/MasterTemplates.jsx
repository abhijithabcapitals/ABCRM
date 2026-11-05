// Settings: the master Word file behind each generated document.
import { useRef, useState } from "react";
import { Badge, Button, ErrorNote, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { loadMasterTemplates, templateBuffer, uploadMasterTemplate, useBuiltInTemplate } from "@banking/services/masterTemplates";
import { compareTags } from "@banking/logic/templateTags";

const TEMPLATES = [
  ["Service_Quotation_Template.docx", "Service Quotation", new URL("../templates/Service_Quotation_Template.docx", import.meta.url).href],
  ["Service_Engagement_Template.docx", "Service Engagement Letter", new URL("../templates/Service_Engagement_Template.docx", import.meta.url).href],
  ["Quotation_Template.docx", "Business Banking Quotation", new URL("../../Banking Module/templates/Quotation_Template.docx", import.meta.url).href],
  ["Engagement_Letter_Template.docx", "Business Banking Engagement Letter", new URL("../../Banking Module/templates/Engagement_Letter_Template.docx", import.meta.url).href],
  ["Fee_Receipt_Voucher_Template.docx", "Fee Receipt Voucher", new URL("../../Banking Module/templates/Fee_Receipt_Voucher_Template.docx", import.meta.url).href],
];

async function documentText(buffer) {
  const { default: PizZip } = await import("pizzip");
  const zip = new PizZip(buffer);
  return Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n)).map((n) => zip.file(n).asText()).join("");
}

// A file the generator cannot read is refused here, before anyone relies on it.
async function checkFile(file, url) {
  const buffer = await file.arrayBuffer();
  const [{ default: PizZip }, { default: Docxtemplater }] = await Promise.all([import("pizzip"), import("docxtemplater")]);
  try { new Docxtemplater(new PizZip(buffer), { paragraphLoop: true, linebreaks: true }); } catch { throw new Error(`${file.name} cannot be used: it is not a valid Word file, or a {tag} in it is broken.`); }
  if (!url) return { missing: [], unknown: [] };   // no built-in copy to compare with
  const base = await (await fetch(url)).arrayBuffer();
  return compareTags(await documentText(base), await documentText(buffer));
}

export default function MasterTemplates({ manage }) {
  const current = useLoad(loadMasterTemplates, []);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [review, setReview] = useState(null);
  const input = useRef(null);
  const [target, setTarget] = useState(null);

  const act = async (key, fn) => {
    setBusy(key); setError(null);
    try { await fn(); await current.reload(); } catch (e) { setError(e.message); }
    setBusy(null);
  };
  const download = (file, url) => act(`d-${file}`, async () => {
    const row = current.data?.[file];
    const blob = new Blob([await templateBuffer(file, url)]);
    const { saveAs } = await import("file-saver");
    saveAs(blob, row?.storage_path ? row.file_name : file);
  });
  const chosen = async (f) => {
    if (input.current) input.current.value = "";
    if (!f) return;
    const [file, label, url] = target;
    if (!/\.docx$/i.test(f.name)) { setError("A master template must be a Word (.docx) file."); return; }
    setBusy(`u-${file}`); setError(null);
    try {
      const diff = await checkFile(f, url);
      setBusy(null);
      if (diff.missing.length || diff.unknown.length) { setReview({ file, label, f, ...diff }); return; }
      await act(`u-${file}`, () => uploadMasterTemplate(file, f));
    } catch (e) { setError(e.message); setBusy(null); }
  };

  return (
    <Panel title="Master templates" sub="The Word file each generated document is built from. Download the current one, edit it and keep its {tags}, then upload it. New documents use it; ones already generated do not change.">
      <ErrorNote message={error || current.error} onClose={() => setError(null)} />
      <input ref={input} type="file" accept=".docx" hidden aria-label="Master template file" onChange={(e) => chosen(e.target.files[0])} />
      {current.loading && !current.data ? <Spinner /> : TEMPLATES.map(([file, label, url]) => {
        const row = current.data?.[file];
        return (
          <div className="bk-row" key={file}>
            <span><strong>{label}:</strong> {row?.storage_path ? <>{row.file_name} <small className="bk-muted">uploaded {fmtDate(row.uploaded_at)}</small></> : <Badge>Built-in</Badge>}</span>
            <span className="bk-actions">
              {(url || row?.storage_path) && <Button busy={busy === `d-${file}`} onClick={() => download(file, url)}>Download</Button>}
              {manage && <Button variant="primary" busy={busy === `u-${file}`} onClick={() => { setTarget([file, label, url]); input.current?.click(); }}>Upload</Button>}
              {manage && url && row?.storage_path && <Button busy={busy === `b-${file}`} onClick={() => act(`b-${file}`, () => useBuiltInTemplate(file))}>Use built-in</Button>}
            </span>
          </div>
        );
      })}
      {review && (
        <div className="bk-alert bk-alert-warn bk-mt">
          <strong>{review.f.name} differs from the {review.label} template.</strong>
          {review.missing.length > 0 && <p>Details that will not appear: {review.missing.join(", ")}.</p>}
          {review.unknown.length > 0 && <p>Tags the CRM does not fill, which will come out blank: {review.unknown.join(", ")}.</p>}
          <div className="bk-actions"><Button variant="primary" onClick={() => { const r = review; setReview(null); act(`u-${r.file}`, () => uploadMasterTemplate(r.file, r.f)); }}>Use this file anyway</Button><Button onClick={() => setReview(null)}>Cancel</Button></div>
        </div>
      )}
    </Panel>
  );
}
