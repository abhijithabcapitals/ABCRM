// The admin's technical panel in Settings: health, members, employees, AI usage, storage, jobs and the audit log.
import { useEffect, useMemo, useRef, useState } from "react";
import "@banking/components/banking.css";
import { Badge, Button, DataTable, ErrorNote, FormModal, Modal, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { flagMissing } from "@banking/components/Attention";
import { supabase } from "../supabase";
import { DATA_ROLES, GRANTABLE_TABS, NEEDS_DATA_ROLE, toggleAllTabs } from "../tabs";
import { TriggersPanel } from "./AdminTriggers";
import { cronText } from "./triggerSchedule";
import { EMP_FIELDS } from "../empFields";
import { ACTION_LABEL, adminActionLabel, adminDetail, adminPerson, auditDetail, auditFields, auditPeople, auditPersonFilter, auditWho, cleanSearch, dayEnd, dayStart } from "./auditTrail";

const CLIENT_MODULE_URL = (import.meta.env.VITE_CLIENT_MODULE_URL || "http://127.0.0.1:8792").replace(/\/$/, "");
const Clip = ({ text }) => <span className="bk-clip" title={text}>{text}</span>;
const check = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const call = async (name, args) => check(await supabase.rpc(name, args));
async function adminUsers(body) {
  const { data, error } = await supabase.functions.invoke("admin-users", { body });
  if (data?.error) throw new Error(data.error);
  if (error) throw new Error(error.message?.includes("Failed to send") ? "The admin-users function is not reachable." : error.message);
  return data;
}
export const bytes = (n) => { if (n == null) return "–"; const u = ["B", "KB", "MB", "GB", "TB"]; let v = Number(n), i = 0; while (v >= 1024 && i < 4) { v /= 1024; i++; } return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`; };
const num = (n) => Number(n || 0).toLocaleString("en-AE");
const usd = (n) => `$${Number(n || 0).toFixed(Number(n) < 1 ? 4 : 2)}`;
const when = (d) => (d ? new Date(d).toLocaleString("en-AE", { timeZone: "Asia/Dubai", dateStyle: "medium", timeStyle: "short" }) : "–");
// One-line tables: the year shows only when it is not this year.
const whenShort = (d) => (d ? new Date(d).toLocaleString("en-AE", { timeZone: "Asia/Dubai", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", ...(new Date(d).getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) }) : "–");
const minutesAgo = (d) => (d ? (Date.now() - new Date(d)) / 60000 : Infinity);

function Stat({ label, value, sub }) {
  return <div className="bk-admin-stat"><span>{label}</span><strong>{value ?? "–"}</strong>{sub && <small>{sub}</small>}</div>;
}
function CheckRow({ state, label, detail }) {
  const tone = { ok: "good", warn: "warn", bad: "bad", off: undefined }[state];
  const word = { ok: "Healthy", warn: "Check", bad: "Problem", off: "Not checked" }[state];
  return <div className="bk-row"><span><strong>{label}</strong>{detail && <small className="bk-admin-detail">{detail}</small>}</span><Badge tone={tone}>{word}</Badge></div>;
}

export function HealthPanel() {
  const health = useLoad(() => call("admin_health"), []);
  const jobs = useLoad(() => call("admin_jobs"), []);
  const [probe, setProbe] = useState({});
  const run = async () => {
    const t = performance.now();
    await supabase.from("profiles").select("id").limit(1);
    const db = Math.round(performance.now() - t);
    let local = false;
    try { local = (await fetch(`${CLIENT_MODULE_URL}/api/health`, { signal: AbortSignal.timeout(3000) })).ok; } catch { /* not running on this PC */ }
    let openrouter = null;
    try { openrouter = await adminUsers({ action: "openrouter_status" }); } catch (e) { openrouter = { error: e.message }; }
    setProbe({ db, local, openrouter });
  };
  useEffect(() => { run(); }, []);
  const h = health.data;
  if (health.loading && !h) return <Spinner />;
  const e = h?.email || {};
  const failing = (jobs.data || []).filter((j) => j.active && (j.failed_24h > 0 || j.last_status === "failed"));
  const or = probe.openrouter;
  const remaining = or?.limit_remaining;
  return (
    <div>
      <ErrorNote message={health.error || jobs.error} />
      <div className="bk-actions bk-mb"><Button onClick={() => { health.reload(); jobs.reload(); run(); }}>Run checks again</Button><small className="bk-muted">Checked {when(h?.generated_at)}</small></div>
      <div className="bk-admin-stats">
        <Stat label="Database size" value={bytes(h?.db_size_bytes)} />
        <Stat label="Database response" value={probe.db != null ? `${probe.db} ms` : "…"} sub="from this browser" />
        <Stat label="Connections" value={h ? `${h.connections} / ${h.max_connections}` : null} />
        <Stat label="Cache hit rate" value={h?.cache_hit_percent != null ? `${h.cache_hit_percent}%` : null} />
        <Stat label="Members" value={h?.members} sub={`${h?.active_7d ?? 0} signed in, last 7 days`} />
      </div>
      <Panel title="Health checks">
        <CheckRow state={h?.slow_queries ? "warn" : "ok"} label="Database queries" detail={`${h?.slow_queries ?? 0} running over 1 minute`} />
        <CheckRow state={h?.tables_without_rls?.length ? "bad" : "ok"} label="Row security on public tables" detail={h?.tables_without_rls?.length ? `Without row security: ${h.tables_without_rls.join(", ")}` : "All tables protected"} />
        <CheckRow state={failing.length ? "bad" : "ok"} label="Scheduled jobs" detail={failing.length ? `Failing: ${failing.map((j) => j.jobname).join(", ")}` : `${(jobs.data || []).filter((j) => j.active).length} running`} />
        <CheckRow state={e.last_sync == null ? "off" : minutesAgo(e.last_sync) > 15 ? "bad" : e.folder_errors ? "warn" : "ok"} label="Email sync" detail={`Last sync ${when(e.last_sync)}. ${e.folder_errors ?? 0} folder(s) with errors.`} />
        <CheckRow state={e.agent_last_run == null ? "off" : e.agent_errors_24h ? "warn" : "ok"} label="Email Agent" detail={`Last run ${when(e.agent_last_run)}. ${e.agent_errors_24h ?? 0} run(s) with errors in 24 hours.${e.agent_last_error ? ` Latest: ${e.agent_last_error}` : ""}`} />
        <CheckRow state={e.summaries_waiting_7d > 50 ? "warn" : "ok"} label="Email summaries waiting" detail={`${num(e.summaries_waiting_7d)} from the last 7 days, ${num(e.summaries_waiting_all)} in all`} />
        <CheckRow state={!or ? "off" : or.error ? "bad" : remaining != null && remaining <= 0 ? "bad" : "ok"} label="OpenRouter key" detail={!or ? "Checking…" : or.error ? or.error : `Used ${usd(or.usage)}${or.limit != null ? ` of ${usd(or.limit)}, ${usd(remaining)} left` : ", no limit set on this key"}`} />
        <CheckRow state={probe.local === undefined ? "off" : probe.local ? "ok" : "off"} label="Client Module on this PC" detail={probe.local ? "Running: reading documents and saving to folders work here" : "Not running here: reading documents and saving to folders are unavailable on this PC"} />
      </Panel>
    </div>
  );
}

export function AiUsagePanel() {
  const [days, setDays] = useState(30);
  const usage = useLoad(() => call("admin_ai_usage", { p_days: days }), [days]);
  const u = usage.data;
  const tokens = (r) => num(Number(r.prompt) + Number(r.completion));
  const maxCost = Math.max(...(u?.by_day || []).map((d) => Number(d.cost)), 0.000001);
  return (
    <div>
      <ErrorNote message={usage.error} />
      <div className="bk-filter">{[1, 7, 30, 90].map((d) => <button type="button" key={d} aria-pressed={days === d} className={`bk-chip ${days === d ? "active" : ""}`} onClick={() => setDays(d)}>{d === 1 ? "Today" : `${d} days`}</button>)}</div>
      {usage.loading && !u ? <Spinner /> : (
        <>
          <div className="bk-admin-stats">
            <Stat label="Cost" value={usd(u?.total?.cost)} />
            <Stat label="Model calls" value={num(u?.total?.calls)} />
            <Stat label="Tokens sent" value={num(u?.total?.prompt)} sub={`${num(u?.total?.cached)} from cache`} />
            <Stat label="Tokens received" value={num(u?.total?.completion)} sub={`${num(u?.total?.reasoning)} on reasoning`} />
          </div>
          {!u?.first_logged && <p className="bk-note">Nothing recorded yet. Usage is logged from the first OpenRouter call after this release. Earlier spending is only in OpenRouter.</p>}
          <Panel title="By task"><DataTable rows={(u?.by_task || []).map((r) => ({ ...r, id: r.name }))} empty="No calls." columns={[{ key: "name", label: "Task" }, { key: "calls", label: "Calls", right: true, render: (r) => num(r.calls) }, { key: "tokens", label: "Tokens", right: true, render: tokens }, { key: "cost", label: "Cost", right: true, render: (r) => usd(r.cost) }]} /></Panel>
          <Panel title="By member" sub="Automatic means scheduled work that no person started."><DataTable rows={(u?.by_member || []).map((r) => ({ ...r, id: r.id || "auto" }))} empty="No calls." columns={[{ key: "name", label: "Member" }, { key: "calls", label: "Calls", right: true, render: (r) => num(r.calls) }, { key: "tokens", label: "Tokens", right: true, render: tokens }, { key: "cost", label: "Cost", right: true, render: (r) => usd(r.cost) }]} /></Panel>
          <Panel title="By day">{(u?.by_day || []).map((d) => <div className="bk-admin-bar" key={d.day}><span>{fmtDate(d.day)}</span><i style={{ width: `${(Number(d.cost) / maxCost) * 100}%` }} /><b>{usd(d.cost)} · {num(d.calls)} calls</b></div>)}{!(u?.by_day || []).length && <p className="bk-note">No calls.</p>}</Panel>
          <Panel title="By model"><DataTable rows={(u?.by_model || []).map((r) => ({ ...r, id: r.name }))} empty="No calls." columns={[{ key: "name", label: "Model" }, { key: "calls", label: "Calls", right: true, render: (r) => num(r.calls) }, { key: "cost", label: "Cost", right: true, render: (r) => usd(r.cost) }]} /></Panel>
        </>
      )}
    </div>
  );
}

export function StoragePanel() {
  const s = useLoad(() => call("admin_storage"), []);
  if (s.loading && !s.data) return <Spinner />;
  const total = (s.data?.buckets || []).reduce((a, b) => a + Number(b.bytes), 0);
  return (
    <div>
      <ErrorNote message={s.error} />
      <div className="bk-admin-stats"><Stat label="Database" value={bytes(s.data?.db_size_bytes)} /><Stat label="File storage" value={bytes(total)} sub={`${num((s.data?.buckets || []).reduce((a, b) => a + Number(b.files), 0))} files`} /></div>
      <Panel title="File storage by bucket"><DataTable rows={(s.data?.buckets || []).map((b) => ({ ...b, id: b.name }))} empty="No files." columns={[{ key: "name", label: "Bucket" }, { key: "files", label: "Files", right: true, render: (b) => num(b.files) }, { key: "bytes", label: "Size", right: true, render: (b) => bytes(b.bytes) }]} /></Panel>
      <Panel title="Largest tables"><DataTable search="Search tables…" rows={(s.data?.tables || []).map((t) => ({ ...t, id: `${t.schema}.${t.name}` }))} columns={[{ key: "schema", label: "Schema" }, { key: "name", label: "Table" }, { key: "rows", label: "Rows (approx.)", right: true, render: (t) => num(Math.max(0, t.rows)) }, { key: "bytes", label: "Size", right: true, render: (t) => bytes(t.bytes) }]} /></Panel>
    </div>
  );
}

export function JobsPanel() {
  const jobs = useLoad(() => call("admin_jobs"), []);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const toggle = async (j) => {
    setBusy(j.jobid); setError(null);
    try { await call("admin_job_set_active", { p_job: j.jobid, p_active: !j.active }); await jobs.reload(); } catch (e) { setError(e.message); }
    setBusy(null);
  };
  return (
    <div>
      <ErrorNote message={jobs.error || error} onClose={() => setError(null)} />
      <TriggersPanel onChanged={jobs.reload} />
      <h4 className="bk-subhead">System jobs</h4>
      <p className="bk-note">Background work on a schedule. Pausing email-base-sync or email-agent-run also stops the OpenRouter spending they cause, and stops new mail arriving or being checked until resumed. Pausing admin-trigger-dispatcher stops every trigger above. Times are Dubai time; the raw schedule beneath each is in UTC.</p>
      {jobs.loading && !jobs.data ? <Spinner /> : <DataTable rows={(jobs.data || []).map((j) => ({ ...j, id: j.jobid }))} empty="No scheduled jobs." columns={[
        { key: "jobname", label: "Job" }, { key: "schedule", label: "Schedule", render: (j) => <span>{cronText(j.schedule) || j.schedule}{cronText(j.schedule) && <small className="bk-admin-detail">{j.schedule} UTC</small>}</span> }, { key: "last_run", label: "Last run", render: (j) => when(j.last_run) },
        { key: "last_status", label: "Last result", render: (j) => (j.last_status ? <Badge tone={j.last_status === "succeeded" ? "good" : j.last_status === "failed" ? "bad" : undefined}>{j.last_status}</Badge> : "–") },
        { key: "failed_24h", label: "Failed, 24 hours", right: true }, { key: "active", label: "State", render: (j) => <Badge tone={j.active ? "good" : "warn"}>{j.active ? "Running" : "Paused"}</Badge> },
        { key: "a", label: "", render: (j) => <Button busy={busy === j.jobid} onClick={() => toggle(j)}>{j.active ? "Pause" : "Resume"}</Button> },
      ]} />}
    </div>
  );
}

export function AuditPanel() {
  const log = useLoad(async () => check(await supabase.from("admin_audit").select("*").order("id", { ascending: false }).limit(500)), []);
  const people = useLoad(async () => check(await supabase.from("profiles").select("id, full_name, email")), []);
  const [action, setAction] = useState("");
  const [who, setWho] = useState("");
  const rows = useMemo(() => {
    const names = Object.fromEntries((people.data || []).map((p) => [p.id, p.full_name || p.email]));
    return (log.data || []).map((r) => ({
      id: r.id, at: r.at, action: r.action, actor: r.actor,
      whoText: adminPerson(r.actor, names),
      actionText: adminActionLabel(r.action),
      targetText: r.target ? adminPerson(r.target, names) : "–",
      detailText: adminDetail(r.detail, names),
    }));
  }, [log.data, people.data]);
  const distinct = (key, label) => [...new Map(rows.map((r) => [r[key], r[label]])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  const shown = rows.filter((r) => (!action || r.action === action) && (!who || r.actor === who));
  return (
    <div>
      <ErrorNote message={log.error || people.error} />
      <div className="bk-filter">
        <select aria-label="Action" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All actions</option>
          {distinct("action", "actionText").map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <select aria-label="Done by" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Everyone</option>
          {distinct("actor", "whoText").filter(([k]) => k).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </div>
      {log.loading && !log.data ? <Spinner /> : <div className="bk-oneline"><DataTable search="Search…" rows={shown} empty="No admin actions match." columns={[
        { key: "at", label: "When", width: 140, render: (r) => whenShort(r.at) },
        { key: "whoText", label: "Done by", width: 140, render: (r) => <Clip text={r.whoText} /> },
        { key: "actionText", label: "Action", width: 210, render: (r) => <Clip text={r.actionText} /> },
        { key: "targetText", label: "Target", width: "18%", render: (r) => <Clip text={r.targetText} /> },
        { key: "detailText", label: "Detail", render: (r) => <Clip text={r.detailText} /> },
      ]} /></div>}
    </div>
  );
}

export function AuditTrailPanel() {
  const blank = { person: "", who: "", table: "", action: "", from: "", to: "" };
  const [draft, setDraft] = useState(blank);
  const [filter, setFilter] = useState(blank);
  const [limit, setLimit] = useState(200);
  const [open, setOpen] = useState(null);
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const staff = useLoad(async () => auditPeople(
    check(await supabase.from("hr_employees").select("id, full_name, profile_id")),
    check(await supabase.from("profiles").select("id, full_name, email")),
  ), []);
  const list = useLoad(async () => {
    let q = supabase.from("audit_trail").select("*").order("id", { ascending: false }).limit(limit);
    const who = cleanSearch(filter.who);
    const table = cleanSearch(filter.table);
    const person = (staff.data || []).find((p) => p.key === filter.person);
    if (person) q = q.or(auditPersonFilter(person));
    if (who) q = q.or(`actor_name.ilike.*${who}*,actor_email.ilike.*${who}*`);
    if (table) q = q.ilike("table_name", `%${table}%`);
    if (filter.action) q = q.eq("action", filter.action);
    if (filter.from) q = q.gte("at", dayStart(filter.from));
    if (filter.to) q = q.lte("at", dayEnd(filter.to));
    return check(await q);
  }, [filter, limit, staff.data]);
  const rows = list.data || [];
  return (
    <div>
      <ErrorNote message={list.error || staff.error} />
      <p className="bk-note">Every add, change, delete, login, logout, page opened and click, with who did it. Entries cannot be edited. Clicks and page opens go after 12 months; the rest is kept forever. Passwords, tokens and keys show as [hidden]; private mail tables show the fields changed, without values.</p>
      <div className="bk-grid bk-mb">
        <div className="bk-field"><label htmlFor="at-person">Employee</label><select id="at-person" value={draft.person} onChange={set("person")}><option value="">All</option>{(staff.data || []).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></div>
        <div className="bk-field"><label htmlFor="at-who">User search</label><input id="at-who" autoComplete="off" placeholder="Name or email" value={draft.who} onChange={set("who")} /></div>
        <div className="bk-field"><label htmlFor="at-table">Table or page</label><input id="at-table" autoComplete="off" placeholder="For example banking_cases" value={draft.table} onChange={set("table")} /></div>
        <div className="bk-field"><label htmlFor="at-action">Action</label><select id="at-action" value={draft.action} onChange={set("action")}><option value="">All</option>{Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="bk-field"><label htmlFor="at-from">From</label><input id="at-from" type="date" value={draft.from} onChange={set("from")} /></div>
        <div className="bk-field"><label htmlFor="at-to">To</label><input id="at-to" type="date" value={draft.to} onChange={set("to")} /></div>
      </div>
      <div className="bk-actions bk-mb"><Button variant="primary" onClick={() => { setLimit(200); setFilter(draft); }}>Apply filters</Button><Button onClick={() => { setDraft(blank); setLimit(200); setFilter(blank); }}>Clear</Button></div>
      {list.loading && !list.data ? <Spinner /> : <DataTable search="Search the loaded entries…" rows={rows} onRow={setOpen} empty="No entries match." columns={[{ key: "at", label: "When", render: (r) => when(r.at) }, { key: "who", label: "User", render: auditWho }, { key: "action", label: "Action", render: (r) => <Badge tone={r.action === "DELETE" ? "warn" : r.action === "PAGE" || r.action === "CLICK" ? undefined : "good"}>{ACTION_LABEL[r.action]}</Badge> }, { key: "table_name", label: "Where" }, { key: "row_id", label: "Record", render: (r) => r.row_id || "–" }, { key: "changed", label: "Detail", render: auditDetail }]} />}
      {rows.length === limit && <div className="bk-actions bk-mt"><Button onClick={() => setLimit((n) => n + 200)}>Load 200 older entries</Button></div>}
      {open && (
        <Modal wide title={`${ACTION_LABEL[open.action]} in ${open.table_name}`} onClose={() => setOpen(null)}>
          <p className="bk-note">{auditWho(open)}{open.actor_email && open.actor_name ? ` (${open.actor_email})` : ""}, {when(open.at)}. Record {open.row_id || "–"}. Source: {open.source}.</p>
          <DataTable rows={auditFields(open)} empty="No field values recorded." columns={[{ key: "field", label: "Field" }, { key: "before", label: "Before" }, { key: "after", label: "After" }]} />
        </Modal>
      )}
    </div>
  );
}

const HEADINGS = { "employee code": "employee_code", "emp code": "employee_code", code: "employee_code", "full name": "full_name", name: "full_name", email: "work_email", "work email": "work_email", phone: "phone", mobile: "phone", department: "department", designation: "designation", "join date": "join_date", status: "status" };

const EMPLOYEE_COLUMNS = [{ key: "employee_code", label: "Code", width: 110 }, { key: "full_name", label: "Name", width: "20%", render: (e) => <Clip text={e.full_name} /> }, { key: "department", label: "Department", width: "14%", render: (e) => <Clip text={e.department || "–"} /> }, { key: "designation", label: "Designation", width: "14%", render: (e) => <Clip text={e.designation || "–"} /> }, { key: "work_email", label: "Email", render: (e) => <Clip text={e.work_email || "–"} /> }, { key: "status", label: "Status", width: 86, render: (e) => <Badge tone={e.status === "Active" ? "good" : "warn"}>{e.status}</Badge> }, { key: "profile_id", label: "CRM login", width: 104, render: (e) => (e.profile_id ? <Badge tone="good">Has login</Badge> : "–") }];

export function EmployeesPanel() {
  const list = useLoad(async () => check(await supabase.from("hr_employees").select("*").order("employee_code")), []);
  const active = (list.data || []).filter((e) => e.status !== "Left");
  const former = (list.data || []).filter((e) => e.status === "Left");
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const file = useRef(null);
  const save = async (v) => { check(await supabase.from("hr_employees").upsert({ ...(edit.id ? { id: edit.id } : {}), ...v, updated_at: new Date().toISOString() }, edit.id ? undefined : { onConflict: "employee_code" })); await list.reload(); };
  const importFile = async (f) => {
    setError(null); setNote(null);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" }).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [HEADINGS[k.trim().toLowerCase()], v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim() || null]).filter(([k]) => k)));
      const good = rows.filter((r) => r.employee_code && r.full_name);
      if (!good.length) throw new Error("No rows found. The file needs Employee Code and Full Name columns.");
      check(await supabase.from("hr_employees").upsert(good.map((r) => ({ status: "Active", ...r })), { onConflict: "employee_code" }));
      setNote(`${good.length} employee(s) saved.${rows.length > good.length ? ` ${rows.length - good.length} row(s) skipped: no code or name.` : ""}`);
      await list.reload();
    } catch (e) { setError(e.message); }
    if (file.current) file.current.value = "";
  };
  return (
    <div>
      <ErrorNote message={list.error || error} onClose={() => setError(null)} />
      {note && <div className="bk-alert bk-alert-ok">{note}</div>}
      <div className="bk-actions bk-mb"><Button variant="primary" onClick={() => setEdit({ status: "Active" })}>+ Add employee</Button><Button onClick={() => file.current?.click()}>Import Excel</Button><small className="bk-muted">Columns: Employee Code, Full Name, Email, Phone, Department, Designation, Join Date</small><input ref={file} type="file" hidden accept=".xlsx,.xls,.csv" aria-label="Employee file" onChange={(e) => e.target.files[0] && importFile(e.target.files[0])} /></div>
      {list.loading && !list.data ? <Spinner /> : <div className="bk-oneline">
        <Panel title={`Active Employees (${active.length})`}><DataTable search="Search code, name or department…" rows={active} onRow={setEdit} empty="No employees yet. Add or import them to onboard members." columns={EMPLOYEE_COLUMNS} /></Panel>
        {former.length > 0 && <Panel title={`Ex-Employees (${former.length})`}><DataTable search="Search code, name or department…" rows={former} onRow={setEdit} columns={EMPLOYEE_COLUMNS} /></Panel>}
      </div>}
      {edit && <FormModal wide title={edit.id ? `Edit ${edit.employee_code}` : "Add employee"} fields={EMP_FIELDS} initial={edit} onClose={() => setEdit(null)} onSubmit={save} />}
    </div>
  );
}

function TabPicker({ value, onChange }) {
  const toggle = (k) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k]);
  const all = GRANTABLE_TABS.every((t) => value.includes(t.key));
  const some = !all && GRANTABLE_TABS.some((t) => value.includes(t.key));
  return <div className="bk-admin-tabs"><label className="bk-check" style={{ gridColumn: "1 / -1" }}><input type="checkbox" checked={all} ref={(el) => { if (el) el.indeterminate = some; }} onChange={() => onChange(toggleAllTabs(value))} /> <strong>All</strong></label>{GRANTABLE_TABS.map((t) => <label className="bk-check" key={t.key}><input type="checkbox" checked={value.includes(t.key)} onChange={() => toggle(t.key)} /> {t.label}</label>)}</div>;
}
const needsRole = (tabs) => tabs.some((t) => NEEDS_DATA_ROLE.has(t));

function Onboard({ onClose, onDone }) {
  const staff = useLoad(async () => check(await supabase.from("hr_employees").select("*").is("profile_id", null).neq("status", "Left").order("employee_code")), []);
  const [v, setV] = useState({ employee_id: "", full_name: "", department: "", designation: "", email: "", password: "", confirm: "", data_role: "" });
  const [isNew, setIsNew] = useState(false); // new person: their HR Base record is created with the login
  const [made, setMade] = useState(null); // the reply once the login exists: did the email go?
  const [tabs, setTabs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const pick = (e) => { const emp = (staff.data || []).find((x) => x.id === e.target.value); setV((s) => ({ ...s, employee_id: e.target.value, email: emp?.work_email || s.email })); };
  const submit = async () => {
    const bad = [];
    if (isNew && !v.full_name.trim()) bad.push(["ob-name", "the full name"]);
    if (!isNew && !v.employee_id) bad.push(["ob-employee", "the employee"]);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) bad.push(["ob-email", "a valid login email"]);
    if (v.password.length < 8) bad.push(["ob-password", "a password of at least 8 characters"]);
    if (v.password !== v.confirm) bad.push(["ob-confirm", "the same password again"]);
    if (!tabs.length) bad.push(["ob-tabs", "at least one tab"]);
    if (needsRole(tabs) && !v.data_role) bad.push(["ob-role", "a data role for the chosen tabs"]);
    if (bad.length) { setError(`Please provide ${bad.map((b) => b[1]).join(", ")}.`); flagMissing(bad.map((b) => b[0])); return; }
    setBusy(true); setError(null);
    try { const r = await adminUsers({ action: "onboard_member", ...(isNew ? { new_employee: { full_name: v.full_name.trim(), department: v.department.trim() || null, designation: v.designation.trim() || null } } : { employee_id: v.employee_id }), email: v.email.trim(), password: v.password, tabs, data_role: needsRole(tabs) ? v.data_role : null }); await onDone(); setMade(r); setBusy(false); } catch (e) { setError(e.message); setBusy(false); }
  };
  if (made) return (
    <Modal title="Onboard member" onClose={onClose}>
      {made.emailed
        ? <div className="bk-alert bk-alert-ok">Login created. The details were emailed to {made.email}, and they set their own password at first sign-in.</div>
        : <ErrorNote message={`Login created, but the email to ${made.email} did not send: ${made.email_error || "unknown error"}. Share the password with them directly.`} />}
      <div className="bk-modal-actions"><Button variant="primary" onClick={onClose}>Done</Button></div>
    </Modal>
  );
  return (
    <Modal wide title="Onboard member" onClose={onClose}>
      <ErrorNote message={error || staff.error} onClose={() => setError(null)} />
      <div className="bk-grid">
        <div className="bk-field bk-full">
          <label className="bk-check"><input type="checkbox" checked={isNew} onChange={(e) => { setIsNew(e.target.checked); setV((s) => ({ ...s, employee_id: "" })); }} /> New person, not in HR Base yet</label>
        </div>
        {isNew ? <>
          <div className="bk-field bk-full"><label htmlFor="ob-name">Full name <em>*</em></label><input id="ob-name" autoComplete="off" value={v.full_name} onChange={set("full_name")} /><small>They are added to HR Base with the next employee code.</small></div>
          <div className="bk-field"><label htmlFor="ob-department">Department</label><input id="ob-department" autoComplete="off" value={v.department} onChange={set("department")} /></div>
          <div className="bk-field"><label htmlFor="ob-designation">Designation</label><input id="ob-designation" autoComplete="off" value={v.designation} onChange={set("designation")} /></div>
        </> : <div className="bk-field bk-full"><label htmlFor="ob-employee">Employee <em>*</em></label><select id="ob-employee" value={v.employee_id} onChange={pick}><option value="">Select from HR Base…</option>{(staff.data || []).map((e) => <option key={e.id} value={e.id}>{e.employee_code} · {e.full_name}{e.designation ? ` · ${e.designation}` : ""}</option>)}</select>{staff.data && !staff.data.length && <small>No employees without a login. Tick "New person" above.</small>}</div>}
        <div className="bk-field bk-full"><label htmlFor="ob-email">Username (login email) <em>*</em></label><input id="ob-email" type="email" autoComplete="off" value={v.email} onChange={set("email")} /></div>
        <div className="bk-field"><label htmlFor="ob-password">Password <em>*</em></label><input id="ob-password" type="password" autoComplete="new-password" value={v.password} onChange={set("password")} /></div>
        <div className="bk-field"><label htmlFor="ob-confirm">Confirm password <em>*</em></label><input id="ob-confirm" type="password" autoComplete="new-password" value={v.confirm} onChange={set("confirm")} /></div>
      </div>
      <h4 className="bk-subhead">Tabs this member can open <em>*</em></h4>
      <div id="ob-tabs"><TabPicker value={tabs} onChange={setTabs} /></div>
      {needsRole(tabs) && <div className="bk-field bk-mt"><label htmlFor="ob-role">Data role <em>*</em></label><select id="ob-role" value={v.data_role} onChange={set("data_role")}><option value="">Select…</option>{DATA_ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}</select><small>Decides which Business Banking, Clients and document records these tabs can read and change.</small></div>}
      <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={submit}>Create login</Button></div>
    </Modal>
  );
}

function EditMember({ member, currentUser, onClose, onDone }) {
  const [tabs, setTabs] = useState(member.tabs || []);
  const [role, setRole] = useState(member.data_role || "");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const self = member.id === currentUser?.id;
  const act = async (key, fn, done) => {
    setBusy(key); setError(null); setNote(null);
    try { const r = await fn(); await onDone(); if (done) setNote(typeof done === "function" ? done(r) : done); else onClose(); } catch (e) { setError(e.message); }
    setBusy(null);
  };
  const saveAccess = () => {
    if (needsRole(tabs) && !role) { setError("Choose a data role for the chosen tabs."); flagMissing(["me-role"]); return; }
    act("save", () => adminUsers({ action: "set_access", user_id: member.id, tabs, data_role: needsRole(tabs) ? role : null }), "Access saved.");
  };
  return (
    <Modal wide title={member.full_name || member.email} onClose={onClose}>
      <ErrorNote message={error} onClose={() => setError(null)} />
      {note && <div className="bk-alert bk-alert-ok">{note}</div>}
      {member.role === "admin" ? <p className="bk-note">Admins can open every tab.</p> : (
        <>
          <h4 className="bk-subhead">Tabs</h4>
          <TabPicker value={tabs} onChange={setTabs} />
          {needsRole(tabs) && <div className="bk-field bk-mt"><label htmlFor="me-role">Data role</label><select id="me-role" value={role} onChange={(e) => setRole(e.target.value)}><option value="">Select…</option>{DATA_ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}</select></div>}
          <div className="bk-actions bk-mt"><Button variant="primary" busy={busy === "save"} onClick={saveAccess}>Save access</Button></div>
        </>
      )}
      <h4 className="bk-subhead bk-mt">Reset password</h4>
      <div className="bk-add-line"><div className="bk-field"><label htmlFor="me-pass">New password</label><input id="me-pass" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} /></div><Button busy={busy === "pass"} onClick={() => { if (pass.length < 8) { setError("A password needs at least 8 characters."); flagMissing(["me-pass"]); return; } act("pass", async () => { const r = await adminUsers({ action: "reset_password", user_id: member.id, password: pass }); setPass(""); return r; }, (r) => (r.emailed ? `Password changed and emailed to ${r.email}. They set their own at next sign-in.` : r.self ? "Your password is changed." : `Password changed, but the email did not send${r.email_error ? `: ${r.email_error}` : ""}. Share it with the member directly.`)); }}>Set password</Button></div>
      {!self && (
        <div className="bk-actions bk-mt">
          <Button busy={busy === "susp"} onClick={() => act("susp", () => adminUsers({ action: "set_suspended", user_id: member.id, suspended: !member.suspended }))}>{member.suspended ? "Reactivate login" : "Suspend login"}</Button>
          <Button onClick={() => { if (window.confirm(`Delete the login of ${member.full_name || member.email}? This cannot be undone. Their employee record stays.`)) act("del", () => adminUsers({ action: "delete_user", user_id: member.id })); }}>Delete login</Button>
        </div>
      )}
    </Modal>
  );
}

export function MembersPanel({ currentUser }) {
  const list = useLoad(() => call("admin_members"), []);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState(null);
  const label = useMemo(() => Object.fromEntries(GRANTABLE_TABS.map((t) => [t.key, t.label])), []);
  const open = (list.data || []).find((m) => m.id === openId);
  return (
    <div>
      <ErrorNote message={list.error} />
      <div className="bk-actions bk-mb"><Button variant="primary" onClick={() => setAdding(true)}>+ Onboard member</Button></div>
      {list.loading && !list.data ? <Spinner /> : <div className="bk-oneline"><DataTable search="Search name, code or email…" rows={list.data || []} onRow={(m) => setOpenId(m.id)} empty="No members." columns={[
        { key: "employee_code", label: "Code", width: 72 }, { key: "full_name", label: "Member", width: "14%", render: (m) => <Clip text={m.full_name} /> }, { key: "email", label: "Username", width: "19%", render: (m) => <Clip text={m.email} /> }, { key: "department", label: "Department", width: "7%", render: (m) => <Clip text={m.department || "–"} /> },
        { key: "role", label: "Type", width: 80, render: (m) => <Badge tone={m.role === "admin" ? "good" : undefined}>{m.role}</Badge> },
        { key: "tabs", label: "Tabs", render: (m) => (m.role === "admin" ? "All" : (m.tabs || []).length ? <Clip text={m.tabs.map((t) => label[t] || t).join(", ")} /> : <Badge tone="warn">None</Badge>) },
        { key: "data_role", label: "Data role", width: 90, render: (m) => <Clip text={(m.data_role || "–").replace(/_/g, " ")} /> }, { key: "last_sign_in_at", label: "Last sign-in", width: 110, render: (m) => whenShort(m.last_sign_in_at) },
        { key: "suspended", label: "Login", width: 86, render: (m) => <Badge tone={m.suspended ? "bad" : "good"}>{m.suspended ? "Suspended" : "Active"}</Badge> },
      ]} /></div>}
      {adding && <Onboard onClose={() => setAdding(false)} onDone={list.reload} />}
      {open && <EditMember member={open} currentUser={currentUser} onClose={() => setOpenId(null)} onDone={list.reload} />}
    </div>
  );
}
