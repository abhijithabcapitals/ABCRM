// Files staff uploaded for this client, and outputs of its services.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FilePick, fmtDate } from "@banking/components/shared";
import { useSetup } from "../SetupContext";
import { addDocument, openDocument, uploadFile } from "../../services/businessSetupApi";

export default function Files({ w, clientId, reload }) {
  const { can } = useSetup();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const add = async (file) => {
    setBusy(true); setError(null);
    try {
      const path = await uploadFile(clientId, file);
      await addDocument({ client_id: clientId, kind: "Client file", file_name: file.name, storage_path: path });
      await reload();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };
  return (
    <div>
      <ErrorNote message={error} onClose={() => setError(null)} />
      {(can("setup.services.manage") || can("setup.kyc.manage")) && <div className="bk-actions bk-mb"><FilePick label="Upload a file" busy={busy} onFile={add} /></div>}
      <DataTable rows={w.documents} empty="No files yet." columns={[
        { key: "file_name", label: "File", render: (d) => <button type="button" className="bk-link" onClick={() => openDocument(d.storage_path).catch((e) => setError(e.message))}>{d.file_name}</button> },
        { key: "kind", label: "Kind" }, { key: "created_at", label: "Added", render: (d) => fmtDate(d.created_at) },
        { key: "client_visible", label: "Client sees it", render: (d) => (d.client_visible && d.is_output ? <Badge tone="good">Yes</Badge> : "No") },
      ]} />
    </div>
  );
}
