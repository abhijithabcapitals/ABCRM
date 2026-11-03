import { useMemo, useState } from "react";
import { Badge, Button, DataTable, ErrorNote, Panel, useAction } from "@banking/components/shared";
import { approve, setVisibility } from "../services/knowledgeApi";
import { needsReview } from "../logic/status.js";

const PRICE = "knowledge_price_lines";
const ENTRY = "knowledge_entries";
const FILTERS = { all: () => true, draft: (r) => r.status === "Draft", internal: (r) => r.visibility === "Internal", low: (r) => r.confidence === "Low" };

// Admin only. Lists Draft, Internal and Low confidence items. basis, confidence and payee appear here and in EditForm only.
// lines already carry those three from knowledge_price_line_review(); reviewLoaded is false while they are missing.
export default function NeedsReview({ lines, entries, reviewLoaded, reviewError, isAdmin, onEdit, reload }) {
  const [picked, setPicked] = useState(() => new Set());
  const [filter, setFilter] = useState("all");
  const [done, setDone] = useState(null);
  const { error, busy, act } = useAction();

  const rows = useMemo(() => [
    ...lines.map((l) => ({ ...l, table: PRICE, key: `${PRICE}:${l.id}`, kind: "price", label: `${l.template} - ${l.item}` })),
    ...entries.map((e) => ({ ...e, table: ENTRY, key: `${ENTRY}:${e.id}`, kind: "entry", label: e.title })),
  ].filter((r) => needsReview(r) && FILTERS[filter](r)), [lines, entries, filter]);
  if (!isAdmin) return null;

  const toggle = (key) => setPicked((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const chosen = rows.filter((r) => picked.has(r.key));

  // Runs one service call per table. The service throws unless every row changed, so a failure is shown and no success is claimed.
  const run = async (verb, call) => {
    setDone(null);
    const result = await act(async () => {
      try {
        for (const table of [PRICE, ENTRY]) {
          const ids = chosen.filter((r) => r.table === table).map((r) => r.id);
          if (ids.length) await call(table, ids);
        }
        return `${chosen.length} item${chosen.length === 1 ? "" : "s"} ${verb}.`;
      } finally { await reload(); } // some rows may have changed before a later failure
    });
    if (result) { setDone(result); setPicked(new Set()); }
  };

  const privateValue = (r, field) => (r.kind === "price" && !reviewLoaded ? "Not loaded" : r[field] || "–");
  const columns = [
    { key: "pick", label: "", render: (r) => <input type="checkbox" aria-label={`Select ${r.label}`} checked={picked.has(r.key)} onChange={() => toggle(r.key)} /> },
    { key: "label", label: "Item", render: (r) => r.label },
    { key: "department", label: "Department", render: (r) => r.knowledge_categories?.name || "–" },
    { key: "status", label: "Status", render: (r) => <Badge tone={r.status === "Draft" ? "warn" : "good"}>{r.status}</Badge> },
    { key: "visibility", label: "Visibility", render: (r) => <Badge tone={r.visibility === "Internal" ? "bad" : "plain"}>{r.visibility}</Badge> },
    { key: "confidence", label: "Confidence", render: (r) => privateValue(r, "confidence") },
    { key: "basis", label: "Basis", render: (r) => privateValue(r, "basis") },
    { key: "payee", label: "Payee", render: (r) => privateValue(r, "payee") },
    { key: "edit", label: "", render: (r) => <Button onClick={() => onEdit(r.kind, r)}>Edit</Button> },
  ];

  return (
    <Panel title="Needs review" sub="Draft, Internal and Low confidence items. Approving or sharing here changes what staff can copy.">
      <ErrorNote message={error} />
      {error && <p className="kn-error" role="alert">{error}</p>}
      {reviewError && <p className="kn-error" role="alert">Could not load basis, payee and confidence: {reviewError}. Low confidence items may be missing from this list.</p>}
      {done && !error && <p className="kn-copied" role="status">{done}</p>}
      <div className="bk-note-line">
        <label>Show
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All</option><option value="draft">Draft</option><option value="internal">Internal</option><option value="low">Low confidence</option>
          </select>
        </label>
        <Button variant="primary" busy={busy} disabled={busy || !chosen.length} onClick={() => run("approved", approve)}>Approve selected ({chosen.length})</Button>
        <Button busy={busy} disabled={busy || !chosen.length} onClick={() => run("made Shareable", (t, ids) => setVisibility(t, ids, "Shareable"))}>Make Shareable</Button>
        <Button busy={busy} disabled={busy || !chosen.length} onClick={() => run("made Internal", (t, ids) => setVisibility(t, ids, "Internal"))}>Make Internal</Button>
      </div>
      <DataTable columns={columns} rows={rows} empty="Nothing needs review." />
    </Panel>
  );
}
