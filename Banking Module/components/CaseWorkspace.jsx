import { useState } from "react";
import KycForm from "./KycForm";
import { Badge, Button, CommsList, DataTable, ErrorNote, FilePick, FormModal, KeyVals, Modal, PageHead, Panel, Spinner, fmtDate, fmtDateTime, today, useAction, useBanking, useLoad } from "./shared-ext";
import { expiryFrom } from "../logic/kycAutofill";
import { insertRow, loadSettings, openFile, readDocuments, rpc, run, searchClientMaster, table, updateRow, uploadFile } from "../services/bankingApi";
import { supabase } from "@app/supabase";
import { APP_STATUSES, DOC_STATUSES, GATE_LABELS, PHASES, STAGES, STEPS, SUBMISSION_METHODS, TASK_STATUSES, TASK_TYPES, PRIORITIES } from "../logic/constants";
import { lineAmount, money, quoteTotals } from "../logic/pricing";
import { downloadLetterDocx, downloadQuoteDocx, printLetter, printQuote, printReceipt, quoteMerge } from "../logic/documents";

// Old list pages link to a case by area; each area opens at its step.
const AREA_STEP = { client: 2, followups: 3, kyc: 4, selection: 6, documents: 8, quotation: 9, payments: 10, agreement: 12, application: 14 };
const RECORDS = [["overview", "Overview"], ["tasks", "Tasks"], ["followups", "Follow-ups"], ["history", "Activity History"]];

export default function CaseWorkspace({ caseId, initialTab, onBack }) {
  const { personName, can } = useBanking();
  const [step, setStep] = useState(AREA_STEP[initialTab] || null);
  const [records, setRecords] = useState(["tasks", "history", "overview"].includes(initialTab) ? initialTab : null);
  const load = useLoad(async () => {
    const c = await run(table("banking_cases").select("*, banking_clients(*)").eq("id", caseId).single());
    const [finance, gates, app, sel] = await Promise.all([
      rpc("banking_case_finance", { p_case: caseId }),
      rpc("banking_gate_status", { p_case: caseId }),
      can("apps.view") ? run(table("banking_applications").select("*").eq("case_id", caseId).order("is_active", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle()) : null,
      run(table("banking_bank_recommendations").select("*, banking_partners(bank_name), banking_schemes(scheme_name)").eq("case_id", caseId).eq("is_selected", true).maybeSingle()),
    ]);
    return { c, finance, gates, app, sel };
  }, [caseId]);

  if (load.loading && !load.data) return <Spinner />;
  if (!load.data) return <ErrorNote message={load.error} />;
  const { c, finance, gates, app, sel } = load.data;
  const client = c.banking_clients;
  const reload = load.reload;
  const shown = step || c.current_stage;
  const show = (n) => { setRecords(null); setStep(n); };

  return (
    <div>
      <PageHead title={client.display_name} sub={`${c.case_ref}${c.is_historical ? " · imported from Excel history" : ""}`}><Button onClick={onBack}>Back</Button></PageHead>
      <div className="bk-case-top">
        <KeyVals items={[["Selected bank", sel ? `${sel.banking_partners?.bank_name}${sel.banking_schemes ? ` · ${sel.banking_schemes.scheme_name}` : ""}` : null], ["Application status", app?.status], ["Assigned employee", personName(c.assigned_to)], ["Total quotation", money(finance?.total)], ["Amount received", money(finance?.received)], ["Outstanding", money(finance?.outstanding)]]} />
      </div>
      <ProgressRail current={c.current_stage} shown={records ? null : shown} outcome={c.outcome} opened={app?.status === "Account Opened"} onOpen={show} />
      <div className="bk-filter">
        <span className="bk-muted">Case records:</span>
        {RECORDS.map(([k, label]) => <button type="button" key={k} className={`bk-chip ${records === k ? "active" : ""}`} onClick={() => setRecords(records === k ? null : k)}>{label}</button>)}
      </div>
      {records ? (
        <>
          {records === "overview" && <Overview c={c} gates={gates} app={app} reload={reload} />}
          {records === "tasks" && <CaseTasks c={c} />}
          {records === "followups" && <CommsList caseId={c.id} clientId={c.client_id} />}
          {records === "history" && <History c={c} />}
        </>
      ) : (
        <>
          <div className="bk-step-head">
            <span className="bk-eyebrow">STEP {shown} OF {STEPS.length}{shown < c.current_stage ? " · COMPLETED" : shown > c.current_stage ? " · NOT REACHED YET" : " · CURRENT"}</span>
            <h3>{STEPS[shown - 1][0]}</h3>
            <p>{STEPS[shown - 1][1]}</p>
          </div>
          <StepBody n={shown} c={c} client={client} finance={finance} gates={gates} app={app} reload={reload} goTo={show} />
          <StepFooter n={shown} c={c} reload={reload} goTo={show} />
        </>
      )}
    </div>
  );
}

function ProgressRail({ current, shown, outcome, opened, onOpen }) {
  const [hover, setHover] = useState(null);
  const finished = current === STEPS.length && opened;
  const stopped = ["Rejected", "Returned", "Cancelled"].includes(outcome);
  const done = finished ? STEPS.length : current - 1;
  const percent = Math.round((100 * done) / STEPS.length);
  const focus = hover || shown || current;
  const phaseOf = (n) => PHASES.find(([, a, b]) => n >= a && n <= b);
  const [phaseName, phaseStart, phaseEnd] = phaseOf(focus);
  return (
    <div className={`bk-rail ${stopped ? "stopped" : ""}`}>
      <div className="bk-rail-top">
        <div className="bk-rail-percent"><strong>{percent}%</strong><span>complete</span></div>
        <div className="bk-rail-now">
          {finished ? <strong>Account opened. Case complete.</strong> : stopped ? <strong>Stopped at step {current}: {outcome}</strong> : <strong>Now: {STEPS[current - 1][0]}</strong>}
          {!finished && !stopped && current < STEPS.length && <span>Next: {STEPS[current][0]}</span>}
        </div>
        <span className="bk-rail-count">Step {current} of {STEPS.length}</span>
      </div>
      <div className="bk-rail-phases" onMouseLeave={() => setHover(null)}>
        {PHASES.map(([name, a, b]) => {
          const steps = [];
          for (let n = a; n <= b; n++) steps.push(n);
          const phaseDone = (finished || current > b);
          const inPhase = current >= a && current <= b;
          return (
            <div className="bk-phase" key={name} style={{ flexGrow: b - a + 1 }}>
              <div className={`bk-phase-name ${inPhase ? "now" : ""}`}><span>{phaseDone ? "✓ " : ""}{name}</span></div>
              <div className="bk-segments">
                {steps.map((n) => {
                  const state = n < current || finished ? "done" : n === current ? "now" : "next";
                  return <button type="button" key={n} className={`bk-seg bk-seg-${state} ${n === shown ? "open" : ""}`} aria-label={`Step ${n}: ${STEPS[n - 1][0]}`} aria-current={n === current ? "step" : undefined} title={STEPS[n - 1][0]} onMouseEnter={() => setHover(n)} onFocus={() => setHover(n)} onBlur={() => setHover(null)} onClick={() => onOpen(n)} />;
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="bk-rail-steps" aria-label={`${phaseName} steps`}>
        {STEPS.slice(phaseStart - 1, phaseEnd).map(([name], i) => {
          const n = phaseStart + i;
          const state = n < current || finished ? "done" : n === current ? "now" : "next";
          return <button type="button" key={name} className={`bk-rail-step ${state} ${n === focus ? "focus" : ""}`} onClick={() => onOpen(n)}><span aria-hidden="true">{state === "done" ? "✓" : n}</span>{name}</button>;
        })}
      </div>
    </div>
  );
}

function StepBody({ n, c, client, finance, gates, app, reload, goTo }) {
  if (n === 1) return <LeadStep c={c} />;
  if (n === 2) return <ClientInfo c={c} client={client} reload={reload} />;
  if (n === 3) return <CommsList caseId={c.id} clientId={c.client_id} />;
  if (n === 4) return <KycForm clientId={c.client_id} onSaved={reload} />;
  if (n === 5 || n === 6) return <PlanPicker c={c} reload={reload} goTo={goTo} />;
  if (n === 7 || n === 8) return <Documents c={c} reload={reload} />;
  if (n === 9 || n === 11) return <Quotation c={c} client={client} reload={reload} />;
  if (n === 10) return <Payments c={c} client={client} finance={finance} reload={reload} />;
  if (n === 12 || n === 13) return <Agreement c={c} reload={reload} />;
  if (n >= 14 && n <= 17) return <Application c={c} gates={gates} reload={reload} />;
  return (
    <>
      {app?.status === "Account Opened" ? <div className="bk-alert bk-alert-ok">Account opening recorded. This case is complete.</div> : <div className="bk-alert bk-alert-warn">Not complete yet. Record "Account Opened" on the application once the bank confirms.</div>}
      <Application c={c} gates={gates} reload={reload} />
    </>
  );
}

function LeadStep({ c }) {
  const lead = useLoad(() => (c.lead_id ? run(table("banking_leads").select("*").eq("id", c.lead_id).maybeSingle()) : Promise.resolve(null)), [c.lead_id]);
  const l = lead.data;
  return (
    <Panel title="Lead details">
      <ErrorNote message={lead.error} />
      {!l ? <p className="bk-note">{lead.loading ? "Loading…" : "This case was opened directly, without a lead."}</p> : (
        <KeyVals items={[["Lead", l.lead_ref], ["Lead date", fmtDate(l.lead_date)], ["Company", l.company_name], ["Contact", l.contact_person], ["Mobile", l.mobile], ["WhatsApp", l.whatsapp], ["Email", l.email], ["Nationality", l.nationality], ["Source", l.lead_source], ["Notes", l.initial_notes], ...(l.source_sheet ? [["Imported from", `${l.source_sheet} row ${l.source_row}`]] : [])]} />
      )}
    </Panel>
  );
}

function StepFooter({ n, c, reload, goTo }) {
  const { can } = useBanking();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [override, setOverride] = useState(false);
  const [back, setBack] = useState(false);
  const canMove = can("cases.manage");
  const friendly = (m) => Object.entries(GATE_LABELS).reduce((t, [k, label]) => t.replaceAll(k, label), m).replace(/Cannot move to stage (\d+)/, "Cannot continue to step $1");
  const advance = async () => {
    setBusy(true); setError(null);
    try {
      await rpc("banking_move_stage", { p_case: c.id, p_to: c.current_stage + 1 });
      await reload();
      goTo(c.current_stage + 1);
    } catch (e) { setError(friendly(e.message)); }
    setBusy(false);
  };
  return (
    <div className="bk-step-foot">
      <ErrorNote message={error} />
      <div className="bk-step-buttons">
        <Button disabled={n <= 1} onClick={() => goTo(n - 1)}>Previous step</Button>
        <span className="bk-actions">
          {canMove && n < c.current_stage && <Button onClick={() => setBack(true)}>Return case to this step</Button>}
          {error && can("workflow.override") && <Button onClick={() => setOverride(true)}>Continue by exception</Button>}
          {n !== c.current_stage && n < STEPS.length && <Button onClick={() => goTo(n + 1)}>Next step</Button>}
          {n !== c.current_stage && <Button onClick={() => goTo(c.current_stage)}>Go to current step</Button>}
          {canMove && n === c.current_stage && n < STEPS.length && <Button variant="primary" busy={busy} onClick={advance}>Complete step and continue</Button>}
        </span>
      </div>
      {override && <FormModal title={`Continue to step ${c.current_stage + 1} by exception`} note={error} onClose={() => setOverride(false)} submitLabel="Continue" fields={[{ name: "why", label: "Justification", type: "textarea", required: true, full: true }]} onSubmit={async (v) => { await rpc("banking_move_stage", { p_case: c.id, p_to: c.current_stage + 1, p_override: v.why }); setError(null); await reload(); goTo(c.current_stage + 1); }} />}
      {back && <FormModal title={`Return case to step ${n}: ${STEPS[n - 1][0]}`} onClose={() => setBack(false)} submitLabel="Return" fields={[{ name: "why", label: "Remarks", type: "textarea", required: true, full: true }]} onSubmit={async (v) => { await rpc("banking_move_stage", { p_case: c.id, p_to: n, p_remarks: v.why }); await reload(); }} />}
    </div>
  );
}

function PlanPicker({ c, reload, goTo }) {
  const { can } = useBanking();
  const cat = useLoad(() => rpc("banking_plan_catalogue", { p_case: c.id }), [c.id]);
  const sel = useLoad(() => run(table("banking_bank_recommendations").select("id, bank_id, scheme_id").eq("case_id", c.id).eq("is_selected", true).maybeSingle()), [c.id]);
  const [bank, setBank] = useState("");
  const [choice, setChoice] = useState(null);
  const banks = cat.data || [];
  const shown = banks.filter((b) => !bank || b.bank_id === bank);
  const current = sel.data;
  const manage = can("cases.manage");
  const fee = (p) => (p ? Number(p.account_opening_fee || 0) + Number(p.other_bank_charges || 0) : 0);
  const choose = async (v) => {
    await rpc("banking_choose_plan", { p_case: c.id, p_bank: choice.bank.bank_id, p_scheme: choice.plan?.scheme_id ?? null, p_reason: v.reason ?? null });
    await sel.reload();
    if (c.current_stage < 7) {
      try { await rpc("banking_move_stage", { p_case: c.id, p_to: 7 }); await reload(); goTo(7); return; } catch { /* a missing requirement shows when they press continue */ }
    }
    await reload();
  };
  return (
    <Panel title="Choose a bank and plan" sub="Charges and conditions come from AB Capital's internal data, not verified bank policy. Showing a plan never implies approval: the bank decides."
      actions={<select aria-label="Filter by bank" value={bank} onChange={(e) => setBank(e.target.value)}><option value="">All banks</option>{banks.map((b) => <option key={b.bank_id} value={b.bank_id}>{b.bank_name}</option>)}</select>}>
      <ErrorNote message={cat.error || sel.error} />
      {cat.loading && !cat.data ? <Spinner /> : shown.map((b) => {
        const notes = (b.flags?.notes || []).filter((n) => n.relevant);
        const cards = b.plans.length ? b.plans : [null];
        const range = b.bank_pricing;
        return (
          <section className="bk-bank" key={b.bank_id}>
            <header><h4>{b.bank_name}</h4>{range?.service_fee_min != null && <span className="bk-muted">AB Capital fee guide: AED {range.service_fee_min}–{range.service_fee_max}</span>}</header>
            {notes.length > 0 && <div className="bk-consider"><strong>Considerations for this client (internal, unverified):</strong><ul>{notes.map((n, i) => <li key={i}>{n.note}</li>)}</ul></div>}
            <div className="bk-compare">
              {cards.map((p) => {
                const v = p?.version || {};
                const isSel = current && current.bank_id === b.bank_id && (current.scheme_id ?? null) === (p?.scheme_id ?? null);
                return (
                  <article key={p?.scheme_id || "none"} className={`bk-option ${isSel ? "selected" : ""}`}>
                    <header><h4>{p?.scheme_name || "No plan recorded yet"}</h4>{isSel && <Badge tone="good">Selected</Badge>}</header>
                    {p?.account_type && <p className="bk-muted">{p.account_type}</p>}
                    <KeyVals items={[
                      ["Min. average balance", v.minimum_average_balance != null ? money(v.minimum_average_balance) : "Not recorded"],
                      ["Fee if below balance", v.below_balance_fee != null ? money(v.below_balance_fee) : "Not recorded"],
                      ["Monthly fee", v.monthly_fee != null ? money(v.monthly_fee) : "Not recorded"],
                      ["Initial deposit", v.initial_deposit != null ? money(v.initial_deposit) : "Not recorded"],
                      ["Bank opening charges", p?.pricing && fee(p.pricing) > 0 ? money(fee(p.pricing)) : "Not recorded"],
                      ["Physical office", v.physical_office_required == null ? "Not recorded" : v.physical_office_required ? "Required" : "Not required"],
                      ["Processing time", v.processing_time || b.processing_time || "Not recorded"],
                      ["Data", v.verification_status || "Unverified"],
                    ]} />
                    {v.internal_notes && <p className="bk-muted bk-mt">{v.internal_notes}</p>}
                    {manage && !isSel && <div className="bk-mt"><Button variant="primary" onClick={() => setChoice({ bank: b, plan: p })}>Select this plan</Button></div>}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
      {choice && <FormModal title={`Select ${choice.bank.bank_name}${choice.plan ? ` · ${choice.plan.scheme_name}` : ""}`} onClose={() => setChoice(null)} submitLabel="Select and build document list" note="This builds the client's document checklist for this bank. An earlier selection stays on record."
        fields={current ? [{ name: "reason", label: "Reason for changing the bank", type: "textarea", required: true, full: true }] : []} onSubmit={choose} />}
    </Panel>
  );
}

function Overview({ c, gates, app, reload }) {
  const { can } = useBanking();
  const ai = useLoad(() => run(table("banking_ai_suggestions").select("*").eq("case_id", c.id).eq("status", "Pending Review").order("created_at", { ascending: false })), [c.id]);
  const flags = useLoad(() => rpc("banking_case_flags", { p_case: c.id, p_bank: null }), [c.id]);
  const { error, busy, act } = useAction(ai.reload);
  return (
    <div className="bk-two">
      <Panel title="Processing checklist" sub={app ? `Application ${app.application_ref}` : "No application opened yet"}>
        <ul className="bk-gates">{Object.entries(GATE_LABELS).map(([k, label]) => <li key={k} className={gates?.[k] ? "ok" : ""}><span aria-hidden="true">{gates?.[k] ? "✓" : "○"}</span>{label}</li>)}</ul>
      </Panel>
      <Panel title="Risk considerations" sub="For staff review only. Nobody is approved or rejected from this list.">
        <ErrorNote message={flags.error} />
        {(flags.data?.risk || []).map((r, i) => <p key={i}><Badge tone={r.level === "Low" ? "plain" : "bad"}>{r.level}</Badge> {r.match}: {r.requirement} <small className="bk-muted">Source: {r.source} ({r.verification})</small></p>)}
        {!flags.data?.risk?.length && <p className="bk-note">No nationality on record matches a risk rule.</p>}
        <small className="bk-muted">{flags.data?.disclaimer}</small>
      </Panel>
      <Panel title="Assistant suggestions" sub="Rules only for now. Each one waits for a person; none verifies, approves, sends or posts anything."
        actions={<Button busy={busy} onClick={() => act(() => rpc("banking_ai_refresh", { p_case: c.id }))}>Check case</Button>}>
        <ErrorNote message={ai.error || error} />
        {(ai.data || []).slice(0, 20).map((s) => (
          <div className="bk-row" key={s.id}>
            <span>{s.payload.suggestion}</span>
            {can("tasks.manage") && <span className="bk-actions">
              <Button busy={busy} onClick={() => act(() => rpc("banking_ai_review", { p_id: s.id, p_accept: true }))}>{s.payload.task_type ? "Create task" : "Noted"}</Button>
              <Button busy={busy} onClick={() => act(() => rpc("banking_ai_review", { p_id: s.id, p_accept: false }))}>Dismiss</Button>
            </span>}
          </div>
        ))}
        {!ai.data?.length && <p className="bk-note">No open suggestions.</p>}
      </Panel>
      <Deliverables c={c} reload={reload} />
    </div>
  );
}

function Deliverables({ c }) {
  const { can } = useBanking();
  const list = useLoad(() => run(table("banking_service_deliverables").select("*, banking_supplementary_services(service_name), banking_documents(title)").eq("case_id", c.id).order("created_at")), [c.id]);
  const [edit, setEdit] = useState(null);
  return (
    <Panel title="Supplementary services" sub="Optional and separately charged. Added from the quotation.">
      <ErrorNote message={list.error} />
      <DataTable rows={list.data || []} onRow={can("cases.manage") ? setEdit : undefined} empty="None selected." columns={[
        { key: "s", label: "Service", render: (r) => r.banking_supplementary_services?.service_name }, { key: "status", label: "Status", render: (r) => <Badge>{r.status}</Badge> },
        { key: "issued_on", label: "Issued", render: (r) => fmtDate(r.issued_on) }, { key: "completed_on", label: "Completed", render: (r) => fmtDate(r.completed_on) }, { key: "remarks", label: "Remarks" },
      ]} />
      {edit && <FormModal title="Update service" initial={edit} onClose={() => setEdit(null)} fields={[
        { name: "status", label: "Status", type: "select", required: true, options: ["Pending", "In Progress", "Issued", "Completed", "Cancelled"] }, { name: "issued_on", label: "Issued on", type: "date" }, { name: "completed_on", label: "Completed on", type: "date" }, { name: "remarks", label: "Remarks", type: "textarea", full: true },
      ]} onSubmit={async (v) => { await updateRow("banking_service_deliverables", edit.id, v); await list.reload(); }} />}
    </Panel>
  );
}

function ClientInfo({ c, client, reload }) {
  const { can, personOptions } = useBanking();
  const parties = useLoad(() => run(table("banking_case_parties").select("*").eq("case_id", c.id).order("created_at")), [c.id]);
  const others = useLoad(() => run(table("banking_cases").select("id, case_ref, current_stage, outcome").eq("client_id", c.client_id)), [c.client_id]);
  const [link, setLink] = useState(false);
  const [party, setParty] = useState(false);
  const [assign, setAssign] = useState(false);
  const { error, act } = useAction(reload);
  const { openCase } = useBanking();
  const [cmQuery, setCmQuery] = useState(null);
  const lookup = () => act(async () => {
    try { setCmQuery(await searchClientMaster(client.display_name)); }
    catch { setCmQuery("offline"); }
  });
  return (
    <div>
      <Panel title="Client" actions={can("cases.manage") && <><Button onClick={() => setAssign(true)}>Assign employee</Button><Button onClick={lookup}>Find in Client Master</Button><Button onClick={() => setLink(true)}>Enter Client Master ID</Button></>}>
        <ErrorNote message={error} />
        <KeyVals items={[["Name", client.display_name], ["Licence", client.license_number], ["Type", client.client_type], ["Client Master ID", client.client_master_id], ["Link status", <Badge key="s">{client.link_status}</Badge>]]} />
        {cmQuery === "offline" && <p className="bk-note">The Client Module is not reachable from this browser. Start it on this PC, or enter the CL number by hand.</p>}
        {Array.isArray(cmQuery) && (
          <div className="bk-mt">
            {cmQuery.map((m) => <div className="bk-row" key={m["Client ID"]}><span>{m["Client ID"]} · {m["Client Legal Name"]} · {m["Trade License Number"]}</span><Button onClick={() => act(() => rpc("banking_link_client_master", { p_client: client.id, p_master: m["Client ID"] }))}>Link</Button></div>)}
            {!cmQuery.length && <p className="bk-note">No match in Client Master. Onboard the client in the Clients page, then link here.</p>}
          </div>
        )}
      </Panel>
      <Panel title="Contacts on this case" actions={can("cases.manage") && <Button onClick={() => setParty(true)}>Add contact</Button>}>
        <DataTable rows={parties.data || []} columns={[{ key: "party_role", label: "Role" }, { key: "full_name", label: "Name" }, { key: "mobile", label: "Mobile" }, { key: "email", label: "Email" }]} empty="No contacts." />
      </Panel>
      <Panel title="All banking cases of this client">
        <DataTable rows={others.data || []} onRow={(r) => r.id !== c.id && openCase(r.id)} columns={[{ key: "case_ref", label: "Case" }, { key: "current_stage", label: "Stage", render: (r) => STAGES[r.current_stage - 1] }, { key: "outcome", label: "Outcome" }]} />
      </Panel>
      {link && <FormModal title="Client Master ID" initial={{ id: client.client_master_id }} onClose={() => setLink(false)} fields={[{ name: "id", label: "Client ID", required: true, help: "Format CL000001" }]} onSubmit={async (v) => { await rpc("banking_link_client_master", { p_client: client.id, p_master: v.id }); await reload(); }} />}
      {party && <FormModal title="Add contact" initial={{ party_role: "Primary Contact" }} onClose={() => setParty(false)} fields={[{ name: "party_role", label: "Role", required: true }, { name: "full_name", label: "Name", required: true }, { name: "mobile", label: "Mobile" }, { name: "email", label: "Email" }]} onSubmit={async (v) => { await insertRow("banking_case_parties", { ...v, case_id: c.id }); await parties.reload(); }} />}
      {assign && <FormModal title="Assign employee" initial={{ assigned_to: c.assigned_to }} onClose={() => setAssign(false)} fields={[{ name: "assigned_to", label: "Employee", type: "select", options: personOptions, required: true }]} onSubmit={async (v) => { await updateRow("banking_cases", c.id, v); await reload(); }} />}
    </div>
  );
}

function Documents({ c, reload }) {
  const { can, personName } = useBanking();
  const list = useLoad(() => run(table("banking_case_checklists").select("*, banking_partners(bank_name), banking_document_types(has_expiry,is_information,is_sensitive)").eq("case_id", c.id).order("is_current", { ascending: false }).order("sort_order")), [c.id]);
  const [showOld, setShowOld] = useState(false);
  const [statusFor, setStatusFor] = useState(null);
  const [versions, setVersions] = useState(null);
  const { error, busy, act } = useAction(async () => { await list.reload(); await reload(); });
  const current = (list.data || []).filter((l) => l.is_current);
  const old = (list.data || []).filter((l) => !l.is_current);
  const missing = current.filter((l) => l.is_mandatory && ["Not Requested", "Requested", "Rejected", "Resubmission Required"].includes(l.status)).length;
  const verified = current.filter((l) => l.status === "Verified").length;
  const upload = (line, file) => act(async () => {
    const u = await uploadFile(c.id, "documents", file);
    let expiry = null;
    if (line.banking_document_types?.has_expiry) {
      // Read by the Document Module where it is running; otherwise ask.
      try { expiry = expiryFrom((await readDocuments([file]))[0]); } catch { /* not reachable on this PC */ }
      if (!expiry) { const typed = window.prompt(`Expiry date of "${line.requirement_label}" (YYYY-MM-DD). Leave blank if not known.`) || ""; if (/^\d{4}-\d{2}-\d{2}$/.test(typed.trim())) expiry = typed.trim(); }
    }
    await rpc("banking_document_add_version", { p_checklist: line.id, p_path: u.path, p_file: u.name, p_mime: u.mime, p_size: u.size, p_sha: u.sha256, p_expiry: expiry, p_remarks: null });
  });
  return (
    <Panel title="Document checklist" sub={current[0] ? `${current[0].banking_partners?.bank_name || "Standard"}: ${verified} verified, ${missing} missing of ${current.length}` : "Select a bank to generate the checklist."}
      actions={can("docs.manage") && current.length > 0 && <><Button busy={busy} onClick={() => act(async () => { for (const l of current.filter((x) => x.status === "Not Requested")) await rpc("banking_checklist_set_status", { p_checklist: l.id, p_status: "Requested" }); })}>Mark all as requested</Button><Button busy={busy} onClick={() => act(() => rpc("banking_regenerate_checklist", { p_case: c.id }))}>Regenerate from KYC</Button></>}>
      <ErrorNote message={list.error || error} />
      <p className="bk-note">Requirements come from AB Capital's internal list and are not verified bank policy. Uploading a file never verifies it.</p>
      <DataTable pageSize={60} rows={current} empty="No checklist yet." columns={[
        { key: "requirement_label", label: "Requirement", render: (r) => <>{r.requirement_label}{!r.is_mandatory && <small className="bk-muted"> (conditional)</small>}{r.condition_state === "To Confirm" && <> <Badge tone="warn">To Confirm</Badge></>}</> },
        { key: "status", label: "Status", render: (r) => <Badge>{r.status}</Badge> },
        { key: "expiry_date", label: "Expiry", render: (r) => <span className={r.expiry_date && r.expiry_date < today() ? "bk-overdue" : ""}>{fmtDate(r.expiry_date)}</span> },
        { key: "verified_by", label: "Verified by", render: (r) => (r.verified_by ? `${personName(r.verified_by)} · v${r.verified_version ?? "–"}` : "–") },
        { key: "review_remarks", label: "Remarks" },
        { key: "act", label: "", render: (r) => (
          <span className="bk-actions">
            {can("docs.manage") && !r.banking_document_types?.is_information && <FilePick label={r.document_id ? "New version" : "Upload"} busy={busy} onFile={(f) => upload(r, f)} />}
            {r.document_id && can("docs.view") && <Button onClick={() => setVersions(r)}>Files</Button>}
            {can("docs.manage") && <Button onClick={() => setStatusFor(r)}>Status</Button>}
          </span>
        ) },
      ]} />
      {old.length > 0 && <div className="bk-mt"><button type="button" className="bk-link" onClick={() => setShowOld(!showOld)}>{showOld ? "Hide" : "Show"} {old.length} lines from earlier bank selections</button>
        {showOld && <DataTable rows={old} columns={[{ key: "b", label: "Bank", render: (r) => r.banking_partners?.bank_name }, { key: "requirement_label", label: "Requirement" }, { key: "status", label: "Status", render: (r) => <Badge>{r.status}</Badge> }]} />}</div>}
      {statusFor && <FormModal title={statusFor.requirement_label} initial={statusFor} onClose={() => setStatusFor(null)} submitLabel="Update"
        fields={[{ name: "status", label: "Status", type: "select", required: true, options: DOC_STATUSES.filter((s) => s !== "Verified" || can("docs.verify")) }, { name: "expiry_date", label: "Expiry date", type: "date" }, { name: "review_remarks", label: statusFor.banking_document_types?.is_information ? "Information received / remarks" : "Remarks", type: "textarea", full: true }]}
        onSubmit={async (v) => { await rpc("banking_checklist_set_status", { p_checklist: statusFor.id, p_status: v.status, p_remarks: v.review_remarks, p_expiry: v.expiry_date }); await list.reload(); await reload(); }} />}
      {versions && <Versions line={versions} onClose={() => setVersions(null)} />}
    </Panel>
  );
}

function Versions({ line, onClose }) {
  const vs = useLoad(() => run(table("banking_document_versions").select("*").eq("document_id", line.document_id).order("version", { ascending: false })), [line.document_id]);
  const { error, act } = useAction();
  return (
    <Modal title={`Versions · ${line.requirement_label}`} onClose={onClose}>
      <ErrorNote message={vs.error || error} />
      <DataTable rows={vs.data || []} columns={[{ key: "version", label: "Version" }, { key: "file_name", label: "File" }, { key: "created_at", label: "Uploaded", render: (r) => fmtDateTime(r.created_at) }, { key: "o", label: "", render: (r) => <button type="button" className="bk-link" onClick={() => act(() => openFile(r.storage_path))}>Open</button> }]} />
    </Modal>
  );
}

function Quotation({ c, client, reload }) {
  const { can, personName } = useBanking();
  const quotes = useLoad(() => run(table("banking_quotations").select("*, banking_partners(bank_name), banking_schemes(scheme_name), banking_quotation_items(*)").eq("case_id", c.id).order("created_at", { ascending: false })), [c.id]);
  const settings = useLoad(() => loadSettings(), []);
  const [open, setOpen] = useState(null);
  const [revise, setRevise] = useState(null);
  const [decide, setDecide] = useState(null);
  const { error, busy, act } = useAction(async () => { await quotes.reload(); await reload(); });
  const rows = quotes.data || [];
  const company = settings.data?.company;
  const merge = (q) => quoteMerge(q, client, c, company, personName(q.prepared_by));
  return (
    <Panel title="Quotations" sub="Every version is kept." actions={can("quotes.manage") && <Button variant="primary" busy={busy} onClick={() => act(() => rpc("banking_quote_create", { p_case: c.id }))}>New quotation</Button>}>
      <ErrorNote message={quotes.error || error} />
      <DataTable rows={rows} empty="No quotation yet. Select a bank first." columns={[
        { key: "n", label: "Number", render: (q) => `${q.quotation_number} v${q.version}` }, { key: "b", label: "Bank", render: (q) => q.banking_partners?.bank_name },
        { key: "quotation_date", label: "Date", render: (q) => fmtDate(q.quotation_date) }, { key: "valid_until", label: "Valid until", render: (q) => fmtDate(q.valid_until) },
        { key: "status", label: "Status", render: (q) => <Badge>{q.status}</Badge> }, { key: "total_amount", label: "Total", right: true, render: (q) => money(q.total_amount) },
        { key: "a", label: "", render: (q) => (
          <span className="bk-actions bk-wrap">
            {["Draft", "Approval Required"].includes(q.status) && can("quotes.manage") && <Button onClick={() => setOpen(q)}>Edit</Button>}
            {q.status === "Approval Required" && can("pricing.approve") && <Button busy={busy} onClick={() => act(() => rpc("banking_quote_action", { p_quote: q.id, p_action: "approve" }))}>Approve pricing</Button>}
            {q.status === "Draft" && can("quotes.manage") && <Button variant="primary" busy={busy} onClick={() => act(() => rpc("banking_quote_action", { p_quote: q.id, p_action: "issue" }))}>Issue</Button>}
            <Button onClick={() => printQuote(merge(q))}>Preview / PDF</Button>
            <Button onClick={() => act(() => downloadQuoteDocx(merge(q)))}>Word</Button>
            {["Issued", "Sent"].includes(q.status) && can("quotes.manage") && <>
              <Button onClick={() => act(async () => { await rpc("banking_quote_action", { p_quote: q.id, p_action: "send" }); const m = merge(q); window.location.href = `mailto:?subject=${encodeURIComponent(`Quotation ${m.quotation_number} from ${m.company_short}`)}&body=${encodeURIComponent(`Dear ${m.client_name},\n\nPlease find attached our quotation ${m.quotation_number} for AED ${m.total_plain}, valid until ${m.valid_until}.\n\nRegards,\n${m.company_short}`)}`; })}>Send to client</Button>
              <Button variant="primary" onClick={() => setDecide({ q, action: "accept" })}>Accept offer</Button>
              <Button onClick={() => setDecide({ q, action: "reject" })}>Reject offer</Button>
            </>}
            {["Draft", "Approval Required", "Issued", "Sent"].includes(q.status) && can("quotes.manage") && <Button onClick={() => setDecide({ q, action: "expire" })}>Expire</Button>}
            {q.status !== "Superseded" && !q.is_imported && can("quotes.manage") && <Button onClick={() => setRevise(q)}>Revise</Button>}
          </span>
        ) },
      ]} />
      {open && <QuoteEditor q={open} onClose={() => setOpen(null)} onSaved={async () => { await quotes.reload(); await reload(); }} />}
      {revise && <FormModal title={`Revise ${revise.quotation_number}`} onClose={() => setRevise(null)} fields={[{ name: "reason", label: "Reason", type: "textarea", required: true, full: true }]} submitLabel="Create new version"
        onSubmit={async (v) => { await rpc("banking_quote_revise", { p_quote: revise.id, p_reason: v.reason }); await quotes.reload(); await reload(); }} />}
      {decide && <FormModal title={`${decide.action[0].toUpperCase()}${decide.action.slice(1)} ${decide.q.quotation_number}`} onClose={() => setDecide(null)} fields={[{ name: "remarks", label: "Remarks", type: "textarea", full: true }]} submitLabel="Confirm"
        onSubmit={async (v) => { await rpc("banking_quote_action", { p_quote: decide.q.id, p_action: decide.action, p_remarks: v.remarks }); await quotes.reload(); await reload(); }} />}
    </Panel>
  );
}

function QuoteEditor({ q, onClose, onSaved }) {
  const services = useLoad(() => run(table("banking_supplementary_services").select("*").eq("is_active", true)), []);
  const [lines, setLines] = useState(() => [...q.banking_quotation_items].sort((a, b) => a.sort_order - b.sort_order).map((l) => ({ ...l })));
  const [fields, setFields] = useState({ valid_until: q.valid_until, payment_terms: q.payment_terms || "", remarks: q.remarks || "", vat_mode: q.vat_mode, vat_rate: q.vat_rate, initial_deposit_memo: q.initial_deposit_memo ?? "", minimum_balance_memo: q.minimum_balance_memo ?? "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const totals = quoteTotals(lines, fields.vat_mode, fields.vat_rate);
  const setLine = (i, patch) => setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const f = { ...fields, initial_deposit_memo: fields.initial_deposit_memo === "" ? null : fields.initial_deposit_memo, minimum_balance_memo: fields.minimum_balance_memo === "" ? null : fields.minimum_balance_memo };
      await rpc("banking_quote_save", { p_quote: q.id, p_fields: f, p_items: lines.map(({ item_type, description, quantity, unit_amount, payable_to, collected_through_ab, service_id, default_amount, override_reason }) => ({ item_type, description, quantity, unit_amount: Number(unit_amount), payable_to, collected_through_ab, service_id, default_amount, override_reason })) });
      await onSaved(); onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <Modal wide title={`${q.quotation_number} v${q.version}`} onClose={onClose}>
      <ErrorNote message={error || services.error} />
      {q.approval_reason && <div className="bk-alert bk-alert-warn">Approval needed: {q.approval_reason}</div>}
      <div className="bk-table-wrap">
        <table className="bk-table">
          <thead><tr><th>Type</th><th>Description</th><th className="bk-right">Amount (AED)</th><th>Paid to / through</th><th>Reason if changed from default</th><th /></tr></thead>
          <tbody>{lines.map((l, i) => (
            <tr key={i}>
              <td data-label="Type">{l.item_type}</td>
              <td data-label="Description"><input aria-label="Description" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></td>
              <td data-label="Amount" className="bk-right"><input aria-label="Amount" type="number" min="0" step="any" value={l.unit_amount} onChange={(e) => setLine(i, { unit_amount: e.target.value })} /> {Number(l.quantity ?? 1) !== 1 && `= ${lineAmount(l)}`}</td>
              <td data-label="Paid to">{l.item_type === "Bank Fee" ? <select aria-label="Collection" value={l.collected_through_ab === false ? "direct" : "ab"} onChange={(e) => setLine(i, { collected_through_ab: e.target.value === "ab" })}><option value="ab">Bank, collected through AB Capital</option><option value="direct">Bank, client pays directly (not in total)</option></select> : "AB Capital"}</td>
              <td data-label="Reason">{l.default_amount != null && Number(l.unit_amount) !== Number(l.default_amount) ? <input aria-label="Reason" placeholder={`Default ${l.default_amount}`} value={l.override_reason || ""} onChange={(e) => setLine(i, { override_reason: e.target.value })} /> : "–"}</td>
              <td><button type="button" className="bk-link" onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))}>Remove</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="bk-actions bk-mt bk-wrap">
        <Button onClick={() => setLines((l) => [...l, { item_type: "Bank Fee", description: "Bank fee", unit_amount: 0, payable_to: "Bank", collected_through_ab: true }])}>Add bank fee</Button>
        {(services.data || []).map((s) => <Button key={s.id} disabled={lines.some((l) => l.service_id === s.id)} onClick={() => setLines((l) => [...l, { item_type: "Supplementary", description: s.service_name, unit_amount: s.default_fee, default_amount: s.default_fee, service_id: s.id }])}>Add {s.service_name}</Button>)}
        <Button onClick={() => setLines((l) => [...l, { item_type: "Discount", description: "Discount", unit_amount: 0 }])}>Add discount</Button>
      </div>
      <div className="bk-grid bk-mt">
        <div className="bk-field"><label htmlFor="q-v">Valid until</label><input id="q-v" type="date" value={fields.valid_until || ""} onChange={(e) => setFields({ ...fields, valid_until: e.target.value })} /></div>
        <div className="bk-field"><label htmlFor="q-m">VAT treatment</label><select id="q-m" value={fields.vat_mode} onChange={(e) => setFields({ ...fields, vat_mode: e.target.value })}><option value="inclusive">Fees include VAT</option><option value="exclusive">VAT added on top</option><option value="none">No VAT</option></select></div>
        <div className="bk-field"><label htmlFor="q-d">Initial deposit (memo, client's money)</label><input id="q-d" type="number" value={fields.initial_deposit_memo} onChange={(e) => setFields({ ...fields, initial_deposit_memo: e.target.value })} /></div>
        <div className="bk-field"><label htmlFor="q-b">Minimum balance (memo, client's money)</label><input id="q-b" type="number" value={fields.minimum_balance_memo} onChange={(e) => setFields({ ...fields, minimum_balance_memo: e.target.value })} /></div>
        <div className="bk-field bk-full"><label htmlFor="q-t">Payment terms</label><textarea id="q-t" rows={2} value={fields.payment_terms} onChange={(e) => setFields({ ...fields, payment_terms: e.target.value })} /></div>
        <div className="bk-field bk-full"><label htmlFor="q-r">Remarks</label><textarea id="q-r" rows={2} value={fields.remarks} onChange={(e) => setFields({ ...fields, remarks: e.target.value })} /></div>
      </div>
      <KeyVals items={[["Bank fees", money(totals.bank_fee_total)], ["Of which paid directly to bank", money(totals.direct_to_bank_total)], ["AB Capital service fees", money(totals.service_fee_total)], ["Supplementary services", money(totals.supplementary_total)], ["Discount", money(totals.discount_total)], ["VAT", money(totals.vat_amount)], ["Total quotation", <strong key="t">{money(totals.total_amount)}</strong>]]} />
      <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Save draft</Button></div>
    </Modal>
  );
}

function Payments({ c, client, finance, reload }) {
  const { can, personName } = useBanking();
  const pays = useLoad(() => run(table("banking_payments").select("*, banking_receipts(receipt_number, issued_on)").eq("case_id", c.id).order("payment_date", { ascending: false }).order("created_at", { ascending: false })), [c.id]);
  const settings = useLoad(() => loadSettings(), []);
  const [adding, setAdding] = useState(false);
  const [counter, setCounter] = useState(null);
  const [adjust, setAdjust] = useState(false);
  const methods = settings.data?.payment_methods || [];
  const done = async () => { await pays.reload(); await reload(); };
  const { error, act } = useAction();
  return (
    <div>
      <Panel title="Payment summary">
        <KeyVals items={[["Total quotation", money(finance?.total)], ["Bank fees", money(finance?.bank_fees)], ["AB Capital fees", money(finance?.service_fees)], ["Supplementary fees", money(finance?.supplementary)], ["Discount", money(finance?.discount)], ["Total received", money(finance?.received)], ["Outstanding", money(finance?.outstanding)], ["Paid", `${finance?.paid_percent ?? 0}%`]]} />
      </Panel>
      <Panel title="Payment ledger" sub="Each entry is its own record. Mistakes are reversed, never edited."
        actions={<>{can("payments.manage") && <Button variant="primary" onClick={() => setAdding(true)}>Record payment</Button>}{can("payments.refund") && <Button onClick={() => setAdjust(true)}>Adjustment</Button>}</>}>
        <ErrorNote message={pays.error || error} />
        <DataTable rows={pays.data || []} empty="No payments recorded." columns={[
          { key: "payment_ref", label: "Ref" }, { key: "payment_date", label: "Date", render: (r) => fmtDate(r.payment_date) }, { key: "txn_type", label: "Type", render: (r) => <Badge tone={r.txn_type === "Payment" ? "good" : "warn"}>{r.txn_type}</Badge> },
          { key: "signed_amount", label: "Amount", right: true, render: (r) => money(r.signed_amount) }, { key: "payment_method", label: "Method" }, { key: "transaction_reference", label: "Reference" },
          { key: "reference_note", label: "Note" }, { key: "received_by", label: "Received by", render: (r) => r.received_by_text || personName(r.received_by) }, { key: "remarks", label: "Remarks" },
          { key: "a", label: "", render: (r) => (
            <span className="bk-actions">
              {r.banking_receipts && <Button onClick={() => printReceipt(r, client, c, settings.data?.company)}>Receipt {r.banking_receipts.receipt_number}</Button>}
              {r.document_path && <Button onClick={() => act(() => openFile(r.document_path))}>Proof</Button>}
              {r.txn_type === "Payment" && can("payments.manage") && <Button onClick={() => setCounter({ p: r, type: "Reversal" })}>Reverse</Button>}
              {r.txn_type === "Payment" && can("payments.refund") && <Button onClick={() => setCounter({ p: r, type: "Refund" })}>Refund</Button>}
            </span>
          ) },
        ]} />
      </Panel>
      {adding && <PaymentForm c={c} methods={methods} onClose={() => setAdding(false)} onDone={done} />}
      {counter && <FormModal title={`${counter.type} of ${counter.p.payment_ref} (${money(counter.p.amount)})`} initial={{ date: today() }} onClose={() => setCounter(null)}
        fields={[{ name: "date", label: "Date", type: "date", required: true }, ...(counter.type === "Refund" ? [{ name: "amount", label: "Refund amount (blank: the unrefunded balance)", type: "number" }] : []), { name: "reason", label: "Reason", type: "textarea", required: true, full: true }]}
        onSubmit={async (v) => { await rpc("banking_payment_counter", { p_payment: counter.p.id, p_type: counter.type, p_date: v.date, p_reason: v.reason, p_amount: v.amount ?? null }); await done(); }} />}
      {adjust && <FormModal title="Adjustment" initial={{ date: today() }} onClose={() => setAdjust(false)} note="Positive adds to received, negative reduces it."
        fields={[{ name: "date", label: "Date", type: "date", required: true }, { name: "amount", label: "Amount", type: "number", required: true }, { name: "reason", label: "Reason", type: "textarea", required: true, full: true }]}
        onSubmit={async (v) => { await rpc("banking_payment_adjust", { p_case: c.id, p_date: v.date, p_amount: v.amount, p_reason: v.reason }); await done(); }} />}
    </div>
  );
}

function PaymentForm({ c, methods, onClose, onDone }) {
  const [file, setFile] = useState(null);
  return (
    <FormModal wide title="Record payment" initial={{ date: today() }} onClose={onClose} submitLabel="Record and issue receipt"
      fields={[{ name: "date", label: "Payment date", type: "date", required: true }, { name: "amount", label: "Amount (AED)", type: "number", required: true }, { name: "method", label: "Payment method", type: "select", options: methods, required: true }, { name: "reference", label: "Transaction reference" }, { name: "note", label: "Reference note" }, { name: "description", label: "Description" }, { name: "remarks", label: "Remarks", type: "textarea", full: true }]}
      note={<>Proof (optional): <input type="file" aria-label="Proof of payment" onChange={(e) => setFile(e.target.files?.[0] || null)} /></>}
      onSubmit={async (v) => {
        const u = file ? await uploadFile(c.id, "payments", file) : null;
        await rpc("banking_payment_add", { p_case: c.id, p_date: v.date, p_amount: v.amount, p_method: v.method, p_reference: v.reference, p_note: v.note, p_description: v.description, p_remarks: v.remarks, p_path: u?.path ?? null });
        await onDone();
      }} />
  );
}

function Agreement({ c, reload }) {
  const { can } = useBanking();
  const letters = useLoad(() => run(table("banking_engagement_letters").select("*").eq("case_id", c.id).order("created_at", { ascending: false })), [c.id]);
  const [sign, setSign] = useState(null);
  const [file, setFile] = useState(null);
  const done = async () => { await letters.reload(); await reload(); };
  const { error, busy, act } = useAction(done);
  return (
    <Panel title="Engagement letter" sub="Generated from the accepted quotation." actions={can("agreements.manage") && <Button variant="primary" busy={busy} onClick={() => act(() => rpc("banking_letter_generate", { p_case: c.id }))}>Generate letter</Button>}>
      <ErrorNote message={letters.error || error} />
      <DataTable rows={letters.data || []} empty="Not generated yet." columns={[
        { key: "letter_number", label: "Number", render: (l) => `${l.letter_number} v${l.version}` }, { key: "letter_date", label: "Date", render: (l) => fmtDate(l.letter_date) }, { key: "status", label: "Status", render: (l) => <Badge>{l.status}</Badge> }, { key: "signed_at", label: "Signed", render: (l) => fmtDate(l.signed_at) }, { key: "signatory_name", label: "Signatory" },
        { key: "a", label: "", render: (l) => (
          <span className="bk-actions bk-wrap">
            <Button onClick={() => printLetter(l)}>Preview / PDF</Button>
            <Button onClick={() => act(() => downloadLetterDocx(l))}>Word</Button>
            {l.signed_document_path && <Button onClick={() => act(() => openFile(l.signed_document_path))}>Signed copy</Button>}
            {can("agreements.manage") && !["Signed", "Cancelled"].includes(l.status) && <>
              {l.status === "Draft" && <Button busy={busy} onClick={() => act(() => rpc("banking_letter_action", { p_letter: l.id, p_action: "send" }))}>Sent to client</Button>}
              <Button variant="primary" onClick={() => setSign(l)}>Record signature</Button>
              <Button busy={busy} onClick={() => act(() => rpc("banking_letter_action", { p_letter: l.id, p_action: "reject", p_remarks: "Client rejected" }))}>Client rejected</Button>
              <Button busy={busy} onClick={() => act(() => rpc("banking_letter_action", { p_letter: l.id, p_action: "cancel", p_remarks: "Cancelled" }))}>Cancel</Button>
            </>}
          </span>
        ) },
      ]} />
      {sign && <FormModal title={`Record signature · ${sign.letter_number}`} initial={{ signed_at: today() }} onClose={() => setSign(null)} note={<>Signed document (required): <input type="file" aria-label="Signed document" onChange={(e) => setFile(e.target.files?.[0] || null)} /></>}
        fields={[{ name: "signed_at", label: "Signature date", type: "date", required: true }, { name: "signatory", label: "Signed by", required: true }]}
        onSubmit={async (v) => {
          if (!file) throw new Error("Upload the signed document");
          const u = await uploadFile(c.id, "agreements", file);
          await rpc("banking_letter_action", { p_letter: sign.id, p_action: "sign", p_path: u.path, p_signed_at: v.signed_at, p_signatory: v.signatory });
          setFile(null); await done();
        }} />}
    </Panel>
  );
}

function Application({ c, gates, reload }) {
  const { can, personOptions } = useBanking();
  const apps = useLoad(() => run(table("banking_applications").select("*, banking_partners(bank_name), banking_schemes(scheme_name)").eq("case_id", c.id).order("created_at", { ascending: false })), [c.id]);
  const app = (apps.data || []).find((a) => a.is_active) || apps.data?.[0];
  const hist = useLoad(() => (app ? run(table("banking_application_status_history").select("*").eq("application_id", app.id).order("created_at", { ascending: false })) : Promise.resolve([])), [app?.id]);
  const appts = useLoad(() => (app ? run(table("banking_appointments").select("*").eq("application_id", app.id).order("appointment_at", { ascending: false })) : Promise.resolve([])), [app?.id]);
  const rms = useLoad(() => (app?.bank_id ? run(table("banking_relationship_managers").select("id, full_name").eq("bank_id", app.bank_id).eq("is_active", true)) : Promise.resolve([])), [app?.bank_id]);
  const [openOverride, setOpenOverride] = useState(false);
  const [edit, setEdit] = useState(false);
  const [status, setStatus] = useState(false);
  const [appt, setAppt] = useState(null);
  const refresh = async () => { await apps.reload(); await hist.reload(); await reload(); };
  const { error, busy, act } = useAction(refresh);
  return (
    <div>
      <Panel title="Application workspace" sub={app ? `${app.application_ref} · ${app.banking_partners?.bank_name || ""}` : "Opens once the engagement letter is signed."}
        actions={<>
          {can("apps.manage") && !(apps.data || []).some((a) => a.is_active) && gates?.letter_signed && <Button variant="primary" busy={busy} onClick={() => act(() => rpc("banking_application_open", { p_case: c.id }))}>Open application</Button>}
          {can("workflow.override") && !gates?.letter_signed && !(apps.data || []).some((a) => a.is_active) && <Button onClick={() => setOpenOverride(true)}>Open with authorised exception</Button>}
          {app?.is_active && can("apps.manage") && <><Button onClick={() => setEdit(true)}>Edit details</Button><Button variant="primary" onClick={() => setStatus(true)}>Update status</Button></>}
        </>}>
        <ErrorNote message={apps.error || error} />
        {app && <KeyVals items={[["Status", <Badge key="s">{app.status}</Badge>], ["Bank", app.banking_partners?.bank_name], ["Scheme", app.banking_schemes?.scheme_name], ["Application date", fmtDate(app.application_date)], ["Submission method", app.submission_method], ["Bank reference", app.bank_reference], ["Submission date", fmtDate(app.submission_date)], ["Relationship manager", app.relationship_manager_text], ["Next follow-up", fmtDate(app.next_follow_up)], ["Form prepared", app.form_prepared ? "Yes" : "No"], ["Bank remarks", app.bank_remarks], ["Internal remarks", app.internal_remarks], ...(app.override_justification ? [["Opened by exception", app.override_justification]] : []), ...(app.historical_date ? [["Excel 'opening date'", fmtDate(app.historical_date)]] : [])]} />}
      </Panel>
      {app && (
        <Panel title="Bank appointments" actions={can("apps.manage") && <Button onClick={() => setAppt({ status: "Scheduled" })}>Add appointment</Button>}>
          <DataTable rows={appts.data || []} onRow={can("apps.manage") ? setAppt : undefined} empty="None." columns={[{ key: "appointment_at", label: "When", render: (r) => fmtDateTime(r.appointment_at) }, { key: "location", label: "Location" }, { key: "relationship_manager_text", label: "RM" }, { key: "status", label: "Status", render: (r) => <Badge>{r.status}</Badge> }, { key: "remarks", label: "Remarks" }]} />
        </Panel>
      )}
      {app && (
        <Panel title="Status history">
          <ErrorNote message={hist.error} />
          <DataTable rows={hist.data || []} columns={[{ key: "created_at", label: "When", render: (r) => fmtDateTime(r.created_at) }, { key: "previous_status", label: "From" }, { key: "new_status", label: "To", render: (r) => <Badge>{r.new_status}</Badge> }, { key: "remarks", label: "Remarks" }, { key: "next_follow_up", label: "Next follow-up", render: (r) => fmtDate(r.next_follow_up) }, { key: "is_override", label: "Override", render: (r) => (r.is_override ? <Badge tone="warn">Override</Badge> : "–") }, { key: "doc", label: "Doc", render: (r) => (r.supporting_document_path ? <button type="button" className="bk-link" onClick={() => act(() => openFile(r.supporting_document_path))}>Open</button> : "–") }]} />
        </Panel>
      )}
      {openOverride && <FormModal title="Open application by exception" onClose={() => setOpenOverride(false)} fields={[{ name: "why", label: "Justification", type: "textarea", required: true, full: true }]} onSubmit={async (v) => { await rpc("banking_application_open", { p_case: c.id, p_override: v.why }); await refresh(); }} />}
      {edit && app && <FormModal wide title="Application details" initial={app} onClose={() => setEdit(false)} fields={[
        { name: "assigned_to", label: "Assigned employee", type: "select", options: personOptions }, { name: "submission_method", label: "Submission method", type: "select", options: SUBMISSION_METHODS }, { name: "relationship_manager_text", label: "Relationship manager", help: (rms.data || []).map((r) => r.full_name).join(", ") || "None set up for this bank" },
        { name: "bank_reference", label: "Application reference number" }, { name: "application_date", label: "Application date", type: "date" }, { name: "submission_date", label: "Submission date", type: "date" }, { name: "appointment_location", label: "Appointment location" }, { name: "next_follow_up", label: "Next follow-up", type: "date" }, { name: "form_prepared", label: "Application form prepared", type: "bool" }, { name: "bank_remarks", label: "Bank remarks", type: "textarea", full: true }, { name: "internal_remarks", label: "Internal remarks", type: "textarea", full: true },
      ]} onSubmit={async (v) => { await rpc("banking_application_update", { p_app: app.id, p: v }); await refresh(); }} />}
      {status && app && <StatusForm app={app} c={c} onClose={() => setStatus(false)} onDone={refresh} />}
      {appt && <FormModal title="Bank appointment" initial={{ ...appt, appointment_at: appt.appointment_at ? appt.appointment_at.slice(0, 16) : "" }} onClose={() => setAppt(null)} fields={[{ name: "appointment_at", label: "Date and time", type: "datetime", required: true }, { name: "location", label: "Location" }, { name: "relationship_manager_text", label: "Relationship manager" }, { name: "attendees", label: "Attendees" }, { name: "status", label: "Status", type: "select", options: ["Scheduled", "Completed", "Rescheduled", "Cancelled", "No Show"], required: true }, { name: "remarks", label: "Remarks", type: "textarea", full: true }]}
        onSubmit={async (v) => { if (appt.id) await updateRow("banking_appointments", appt.id, v); else await insertRow("banking_appointments", { ...v, case_id: c.id, application_id: app.id }); await appts.reload(); }} />}
    </div>
  );
}

function StatusForm({ app, c, onClose, onDone }) {
  const { can } = useBanking();
  const [file, setFile] = useState(null);
  return (
    <FormModal title={`Update status (now: ${app.status})`} onClose={onClose} submitLabel="Update" note={<>Supporting document (optional): <input type="file" aria-label="Supporting document" onChange={(e) => setFile(e.target.files?.[0] || null)} /></>}
      fields={[{ name: "status", label: "New status", type: "select", required: true, options: APP_STATUSES.filter((s) => s !== app.status && s !== "Not Started") }, { name: "remarks", label: "Remarks", type: "textarea", full: true }, { name: "next", label: "Next follow-up date", type: "date" }, ...(can("workflow.override") ? [{ name: "override", label: "Override justification (only to bypass a rule)", type: "textarea", full: true }] : [])]}
      onSubmit={async (v) => {
        const u = file ? await uploadFile(c.id, "applications", file) : null;
        await rpc("banking_application_set_status", { p_app: app.id, p_status: v.status, p_remarks: v.remarks, p_next: v.next, p_path: u?.path ?? null, p_override: v.override ?? null });
        await onDone();
      }} />
  );
}

function CaseTasks({ c }) {
  const { can, personOptions, personName } = useBanking();
  const tasks = useLoad(() => run(table("banking_tasks").select("*").eq("case_id", c.id).order("created_at", { ascending: false })), [c.id]);
  const [edit, setEdit] = useState(null);
  return (
    <Panel title="Tasks" actions={can("tasks.manage") && <Button variant="primary" onClick={() => setEdit({ priority: "Medium", status: "Open", assigned_to: c.assigned_to })}>New task</Button>}>
      <ErrorNote message={tasks.error} />
      <DataTable rows={tasks.data || []} onRow={can("tasks.manage") ? setEdit : undefined} empty="No tasks." columns={[{ key: "task_ref", label: "Task" }, { key: "task_type", label: "Type" }, { key: "title", label: "Title" }, { key: "assigned_to", label: "Employee", render: (r) => personName(r.assigned_to) }, { key: "priority", label: "Priority" }, { key: "due_date", label: "Due", render: (r) => <span className={r.due_date && r.due_date < today() && !["Completed", "Cancelled"].includes(r.status) ? "bk-overdue" : ""}>{fmtDate(r.due_date)}</span> }, { key: "status", label: "Status", render: (r) => <Badge>{r.status}</Badge> }]} />
      {edit && <FormModal title={edit.id ? edit.task_ref : "New task"} initial={edit} onClose={() => setEdit(null)} fields={taskFields(personOptions)} onSubmit={async (v) => { const row = { ...v, completed_at: v.status === "Completed" ? new Date().toISOString() : null }; if (edit.id) await updateRow("banking_tasks", edit.id, row); else await insertRow("banking_tasks", { ...row, case_id: c.id }); await tasks.reload(); }} />}
    </Panel>
  );
}

export const taskFields = (personOptions) => [{ name: "task_type", label: "Task type", type: "select", options: TASK_TYPES, required: true }, { name: "title", label: "Title" }, { name: "assigned_to", label: "Assigned employee", type: "select", options: personOptions }, { name: "priority", label: "Priority", type: "select", options: PRIORITIES, required: true }, { name: "due_date", label: "Due date", type: "date" }, { name: "status", label: "Status", type: "select", options: TASK_STATUSES, required: true }, { name: "remarks", label: "Remarks", type: "textarea", full: true }];

function History({ c }) {
  const { can, personName } = useBanking();
  const timeline = useLoad(() => rpc("banking_case_timeline", { p_case: c.id }), [c.id]);
  const logs = useLoad(() => (can("audit.view") ? listCaseLogs(c.id) : Promise.resolve([])), [c.id]);
  return (
    <div>
      <Panel title="Timeline"><ErrorNote message={timeline.error} />
        <DataTable rows={timeline.data || []} pageSize={40} empty="Nothing yet." columns={[{ key: "at", label: "When", render: (r) => fmtDateTime(r.at) }, { key: "kind", label: "Kind" }, { key: "summary", label: "What happened" }, { key: "who", label: "By" }]} />
      </Panel>
      {can("audit.view") && <Panel title="Audit trail" sub="Every recorded change. Passport and Emirates ID values are masked.">
        <DataTable rows={logs.data || []} pageSize={25} columns={[{ key: "occurred_at", label: "When", render: (r) => fmtDateTime(r.occurred_at) }, { key: "action", label: "Action" }, { key: "entity_table", label: "Record", render: (r) => r.entity_table.replace("banking_", "") }, { key: "actor", label: "By", render: (r) => personName(r.actor) }, { key: "d", label: "Changed", render: (r) => <code className="bk-code">{r.action === "UPDATE" ? JSON.stringify(r.new_data) : ""}</code> }]} />
      </Panel>}
    </div>
  );
}

const listCaseLogs = (id) => run(table("banking_activity_logs").select("*").eq("case_id", id).order("occurred_at", { ascending: false }).limit(300));
