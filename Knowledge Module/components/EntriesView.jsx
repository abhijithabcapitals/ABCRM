import { Button, Empty, ErrorNote, Spinner } from "@banking/components/shared";
import { entryToText } from "../logic/copyText.js";
import ResultCard from "./ResultCard";
import CopyButton from "./CopyButton";
import SafeHtml from "./SafeHtml";

export function EntryCard({ entry, isAdmin, onEdit }) {
  return (
    <ResultCard title={entry.title} department={entry.knowledge_categories?.name} updatedAt={entry.updated_at}
      status={entry.status} visibility={entry.visibility}
      footer={<>
        <CopyButton item={entry} text={entryToText(entry)} />
        {isAdmin && <Button onClick={() => onEdit("entry", entry)}>Edit</Button>}
      </>}>
      <details className="kn-details">
        <summary>Show details</summary>
        <SafeHtml html={entry.body} />
      </details>
    </ResultCard>
  );
}

// entries is a useLoad state. types picks the entry types shown. empty says what is missing.
// embedded hides the Add button when the parent view already offers one.
export default function EntriesView({ types, entries, empty, isAdmin, onEdit, embedded }) {
  const rows = (entries.data || []).filter((e) => types.includes(e.entry_type));
  return (
    <div className="kn-stack">
      {isAdmin && !embedded && <div><Button variant="primary" onClick={() => onEdit("entry", null, types[0])}>Add entry</Button></div>}
      {entries.loading && !entries.data ? <Spinner label="Loading" /> : entries.error ? (
        <><ErrorNote message={entries.error} /><p className="kn-error" role="alert">{entries.error}</p></>
      ) : rows.length ? rows.map((e) => <EntryCard key={e.id} entry={e} isAdmin={isAdmin} onEdit={onEdit} />) : (
        <Empty>{empty}{!isAdmin && " Some items may still be awaiting admin review."}</Empty>
      )}
    </div>
  );
}
