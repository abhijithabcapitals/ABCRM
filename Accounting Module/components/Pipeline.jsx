// The job list: status chips with counts, filters, and a row opens the job.
import { useMemo, useState } from "react";
import { Badge, Button, ClosedSection, DataTable, ErrorNote, PageHead, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { profiles } from "@banking/services/bankingApi";
import { WORK_STATUSES, assigneeText, splitJobs, statusCounts, toInvoiceCount } from "../logic/jobs";
import { listJobs } from "../services/jobsApi";
import JobForm from "./JobForm";

const PAY_TONE = { Settled: "good", Overpaid: "bad", "Part paid": "warn", "No fee": "warn" };

export default function Pipeline({ onOpen }) {
  const jobs = useLoad(listJobs, []);
  const people = useLoad(profiles, []);
  const [filters, setFilters] = useState({ service: "", assignee: "", status: "", toInvoice: false });
  const [creating, setCreating] = useState(false);
  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));

  const rows = jobs.data || [];
  const nameById = useMemo(() => Object.fromEntries((people.data || []).map((p) => [p.id, p.full_name])), [people.data]);
  const services = useMemo(() => [...new Set(rows.map((r) => r.service_name).filter(Boolean))].sort(), [rows]);
  const assignees = useMemo(() => [...new Set(rows.flatMap((r) => r.assignee_ids || []))].map((id) => [id, nameById[id] || "Unknown user"]).sort((a, b) => a[1].localeCompare(b[1])), [rows, nameById]);
  const counts = statusCounts(rows, filters);
  const { open, closed } = splitJobs(rows, filters);

  const columns = [
    { key: "job_number", label: "Job" },
    { key: "client_name", label: "Client" },
    { key: "service_name", label: "Service" },
    { key: "period_label", label: "Period" },
    { key: "assignees", label: "Assignees", render: (r) => assigneeText(r, nameById) || "–" },
    { key: "work_status", label: "Work status", render: (r) => <Badge>{r.work_status}</Badge> },
    { key: "payment_status", label: "Payment status", render: (r) => <><Badge tone={PAY_TONE[r.payment_status]}>{r.payment_status}</Badge>{r.needs_invoice && r.payment_status === "No fee" && <> <Badge tone="warn">Fee missing</Badge></>}</> },
    { key: "remarks", label: "Remarks" },
    { key: "created_at", label: "Created", render: (r) => fmtDate(r.created_at) },
  ];
  const table = (list, empty) => <DataTable rows={list} columns={columns} onRow={(r) => onOpen(r.id)} search="Search jobs" empty={empty} />;

  return (
    <div>
      <PageHead title="Pipeline" sub={`${open.length} jobs in view`}>
        <Button variant="primary" onClick={() => setCreating(true)}>New job</Button>
      </PageHead>
      <ErrorNote message={jobs.error || people.error} />
      <div className="bk-filter" role="group" aria-label="Work status">
        {WORK_STATUSES.map((s) => (
          <button type="button" key={s} aria-pressed={filters.status === s} className={`bk-chip ${filters.status === s ? "active" : ""}`} onClick={() => set({ status: filters.status === s ? "" : s })}>{s} {counts[s]}</button>
        ))}
        <button type="button" aria-pressed={filters.toInvoice} className={`bk-chip ${filters.toInvoice ? "active" : ""}`} onClick={() => set({ toInvoice: !filters.toInvoice })}>To invoice {toInvoiceCount(rows, filters)}</button>
        <select aria-label="Service" value={filters.service} onChange={(e) => set({ service: e.target.value })}>
          <option value="">All services</option>{services.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="Assignee" value={filters.assignee} onChange={(e) => set({ assignee: e.target.value })}>
          <option value="">All assignees</option>{assignees.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </div>
      {jobs.loading && !jobs.data ? <Spinner /> : table(open, "No jobs match.")}
      <ClosedSection count={closed.length} label="Completed and cancelled">{table(closed, "Nothing here.")}</ClosedSection>
      {creating && <JobForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); jobs.reload(); }} />}
    </div>
  );
}
