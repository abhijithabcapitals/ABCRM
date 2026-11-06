import { Empty, Panel, Spinner, useLoad } from "@banking/components/shared";
import { loadClientFolders } from "../services/odCopyApi";

// "Documents in OneDrive" on the client profile: one line per department folder, with a link that opens OneDrive.
// client_folders is readable by every signed-in CRM user (department and link only).
export default function ClientDocumentsBox({ clientId }) {
  const folders = useLoad(() => (clientId ? loadClientFolders(clientId) : Promise.resolve([])), [clientId]);
  const rows = (folders.data || []).filter((f) => f.web_url);
  return (
    <Panel title="Documents in OneDrive">
      {folders.loading && !folders.data ? <Spinner /> : rows.length === 0 ? <Empty>No OneDrive folder linked yet.</Empty> : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {rows.map((f) => (
            <li key={f.department} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", borderBottom: "1px solid #f3f4f6" }}>
              <span>{f.department}</span>
              <a href={f.web_url} target="_blank" rel="noopener noreferrer">Open in OneDrive</a>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
