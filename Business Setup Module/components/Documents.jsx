// All quotes and letters of the department, older ones included. An older quote with no client can be linked to one.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, PageHead, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { listDocuments, openStored } from "@template-hub/services/hubApi";
import { useSetup } from "./SetupContext";
import { linkQuote } from "../services/businessSetupApi";
import { quoteTone } from "../logic/statuses";

export default function Documents({ embedded = false }) {
  const { goTo, can } = useSetup();
  const docs = useLoad(() => listDocuments("Business Setup"), []);
  const [link, setLink] = useState(null);
  const [error, setError] = useState(null);
  const rows = (docs.data || []).filter((d) => d.doc_type !== "mail");
  return (
    <div>
      {!embedded && <PageHead title="Documents" sub="Quotes and engagement letters. Open a client to act on one." />}
      <ErrorNote message={docs.error || error} onClose={error ? () => setError(null) : undefined} />
      {docs.loading && !docs.data ? <Spinner /> : (
        <DataTable rows={rows} search="Search number or client…" empty="No documents yet." columns={[
          { key: "document_number", label: "Number" }, { key: "doc_type", label: "Type", render: (d) => (d.doc_type === "quote" ? "Quote" : "Letter") },
          { key: "client_name", label: "Client" }, { key: "created_at", label: "Date", render: (d) => fmtDate(d.created_at) },
          { key: "total_amount", label: "AED", right: true, render: (d) => Number(d.total_amount || 0).toLocaleString("en-AE") },
          { key: "status", label: "Status", render: (d) => (d.doc_type === "quote" ? <Badge tone={quoteTone(d.status)}>{d.status}</Badge> : "") },
          { key: "x", label: "", render: (d) => (
            <span className="bk-actions">
              {d.storage_path && <Button onClick={() => openStored(d.storage_path).catch((e) => setError(e.message))}>Open</Button>}
              {d.client_id && <Button onClick={() => goTo("clients", { client: d.client_id })}>Client</Button>}
              {!d.client_id && d.doc_type === "quote" && can("setup.quotes.manage") && <Button onClick={() => setLink(d)}>Link client</Button>}
            </span>
          ) },
        ]} />
      )}
      {link && <FormModal title={`Link ${link.document_number} to a client`} fields={[{ name: "client", label: "Client ID (CL000001)", required: true }]} onClose={() => setLink(null)}
        onSubmit={async (v) => { await linkQuote(link.id, v.client); await docs.reload(); }} />}
    </div>
  );
}
