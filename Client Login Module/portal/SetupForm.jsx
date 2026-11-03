// The one form a client fills in. It saves as they go, and stays locked once submitted until staff return it.
import { useEffect, useRef, useState } from "react";
import { Badge, Button, ErrorNote, Panel } from "@banking/components/shared";
import { formProgress, visibleDocuments, visibleSections } from "@business-setup/logic/formDefinition";

const STATUS = { Draft: "Not submitted", Submitted: "Submitted: waiting for review", "In review": "Under review", Returned: "Returned: please fix and resubmit", Validated: "Accepted: KYC done" };
const DOC = { pending: "Received", in_review: "Under review", validated: "Accepted", rejected: "Please re-upload" };

function Input({ field, value, onChange, disabled, id }) {
  if (field.type === "multi") {
    const v = value || [];
    return <div>{field.options.map((o) => <label className="bk-check" key={o}><input type="checkbox" disabled={disabled} checked={v.includes(o)} onChange={(e) => onChange(e.target.checked ? [...v, o] : v.filter((x) => x !== o))} /> {o}</label>)}</div>;
  }
  if (field.type === "choice") return <select id={id} disabled={disabled} value={value || ""} onChange={(e) => onChange(e.target.value)}><option value="">Select…</option>{field.options.map((o) => <option key={o}>{o}</option>)}</select>;
  if (field.type === "boolean") return <input id={id} type="checkbox" disabled={disabled} checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
  const type = { email: "email", tel: "tel", date: "date", number: "number" }[field.type] || "text";
  return <input id={id} type={type} disabled={disabled} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
}

export default function SetupForm({ form, api, onChange }) {
  const [answers, setAnswers] = useState(form.answers || {});
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(null);
  const timer = useRef(null);
  const latest = useRef(answers);
  const editable = ["Draft", "Returned"].includes(form.status);
  const progress = formProgress(form.definition, answers, form.documents);

  useEffect(() => () => clearTimeout(timer.current), []);
  const update = (next) => {
    setAnswers(next);
    latest.current = next;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSaving(true);
      try { await api.formSave(latest.current); setError(null); } catch (e) { setError(e.message); }
      setSaving(false);
    }, 800);
  };
  const set = (k, v) => update({ ...answers, [k]: v });
  const setRow = (key, i, k, v) => set(key, (answers[key] || []).map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const upload = async (type, file) => {
    if (!file) return;
    setBusy(type); setError(null);
    try { await api.formUpload(file, type); await onChange(); } catch (e) { setError(e.message); }
    setBusy(null);
  };
  const submit = async () => {
    setBusy("submit"); setError(null);
    clearTimeout(timer.current);
    try { await api.formSave(latest.current); await api.formSubmit(); await onChange(); } catch (e) { setError(e.message); }
    setBusy(null);
  };
  return (
    <Panel title="Your details and documents" sub={STATUS[form.status]} actions={saving ? <small className="bk-muted" role="status">Saving…</small> : null}>
      <ErrorNote message={error} onClose={() => setError(null)} />
      {form.status === "Returned" && form.return_note && <div className="bk-alert bk-alert-warn">Message from AB Capital: {form.return_note}</div>}
      {visibleSections(form.definition, answers).map((s) => (
        <fieldset className="bk-fieldset" key={s.key} disabled={!editable}>
          <legend>{s.title}</legend>
          {s.type === "repeat" ? <>
            {(answers[s.key] || []).map((row, i) => (
              <div className="bk-grid bk-mb" key={i}>
                {s.fields.map((f) => <div className="bk-field" key={f.key}><label htmlFor={`pf-${s.key}-${i}-${f.key}`}>{f.label}{f.required && <em> *</em>}</label><Input id={`pf-${s.key}-${i}-${f.key}`} field={f} disabled={!editable} value={row[f.key]} onChange={(v) => setRow(s.key, i, f.key, v)} /></div>)}
                {editable && <div className="bk-field"><Button onClick={() => set(s.key, (answers[s.key] || []).filter((_, j) => j !== i))}>Remove</Button></div>}
              </div>
            ))}
            {editable && <Button onClick={() => set(s.key, [...(answers[s.key] || []), {}])}>+ Add</Button>}
          </> : (
            <div className="bk-grid">
              {s.fields.map((f) => <div className={`bk-field ${f.type === "multi" ? "bk-full" : ""}`} key={f.key}><label htmlFor={`pf-${f.key}`}>{f.label}{f.required && <em> *</em>}</label><Input id={`pf-${f.key}`} field={f} disabled={!editable} value={answers[f.key]} onChange={(v) => set(f.key, v)} /></div>)}
            </div>
          )}
        </fieldset>
      ))}
      {visibleDocuments(form.definition, answers).map((g) => (
        <fieldset className="bk-fieldset" key={g.group}>
          <legend>{g.group}{g.one_of && <small className="bk-muted"> (at least one)</small>}</legend>
          {g.types.map((t) => {
            const docs = (form.documents || []).filter((d) => d.doc_type === t.type);
            return (
              <div className="bk-row" key={t.type}>
                <span><strong>{t.type}</strong>{t.required && <em> *</em>}{docs.map((d) => <span key={d.id}> · {d.file_name} <Badge tone={d.status === "validated" ? "good" : d.status === "rejected" ? "bad" : "warn"}>{DOC[d.status]}</Badge>{d.review_note && ` ${d.review_note}`}</span>)}</span>
                {editable && <label className="bk-btn">{busy === t.type ? "Uploading…" : "Upload"}<input type="file" hidden aria-label={`Upload ${t.type}`} accept=".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff" disabled={busy === t.type} onChange={(e) => { upload(t.type, e.target.files[0]); e.target.value = ""; }} /></label>}
              </div>
            );
          })}
        </fieldset>
      ))}
      {editable && <>
        {!progress.complete && <p className="bk-note">Still needed: {progress.missing.join(", ")}.</p>}
        <div className="bk-modal-actions"><Button variant="primary" busy={busy === "submit"} disabled={!progress.complete} onClick={submit}>Submit</Button></div>
      </>}
    </Panel>
  );
}
