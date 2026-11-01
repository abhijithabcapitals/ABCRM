// Admin triggers: run one task from the server's catalogue on a timer. The rules are enforced in Admin Base 002_triggers.sql.
import { useEffect, useState } from "react";
import { Badge, Button, DataTable, ErrorNote, Modal, Panel, Spinner, useLoad } from "@banking/components/shared";
import { flagMissing } from "@banking/components/Attention";
import { supabase } from "../supabase";
import { INTERVALS, KINDS, WEEKDAYS, blankForm, dubaiParts, everyLabel, formFromTrigger, formProblems, formToArgs, formToTrigger, scheduleText } from "./triggerSchedule";

const call = async (name, args) => { const { data, error } = await supabase.rpc(name, args); if (error) throw new Error(error.message); return data; };
const when = (d) => (d ? new Date(d).toLocaleString("en-AE", { timeZone: "Asia/Dubai", dateStyle: "medium", timeStyle: "short" }) : "–");
const toneOf = (status) => ({ succeeded: "good", failed: "bad" }[status]);
const stateOf = (t) => (t.finished_at ? ["Finished", undefined] : t.active ? ["Running", "good"] : ["Paused", "warn"]);

function TriggerForm({ trigger, catalogue, serverNow, onClose, onSaved }) {
  const today = dubaiParts(serverNow).date;
  const [f, setF] = useState(() => (trigger ? formFromTrigger(trigger, today) : blankForm(today)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const history = useLoad(() => (trigger ? call("admin_trigger_history", { p_id: trigger.id }) : Promise.resolve([])), [trigger?.id]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const task = catalogue.find((c) => c.key === f.task_key && !c.unavailable);
  const toggleDay = (d) => setF((s) => ({ ...s, weekdays: s.weekdays.includes(d) ? s.weekdays.filter((x) => x !== d) : [...s.weekdays, d] }));
  const problems = formProblems(f, task);
  const canPreview = !problems.some(([id]) => ["tr-date", "tr-time", "tr-days", "tr-day"].includes(id));
  const submit = async () => {
    if (problems.length) { setError(`Please provide ${problems.map((p) => p[1]).join(", ")}.`); flagMissing(problems.map((p) => p[0])); return; }
    setBusy(true); setError(null);
    try { await call("admin_trigger_save", formToArgs(f, trigger?.id || null)); await onSaved(); onClose(); } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <Modal wide title={trigger ? `Edit ${trigger.name}` : "New trigger"} onClose={onClose}>
      <ErrorNote message={error || history.error} onClose={() => setError(null)} />
      <div className="bk-grid">
        <div className="bk-field bk-full"><label htmlFor="tr-name">Name <em>*</em></label><input id="tr-name" maxLength={80} value={f.name} onChange={set("name")} placeholder="Example: Morning mail sync" /></div>
        <div className="bk-field bk-full">
          <label htmlFor="tr-task">Task <em>*</em></label>
          <select id="tr-task" value={f.task_key} onChange={set("task_key")}>
            <option value="">Select…</option>
            {catalogue.map((c) => <option key={c.key} value={c.key} disabled={!!c.unavailable}>{c.label}{c.unavailable ? " (not available yet)" : ""}</option>)}
          </select>
          {task && <small>{task.description}</small>}
        </div>
        {task?.warning && <div className="bk-alert bk-alert-warn bk-full">{task.warning}</div>}
        <div className="bk-field bk-full">
          <label htmlFor="tr-kind">When <em>*</em></label>
          <select id="tr-kind" value={f.kind} onChange={set("kind")}>{KINDS.filter((k) => !(task?.at_most_daily && k.value === "interval")).map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select>
        </div>
        {f.kind === "once" && <div className="bk-field"><label htmlFor="tr-date">Date <em>*</em></label><input id="tr-date" type="date" min={today} value={f.date} onChange={set("date")} /></div>}
        {f.kind === "interval" && <div className="bk-field"><label htmlFor="tr-every">Every <em>*</em></label><select id="tr-every" value={f.every_minutes} onChange={(e) => setF((s) => ({ ...s, every_minutes: Number(e.target.value) }))}>{INTERVALS.map((m) => <option key={m} value={m}>{everyLabel(m).replace("Every ", "")}</option>)}</select></div>}
        {f.kind === "monthly" && <div className="bk-field"><label htmlFor="tr-day">Day of the month <em>*</em></label><input id="tr-day" type="number" min={1} max={31} value={f.month_day} onChange={set("month_day")} /><small>A shorter month runs on its last day.</small></div>}
        {f.kind === "weekly" && <div className="bk-field bk-full" id="tr-days"><label>Days <em>*</em></label><div className="bk-filter">{WEEKDAYS.map(([d, label]) => <button type="button" key={d} aria-pressed={f.weekdays.includes(d)} className={`bk-chip ${f.weekdays.includes(d) ? "active" : ""}`} onClick={() => toggleDay(d)}>{label}</button>)}</div></div>}
        {f.kind !== "interval" && <div className="bk-field"><label htmlFor={f.kind === "once" ? "tr-once-time" : "tr-time"}>Time, Dubai <em>*</em></label><input id={f.kind === "once" ? "tr-once-time" : "tr-time"} type="time" value={f.time} onChange={set("time")} /></div>}
      </div>
      <p className="bk-note bk-mt">{canPreview ? <><strong>{scheduleText(formToTrigger(f))}</strong>, Dubai time.</> : "Complete the schedule to see it here."}</p>
      {trigger && <>
        <h4 className="bk-subhead">Recent runs</h4>
        {history.loading && !history.data ? <Spinner /> : <DataTable rows={history.data || []} empty="Not run yet." pageSize={5} columns={[
          { key: "started_at", label: "Started", render: (r) => when(r.started_at) }, { key: "source", label: "Started by", render: (r) => (r.source === "manual" ? "Run now" : "Schedule") },
          { key: "status", label: "Result", render: (r) => <Badge tone={toneOf(r.status)}>{r.status}</Badge> }, { key: "detail", label: "Detail", render: (r) => r.detail || "–" },
        ]} />}
      </>}
      <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={submit}>{trigger ? "Save" : "Create trigger"}</Button></div>
    </Modal>
  );
}

function Confirm({ title, children, label, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const go = async () => { setBusy(true); try { await onConfirm(); onClose(); } catch (e) { setError(e.message); setBusy(false); } };
  return (
    <Modal title={title} onClose={onClose}>
      <ErrorNote message={error} />
      {children}
      <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={go}>{label}</Button></div>
    </Modal>
  );
}

export function TriggersPanel({ onChanged }) {
  const list = useLoad(() => call("admin_trigger_list"), []);
  const [edit, setEdit] = useState(null);
  const [ask, setAsk] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const d = list.data;
  const catalogue = d?.catalogue || [];
  const taskOf = (key) => catalogue.find((c) => c.key === key);
  const running = (d?.triggers || []).some((t) => t.last_status === "running");
  // Edge Functions answer after the call returns, so keep looking until they have.
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => list.reload(), 10000);
    return () => clearInterval(timer);
  }, [running, list.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = async () => { await list.reload(); await onChanged?.(); };
  const pause = async (t) => {
    setBusy(t.id); setError(null);
    try { await call("admin_trigger_set_active", { p_id: t.id, p_active: !t.active }); await refresh(); } catch (e) { setError(e.message); }
    setBusy(null);
  };
  if (list.error && /could not find the function/i.test(list.error)) return <Panel title="Triggers"><div className="bk-alert bk-alert-warn">Triggers are not set up on the database yet. Apply Admin Base migration 002_triggers.sql.</div></Panel>;
  const unavailable = catalogue.filter((c) => c.unavailable);
  return (
    <Panel title="Triggers" sub="Run a CRM task on a timer. All times are Dubai time (UTC+4)." actions={<Button variant="primary" disabled={!d} onClick={() => setEdit({})}>+ New trigger</Button>}>
      <ErrorNote message={list.error || error} onClose={() => setError(null)} />
      {d && d.dispatcher_active !== true && <div className="bk-alert bk-alert-warn">{d.dispatcher_active === false ? "The admin-trigger-dispatcher job is paused, so no trigger runs on time until it is resumed below." : "The admin-trigger-dispatcher job is missing, so no trigger runs on time."} Run now still works.</div>}
      {list.loading && !d ? <Spinner /> : <DataTable rows={d?.triggers || []} empty="No triggers yet." columns={[
        { key: "name", label: "Trigger", render: (t) => <span><strong>{t.name}</strong><small className="bk-admin-detail">{taskOf(t.task_key)?.label || t.task_key}{taskOf(t.task_key)?.ai_spend ? " · spends OpenRouter credit" : ""}</small></span> },
        { key: "kind", label: "Schedule", render: (t) => <span>{scheduleText(t)}<small className="bk-admin-detail">{t.next_run_at ? `Next: ${when(t.next_run_at)}` : "Not scheduled"}</small></span> },
        { key: "last_run_at", label: "Last run", render: (t) => when(t.last_run_at) },
        { key: "last_status", label: "Last result", render: (t) => (t.last_status ? <span><Badge tone={toneOf(t.last_status)}>{t.last_status}</Badge>{t.last_status === "failed" && t.last_detail && <small className="bk-admin-detail">{t.last_detail}</small>}</span> : "–") },
        { key: "active", label: "State", render: (t) => { const [word, tone] = stateOf(t); return <Badge tone={tone}>{word}</Badge>; } },
        { key: "a", label: "", render: (t) => <span className="bk-actions">
          <Button disabled={t.last_status === "running" || !!taskOf(t.task_key)?.unavailable} onClick={() => setAsk({ type: "run", t })}>Run now</Button>
          {!t.finished_at && <Button busy={busy === t.id} onClick={() => pause(t)}>{t.active ? "Pause" : "Resume"}</Button>}
          <Button onClick={() => setEdit(t)}>Edit</Button>
          <Button onClick={() => setAsk({ type: "delete", t })}>Delete</Button>
        </span> },
      ]} />}
      {unavailable.length > 0 && <details className="bk-mt"><summary className="bk-note">Requested tasks that cannot be scheduled yet ({unavailable.length})</summary>{unavailable.map((c) => <div className="bk-row" key={c.key}><span><strong>{c.label}</strong><small className="bk-admin-detail">{c.unavailable}</small></span><Badge>No backend yet</Badge></div>)}</details>}
      {edit && <TriggerForm trigger={edit.id ? edit : null} catalogue={catalogue} serverNow={d?.now} onClose={() => setEdit(null)} onSaved={refresh} />}
      {ask?.type === "run" && <Confirm title={`Run ${ask.t.name} now?`} label="Run now" onClose={() => setAsk(null)} onConfirm={async () => { await call("admin_trigger_run_now", { p_id: ask.t.id }); await refresh(); }}>
        <p>{taskOf(ask.t.task_key)?.label}. The schedule stays as it is.</p>{taskOf(ask.t.task_key)?.warning && <div className="bk-alert bk-alert-warn">{taskOf(ask.t.task_key).warning}</div>}
      </Confirm>}
      {ask?.type === "delete" && <Confirm title={`Delete ${ask.t.name}?`} label="Delete" onClose={() => setAsk(null)} onConfirm={async () => { await call("admin_trigger_delete", { p_id: ask.t.id }); await refresh(); }}>
        <p>The trigger and its run history are removed. This cannot be undone. The audit log keeps a record.</p>
      </Confirm>}
    </Panel>
  );
}
