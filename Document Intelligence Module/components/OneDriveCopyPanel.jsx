import { useEffect, useState } from "react";
import { Badge, Button, DataTable, Empty, ErrorNote, KeyVals, Panel, Spinner, useLoad } from "@banking/components/shared";
import { approve, loadIssues, loadReport, loadSettings, setStage } from "../services/odCopyApi";
import { failedNote, formatBytes, progress, stageLabel } from "../logic/odCopyView";

const LISTS = [
  ["duplicates", "Duplicates skipped"],
  ["review", "To review"],
  ["unmatched", "Unmatched"],
  ["failed", "Failed"],
];
const sum = (rows, key) => rows.reduce((t, r) => t + (Number(r[key]) || 0), 0);

// Settings > OneDrive Copy. Admins only: nothing is loaded until the admin check passes.
export default function OneDriveCopyPanel({ isAdmin }) {
  if (!isAdmin) return <Empty>The OneDrive copy is for admins only.</Empty>;
  return <Loaded />;
}

function Loaded() {
  const [tick, setTick] = useState(0);
  const [list, setList] = useState("failed");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
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
  const approveScope = (scope, label) => {
    if (!window.confirm(`${label}? Copying starts as soon as you confirm. Files are copied, never moved or deleted in the old folder.`)) return;
    act(scope, () => approve(scope));
  };
  const canApprove = ["plan", "approved", "copying", "done"].includes(stage);

  return (
    <>
      <Panel title="OneDrive copy" sub="Copies the old OneDrive folder into CRM AB CAPITAL. The old folder is only read.">
        <ErrorNote message={error || settings.error || report.error} onClose={error ? () => setError(null) : undefined} />
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <strong>{stageLabel(stage)}</strong>
          <Badge tone={stage === "done" ? "good" : stage === "paused" ? "warn" : "plain"}>{stage}</Badge>
          {p.total > 0 && <span>{p.verified} of {p.total} files copied and checked ({p.pct}%)</span>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="primary" disabled={stage !== "idle"} busy={busy === "inventory"} onClick={() => act("inventory", () => setStage("inventory"))}>Start listing</Button>
          <Button disabled={!canApprove} busy={busy === "all"} onClick={() => approveScope("all", "Approve matched and fixed")}>Approve matched and fixed</Button>
          <Button disabled={!canApprove} busy={busy === "unmatched"} onClick={() => approveScope("unmatched", "Approve unmatched")}>Approve unmatched</Button>
          <Button disabled={!["inventory", "plan", "approved", "copying"].includes(stage)} busy={busy === "paused"} onClick={() => act("paused", () => setStage("paused"))}>Pause</Button>
          <Button disabled={stage !== "paused"} busy={busy === "resume"} onClick={() => act("resume", () => setStage("resume"))}>Resume</Button>
        </div>
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
            { key: "note", label: "Note", render: (r) => <>{r.note}{r.skipped > 0 && <div><small>{failedNote(r.skipped)}</small></div>}</> },
          ]} />
        )}
        {list === "failed" && <small>Failed files need a person: check the destination, then ask for a retry.</small>}
      </Panel>
    </>
  );
}
