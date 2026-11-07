// Copies a client's document into their synced OneDrive folder through the Client Module running on this PC (POST /api/clients-folder,
// as Client Inputs does). The Client Module finds "<Legal Name> - <Client ID>" and never overwrites. Throws a sentence for staff when it cannot.
import { oneDriveType } from "../logic/oneDrive";

const CLIENT_MODULE_URL = (import.meta.env.VITE_CLIENT_MODULE_URL || "http://127.0.0.1:8792").replace(/\/$/, "");

export async function saveToOneDrive(file, clientName, clientId, formType) {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("client", clientName || clientId || "");
  form.append("client_id", clientId || "");
  form.append("doc_type", oneDriveType(formType));
  let res;
  try {
    res = await fetch(`${CLIENT_MODULE_URL}/api/clients-folder`, { method: "POST", body: form, signal: AbortSignal.timeout(30000) });
  } catch {
    throw new Error("the Client Module is not running on this PC");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `the Client Module answered ${res.status}`);
  return body.path;
}
