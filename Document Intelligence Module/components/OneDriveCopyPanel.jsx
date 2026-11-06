import { useEffect, useState } from "react";
import { Badge, Button, DataTable, Empty, ErrorNote, KeyVals, Panel, Spinner, useLoad } from "@banking/components/shared";
import { approve, canRead, loadIssues, loadReport, loadSettings, setStage } from "../services/odCopyApi";
import { approveConfirmText, approveSummary, canPause, failedNote, formatBytes, pilotVerified, progress, stageLabel } from "../logic/odCopyView";

const LISTS = [
  ["duplicates", "Duplicates skipped"],
  ["review", "To review"],
  ["unmatched", "Unmatched"],
  ["failed", "Failed"],
];
const sum = (rows, key) => rows.reduce((t, r) => t + (Number(r[key]) || 0), 0);
// Approvals are possible once the plan is built, and again after a run finished.
const APPROVABLE = ["plan", "approved", "copying", "done"];

// Settings > OneDrive Copy. Admins and the CEO only: an admin sees it at once; anyone else only after
// od_copy.can_read() (the same rule as the database's Row Level Security) says yes. Nothing else loads before that.
export default function OneDriveCopyPanel({ isAdmin }) {
  if (!isAdmin) return <AccessCheck />;
  return <Loaded />;
}

function AccessCheck() {
  const access = useLoad(canRead, []);
  if (access.loading) return <Spinner />;
  if (access.data !== true) return <Empty>The OneDrive copy is for admins and the CEO only.</Empty>;
  return <Loaded />;
}

function Loaded() {
  const [tick, setTick] = useState(0);
  const [list, setList] = useState("failed");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [pilotClient, setPilotClient] = useState("");
  const [area, setArea] = useState("");
  const settings = useLoad(loadSettings, [tick]);
  const report = useLoad(loadReport, [tick]);
  const issues = useLoad(() => loadIssues(list), [list, tick]);

  // Counts follow the copy while it runs.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const stage = settings.data?.stage || "idle";
  const rows = report.data || [];
  const p = progress(rows);
  const act = async (name, fn) => {
    setBusy(name); setError(null);
    try { await fn(); setTick((n) => n + 1); } catch (e) { setError(e.message); }
    setBusy(null);
  };
  const canApprove = APPROVABLE.includes(stage);
  // Bulk approval only after the pilot: at least one copy verified (the database refuses it too).
  const canBulk = canApprove && pilotVerified(rows);
  const approveBulk = (scope, label) => {
    const chosen = area || null;
    const summary = approveSummary(rows, scope, chosen);
    if (!window.confirm(approveConfirmText(label, summary, chosen))) return;
    act(scope, () => approve(scope, chosen));
  };
  const approvePilot = () => {
    const id = pilotClient.trim();
    if (!id) return;
    if (!window.confirm(`Copy client ${id} only (pilot)? Copying starts as soon as you confirm. Check the result in OneDrive before approving the rest.`)) return;
    act("client", () => approve("client", id));
  };

  return (
    <>
      <Panel title="OneDrive copy" sub="Copies the old OneDrive folder into CRM AB CAPITAL. The old folder is only read.">
        <ErrorNote message={error || settings.error || report.error} onClose={error ? () => setError(null) : undefined} />
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <strong>{stageLabel(stage)}</strong>
          <Badge tone={stage === "done" ? "good" : stage === "paused" ? "warn" : "plain"}>{stage}</Badge>
          {p.total > 0 && <span>{p.verified} of {p.total} files copied and checked ({p.pct}%)</span>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <Button variant="primary" disabled={stage !== "idle"} busy={busy === "inventory"} onClick={() => act("inventory", () => setStage("inventory"))}>Start listing</Button>
          <Button disabled={!canPause(stage)} busy={busy === "paused"} onClick={() => act("paused", () => setStage("paused"))}>Pause</Button>
          <Button disabled={stage !== "paused"} busy={busy === "resume"} onClick={() => act("resume", () => setStage("resume"))}>Resume</Button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <label>
            Client code{" "}
            <input type="text" value={pilotClient} onChange={(e) => setPilotClient(e.target.value)} placeholder="CL000000" aria-label="Client code for the pilot" />
          </label>
          <Button disabled={!canApprove || !pilotClient.trim()} busy={busy === "client"} onClick={approvePilot}>Copy one client (pilot)</Button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label>
            Old area{" "}
            <select value={area} onChange={(e) => setArea(e.target.value)} aria-label="Old area to approve">
              <option value="">All areas</option>
              {rows.map((r) => <option key={r.area} value={r.area}>{r.area}</option>)}
            </select>
          </label>
          <Button disabled={!canBulk} busy={busy === "all"} onClick={() => approveBulk("all", "Approve matched and fixed")}>Approve matched and fixed</Button>
          <Button disabled={!canBulk} busy={busy === "unmatched"} onClick={() => approveBulk("unmatched", "Approve unmatched")}>Approve unmatched</Button>
        </div>
        {canApprove && !canBulk && <small>Copy one client first (pilot) and check it in OneDrive. The bulk buttons open once a pilot copy is verified.</small>}
      </Panel>

      <Panel title="Counts">
        {report.loading && !report.data ? <Spinner /> : (
          <>
            <KeyVals items={[
              ["Files", sum(rows, "files")],
              ["Size", formatBytes(sum(rows, "gb") * 1073741824)],
              ["Duplicates skipped", sum(rows, "duplicates")],
              ["Verified", sum(rows, "verified")],
              ["Verified by size only (no hash)", sum(rows, "verified_size_only")],
              ["Failed", sum(rows, "failed")],
            ]} />
            <DataTable rows={rows.map((r) => ({ ...r, id: r.area }))} empty="Nothing listed yet." pageSize={50} columns={[
              { key: "area", label: "Old area" },
              { key: "files", label: "Files", right: true },
              { key: "gb", label: "GB", right: true },
              { key: "duplicates", label: "Duplicates", right: true },
              { key: "verified", label: "Verified", right: true },
              { key: "verified_size_only", label: "Size only", right: true },
              { key: "failed", label: "Failed", right: true },
            ]} />
          </>
        )}
      </Panel>

      <Panel title="Lists" sub="Paths only. No file content is shown.">
        <div role="tablist" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {LISTS.map(([key, label]) => (
            <button type="button" role="tab" key={key} aria-selected={list === key} className={list === key ? "active" : ""} onClick={() => setList(key)}>{label}</button>
          ))}
        </div>
        <ErrorNote message={issues.error} />
        {issues.loading && !issues.data ? <Spinner /> : (
          <DataTable rows={issues.data || []} empty="Nothing in this list." columns={[
            { key: "path", label: "Path" },
            { key: "note", label: "Note", render: (r) => (
              <>
                {r.note}
                {(r.locations || []).map((loc) => <div key={loc}><small>{loc}</small></div>)}
                {r.skipped > 0 && <div><small>{failedNote(r.skipped)}</small></div>}
              </>
            ) },
          ]} />
        )}
        {list === "failed" && <small>Failed files need a person: check the destination, then ask for a retry.</small>}
      </Panel>
    </>
  );
}
