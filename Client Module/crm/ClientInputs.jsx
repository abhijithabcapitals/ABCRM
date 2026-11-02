// Clients > Client Inputs: documents uploaded through the portal. Anyone with the Clients tab can
// assign one to themselves, then validate or reject it. Validated files go to the client's folder.
import { useState } from "react";
import "@banking/components/banking.css";
import { Badge, Button, DataTable, ErrorNote, FormModal, PageHead, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { rpc } from "@banking/services/bankingApi";
import { staffCall } from "./ClientPortalAdmin";
import { fmtSize } from "../portal/ClientPortal";

const CLIENT_MODULE_URL = (import.meta.env.VITE_CLIENT_MODULE_URL || "http://127.0.0.1:8792").replace(/\/$/, "");
const VIEWS = [["pending", "Waiting"], ["in_review", "In review"], ["validated", "Validated"], ["rejected", "Rejected"]];
const LABEL = { pending: "Waiting", in_review: "In review", validated: "Validated", rejected: "Rejected" };
const TONE = { pending: "warn", in_review: "warn", validated: "good", rejected: "bad" };

// The online copy is always filed. When the Client Module runs on this PC, a copy also lands in the
// client's folder under DataBase. Returns the path, or null when the module is not running.
async function saveToPc(d) {
  const { url } = await staffCall("staff_url", { id: d.id, filed: true });
  const blob = await (await fetch(url)).blob();
  const form = new FormData();
  form.append("file", blob, d.file_name);
  form.append("client", d.client);
  form.append("client_id", d.client_master_id || "");
  form.append("doc_type", d.doc_type);
  try {
    const res = await fetch(`${CLIENT_MODULE_URL}/api/clients-folder`, { method: "POST", body: form, signal: AbortSignal.timeout(30000) });
    if (!res.ok) return null;
    const { path } = await res.json();
    await rpc("client_inputs_set_local", { p_id: d.id, p_path: path });
    return path;
  } catch {
    return null;
  }
}

export default function ClientInputs() {
  const list = useLoad(() => rpc("client_inputs_list"), []);
  const [view, setView] = useState("pending");
  const [deciding, setDeciding] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const rows = list.data || [];
  const act = async (fn) => {
    setError(null); setMessage(null);
    try { await fn(); } catch (e) { setError(e.message); }
    list.reload();
  };
  const open = (d, filed) => act(async () => window.location.assign((await staffCall("staff_url", { id: d.id, filed })).url));
  const decide = async (values) => {
    const d = deciding.doc;
    await staffCall("staff_review", { id: d.id, status: deciding.status, note: values.note });
    setDeciding(null);
    if (deciding.status === "validated") {
      const path = await saveToPc(d).catch(() => null);
      setMessage(path ? `Saved to ${path}` : "Filed online. Start the Client Module on this PC and use Save to PC for the local folder.");
    }
    list.reload();
  };
  return (
    <div className="bk-root">
      <PageHead title="Client Inputs" sub="Documents from clients. Assign one to yourself, check it, then validate or reject it. Files come from outside and are not virus scanned: open them with care." />
      <div className="bk-tabs" role="tablist" aria-label="Status">
        {VIEWS.map(([k, label]) => <button type="button" role="tab" aria-selected={view === k} key={k} className={view === k ? "active" : ""} onClick={() => setView(k)}>{label} <span className="bk-tab-count">{rows.filter((d) => d.status === k).length}</span></button>)}
      </div>
      <ErrorNote message={error || list.error} />
      {message && <p role="status">{message}</p>}
      {list.loading && !list.data ? <Spinner /> : (
        <DataTable search="Search client, file, type…" rows={rows.filter((d) => d.status === view)} empty={`Nothing ${LABEL[view].toLowerCase()}.`} columns={[
          { key: "client", label: "Client" },
          { key: "doc_type", label: "Type" },
          { key: "file_name", label: "File", render: (d) => <button type="button" className="bk-link" onClick={() => open(d, false)}>{d.file_name}</button> },
          { key: "size_bytes", label: "Size", render: (d) => fmtSize(d.size_bytes) },
          { key: "note", label: "Client's note" },
          { key: "uploaded_at", label: "Uploaded", render: (d) => fmtDate(d.uploaded_at) },
          { key: "status", label: "Status", render: (d) => <Badge tone={TONE[d.status]}>{LABEL[d.status]}</Badge> },
          { key: "assignee", label: "Assigned to" },
          { key: "review_note", label: "Review note" },
          { key: "filed", label: "Clients Folder", render: (d) => d.local_path || (d.filed_path ? "Filed online" : "") },
          { key: "actions", label: "", render: (d) => (
            <span className="bk-actions">
              {d.status === "pending" && <Button variant="primary" onClick={() => act(() => rpc("client_inputs_assign", { p_id: d.id }))}>Assign to me</Button>}
              {d.status === "in_review" && d.can_review && <>
                <Button variant="primary" onClick={() => setDeciding({ doc: d, status: "validated" })}>Validate</Button>
                <Button onClick={() => setDeciding({ doc: d, status: "rejected" })}>Reject</Button>
                <Button onClick={() => act(() => rpc("client_inputs_release", { p_id: d.id }))}>Release</Button>
              </>}
              {d.status === "validated" && !d.local_path && <Button onClick={() => act(async () => {
                const path = await saveToPc(d);
                if (!path) throw new Error("The Client Module is not running on this PC.");
                setMessage(`Saved to ${path}`);
              })}>Save to PC</Button>}
            </span>
          ) },
        ]} />
      )}
      {deciding && (
        <FormModal title={`${deciding.status === "validated" ? "Validate" : "Reject"} ${deciding.doc.file_name}`} submitLabel={deciding.status === "validated" ? "Validate and file" : "Reject"} onClose={() => setDeciding(null)} onSubmit={decide}
          fields={[{ name: "note", label: deciding.status === "validated" ? "Note" : "Reason. The client sees this.", type: "textarea", required: deciding.status === "rejected", full: true }]} />
      )}
    </div>
  );
}
