import { useEffect, useRef, useState } from "react";
import "@banking/components/banking.css";
import { Empty, ErrorNote, Spinner, useLoad } from "@banking/components/shared";
import { dubaiToday } from "@hr/logic/attendance.js";
import "./knowledge.css";
import { listBankingPrices, listCategories, listEntries, listPriceLines, listServices, search as searchKnowledge } from "../services/knowledgeApi";
import { needsReview } from "../logic/status.js";
import PricingView, { BankingCard, PriceGroupCard } from "./PricingView";
import ServicesView, { ServiceCard } from "./ServicesView";
import EntriesView, { EntryCard } from "./EntriesView";
import NeedsReview from "./NeedsReview";
import EditForm from "./EditForm";
import ResultCard from "./ResultCard";

const TABS = [["pricing", "Pricing"], ["services", "Plans & Services"], ["procedures", "Procedures & Documents"], ["answers", "Client Answers"]];

// A search hit shown as the full card when its row is loaded. Otherwise a plain card with no copy button.
function Hit({ hit, data, today, isAdmin, onEdit }) {
  const find = (state, key) => state.data?.find((r) => r[key] === hit.source_id);
  if (hit.kind === "entry") {
    const entry = find(data.entries, "id");
    if (entry) return <EntryCard entry={entry} isAdmin={isAdmin} onEdit={onEdit} />;
  } else if (hit.kind === "price") {
    const line = find(data.lines, "id");
    if (line) return <PriceGroupCard title={hit.title} lines={[line]} today={today} isAdmin={isAdmin} onEdit={onEdit} />;
  } else if (hit.kind === "banking") {
    const row = find(data.banking, "price_id");
    if (row) return <BankingCard row={row} today={today} />;
  } else if (hit.kind === "service") {
    return <ServiceCard title={hit.title} department={hit.department} />;
  }
  return <ResultCard title={hit.title} department={hit.department} updatedAt={hit.updated_at} status={hit.status} visibility={hit.visibility} />;
}

export default function KnowledgeModule({ profile }) {
  const isAdmin = profile?.role === "admin";
  const today = dubaiToday();
  const lines = useLoad(listPriceLines, []);
  const banking = useLoad(listBankingPrices, []);
  const entries = useLoad(listEntries, []);
  const services = useLoad(listServices, []);
  const categories = useLoad(async () => (isAdmin ? listCategories() : []), [isAdmin]);
  const [tab, setTab] = useState("pricing");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState({ hits: null, error: null, loading: false });
  const [editing, setEditing] = useState(null); // { kind, row, defaultType }
  const latest = useRef(0);

  // Only the newest query may set results: an earlier one that returns late is ignored.
  useEffect(() => {
    const text = query.trim();
    const id = ++latest.current;
    if (!text) { setFound({ hits: null, error: null, loading: false }); return undefined; }
    setFound((f) => ({ ...f, error: null, loading: true }));
    const timer = setTimeout(async () => {
      try {
        const hits = await searchKnowledge(text);
        if (id === latest.current) setFound({ hits, error: null, loading: false });
      } catch (e) {
        if (id === latest.current) setFound({ hits: null, error: e.message, loading: false });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const data = { lines, banking, entries, services };
  const reviewCount = isAdmin ? [...(lines.data || []), ...(entries.data || [])].filter(needsReview).length : 0;
  const tabs = isAdmin ? [...TABS, ["review", `Needs review${reviewCount ? ` (${reviewCount})` : ""}`]] : TABS;
  const onEdit = (kind, row, defaultType) => setEditing({ kind, row, defaultType });
  const reloadAll = () => { lines.reload(); entries.reload(); };
  const shared = { isAdmin, onEdit };

  const searching = query.trim() !== "";
  const results = () => {
    if (found.error) return <><ErrorNote message={found.error} /><p className="kn-error" role="alert">Search failed: {found.error}</p></>;
    if (found.loading || !found.hits) return <Spinner label="Searching" />;
    if (!found.hits.length) return <Empty>No results for "{query.trim()}". Items may be awaiting admin review.</Empty>;
    return <div className="kn-stack">{found.hits.map((h) => <Hit key={`${h.kind}:${h.source_id}`} hit={h} data={data} today={today} {...shared} />)}</div>;
  };

  return (
    <div className="bk-root kn-root">
      <header className="bk-header"><div><span className="bk-eyebrow">AB CAPITAL SERVICES FZE</span><h1>Knowledge</h1></div></header>
      <input className="bk-search kn-search" type="search" placeholder="Search prices, plans, procedures and answers" aria-label="Search Knowledge" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="bk-nav-wrap"><nav className="bk-nav" aria-label="Knowledge">
        {tabs.map(([key, label]) => (
          <button type="button" key={key} data-label={label} aria-current={tab === key ? "page" : undefined} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav></div>
      {searching ? results() : (
        <>
          {tab === "pricing" && <PricingView lines={lines} banking={banking} today={today} {...shared} />}
          {tab === "services" && <ServicesView entries={entries} services={services} {...shared} />}
          {tab === "procedures" && <EntriesView types={["procedure", "checklist"]} entries={entries} empty="No procedures or documents have been added yet." {...shared} />}
          {tab === "answers" && <EntriesView types={["client_answer"]} entries={entries} empty="No client answers have been added yet." {...shared} />}
          {tab === "review" && isAdmin && (
            lines.data && entries.data
              ? <NeedsReview lines={lines.data} entries={entries.data} reload={async () => { await Promise.all([lines.reload(), entries.reload()]); }} {...shared} />
              : lines.error || entries.error ? <ErrorNote message={lines.error || entries.error} /> : <Spinner label="Loading" />
          )}
        </>
      )}
      {editing && categories.error && <ErrorNote message={`Could not load departments: ${categories.error}`} />}
      {editing && categories.data && (
        <EditForm kind={editing.kind} row={editing.row} defaultType={editing.defaultType} categories={categories.data} isAdmin={isAdmin}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reloadAll(); }} />
      )}
    </div>
  );
}
