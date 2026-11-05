// Loads the department's old records. A person reads the counts, decides held rows, then applies. Nothing is sent to clients.
import { useState } from "react";
import { Button, DataTable, ErrorNote, FormModal, PageHead, Panel, Spinner, useAction, useLoad } from "@banking/components/shared";
import { importApply, importDecide, importReport, latestImport } from "../services/businessSetupApi";

const COLS = ["total", "matched", "new", "held", "skip", "report", "applied", "missing_email", "missing_phone"];

export default function Import() {
  const id = useLoad(() => latestImport(), []);
  const report = useLoad(() => (id.data ? importReport(id.data) : Promise.resolve(null)), [id.data]);
  const { error, setError, busy, act } = useAction(report.reload);
  const [decide, setDecide] = useState(null);
  const [done, setDone] = useState(null);
  if (id.loading && !id.data) return <Spinner />;
  const r = report.data;
  const sources = Object.entries(r?.sources || {}).map(([source, c]) => ({ id: source, source, ...c }));
  const ready = sources.reduce((n, s) => n + Number(s.matched || 0) + Number(s.new || 0), 0);
  return (
    <div>
      <PageHead title="Import" sub="Exact names link. Everything else waits here for a person. Existing values are never overwritten.">
        {r && <Button variant="primary" busy={busy} disabled={!ready} onClick={() => { if (window.confirm(`Load ${ready} rows into the CRM? No login is issued and nothing is sent to clients.`)) act(async () => setDone(await importApply(id.data))); }}>Apply {ready} rows</Button>}
      </PageHead>
      <ErrorNote message={id.error || report.error || error} onClose={error ? () => setError(null) : undefined} />
      {done && <div className="bk-alert bk-alert-ok">{done.applied} rows loaded. {done.held} rows are held.</div>}
      {!id.data && <p className="bk-note">Nothing has been staged yet.</p>}
      {r && <>
        <Panel title="Counts"><DataTable rows={sources} columns={[{ key: "source", label: "Source" }, ...COLS.map((c) => ({ key: c, label: c.replace("_", " "), right: true }))]} /></Panel>
        <Panel title="Held rows" sub="A held row does not stop the others.">
          <DataTable rows={r.held} search="Search…" empty="Nothing held." columns={[{ key: "source", label: "Source" }, { key: "name", label: "Name" }, { key: "company", label: "Company" }, { key: "reason", label: "Why" },
            { key: "x", label: "", render: (h) => <span className="bk-actions"><Button onClick={() => setDecide(h)}>Link</Button>{h.source === "company" && <Button busy={busy} onClick={() => act(() => importDecide(h.id, null, "new"))}>New client</Button>}<Button busy={busy} onClick={() => act(() => importDecide(h.id, null, "skip"))}>Skip</Button></span> }]} />
        </Panel>
        <Panel title="Kept values" sub="The CRM already held a different value, so it was kept."><DataTable rows={r.differences} empty="No differences." columns={[{ key: "name", label: "Name" }, { key: "client_id", label: "Client ID" }, { key: "reason", label: "Fields" }]} /></Panel>
        <Panel title="Old quotations" sub="Listed only: their prices were blank in the export."><DataTable rows={r.quotations} empty="None." columns={[{ key: "name", label: "Name" }, { key: "zone", label: "Zone" }, { key: "date", label: "Date" }]} /></Panel>
      </>}
      {decide && <FormModal title={`Link ${decide.name}`} fields={[{ name: "client", label: "Client", type: "clientCode", required: true }]} onClose={() => setDecide(null)} onSubmit={async (v) => { await importDecide(decide.id, v.client, "matched"); await report.reload(); }} />}
    </div>
  );
}
